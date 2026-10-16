-- 0062 One stay in a class and in a group (task 3.5c, pull request #117).
--
-- Issue #105, H36: "one continuous stay in one class is one stay everywhere
-- (the class panel, the group panel, the student record, the History tab, the
-- counts of free seats, the exports, and every later reader); a cancel or an
-- undo gives the stay back as it was before, not as a new planned stay; the
-- same for group stays; the stays already split on the test site are joined."
-- H34: "A date change of a scheduled move shows as two moves ... Wanted: one
-- move with its changes."
-- docs/spec/edge-cases/developer-rules.md, Membership: "One class per student
-- per date, and one group per student per subject per date, by date ranges
-- that cannot overlap" (`*_no_overlap`, untouched).
--
-- The plan approved on pull request #117 with corrections 1 to 7; decisions 1
-- to 5 Look first. 3.1b decision 8 ("rows only shrink; a leaving taken back
-- writes new rows") is reversed: taking back what cut a row (the cancel or
-- the undo of a leaving or of a move) grows the cut row back, and the days it
-- takes back pass every check of an insert at the commit. Paths are added to
-- the triggers below; none is taken away.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/classes/class-membership-rows.ts).

-- ---------------------------------------------------------------------------
-- 1. The end `joined` (decision 2): the later of two adjoining rows of one
-- student in one class (one group), emptied into the earlier one, which takes
-- its end. `joined_into_id` names the earlier row; `joined_xact` the
-- transaction that joined it, so that the earlier row may take the end in
-- that transaction only (.claude/rules/database.md: "inserted or written by
-- this transaction" is an xid8 column).

alter table class_memberships
  add column joined_into_id uuid references class_memberships (id),
  add column joined_xact xid8;
alter table group_memberships
  add column joined_into_id uuid references group_memberships (id),
  add column joined_xact xid8;

create index class_memberships_joined_into_idx on class_memberships (joined_into_id);
create index group_memberships_joined_into_idx on group_memberships (joined_into_id);

alter table class_memberships drop constraint class_memberships_ended_by_check;
alter table class_memberships add constraint class_memberships_ended_by_check check (
  ended_by in ('leaving', 'withdrawn', 'transfer', 'undone', 'branch_move', 'merge', 'joined')
);
alter table group_memberships drop constraint group_memberships_ended_by_check;
alter table group_memberships add constraint group_memberships_ended_by_check check (
  ended_by in (
    'leaving', 'withdrawn', 'class_withdrawn', 'transfer', 'undone', 'branch_move', 'merge', 'joined'
  )
);

-- A joined row is empty and names the row it was joined into, and only then.
alter table class_memberships add constraint class_memberships_joined_check check (
  coalesce(ended_by = 'joined', false) = (joined_into_id is not null)
  and (joined_into_id is null) = (joined_xact is null)
  and (ended_by is distinct from 'joined' or valid_until = valid_from)
);
alter table group_memberships add constraint group_memberships_joined_check check (
  coalesce(ended_by = 'joined', false) = (joined_into_id is not null)
  and (joined_into_id is null) = (joined_xact is null)
  and (ended_by is distinct from 'joined' or valid_until = valid_from)
);

grant update (own_until, joined_into_id, joined_xact) on class_memberships to sodiq_app;
grant update (own_until, joined_into_id, joined_xact) on group_memberships to sodiq_app;

-- Whether a row is the earlier row of a join written in this transaction: a
-- row emptied `joined` into it here began at its end before the update.
create function class_membership_joining(row_ref uuid, old_until date) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from class_memberships j
    where j.joined_into_id = row_ref
      and j.joined_xact = pg_current_xact_id()
      and j.valid_from = old_until
  )
$$;

create function group_membership_joining(row_ref uuid, old_until date) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from group_memberships j
    where j.joined_into_id = row_ref
      and j.joined_xact = pg_current_xact_id()
      and j.valid_from = old_until
  )
$$;

-- Whether what cut a row is taken back on the days `[from_day, until_day)`:
-- the inactive status row of its leaving no longer holds any of them (a
-- cancel or an undo emptied it, a replace moved it), or its move is cancelled
-- or undone.
create function membership_cut_taken_back(
  ended_by text,
  leaving uuid,
  move uuid,
  from_day date,
  until_day date
) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select case ended_by
    when 'leaving' then not exists (
      select 1 from student_statuses s
      where s.id = leaving
        and daterange(s.valid_from, s.valid_until) && daterange(from_day, until_day)
    )
    when 'transfer' then exists (
      select 1 from student_moves m
      where m.id = move and (m.cancelled_at is not null or m.undone_at is not null)
    )
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- 2. The shrink rule of 0054 with two paths added (decision 1 of 3.5c); none
-- taken away.
-- - Grow back: a row cut by a leaving or a move (an emptied one too) gets
--   days back up to its own end while that leaving or move is taken back on
--   those days; it ends with any end an insert may carry (none at its own
--   end, a leaving of the student, a live move at its date, the last checked
--   by `memberships_move_end`). The days given back are checked at the commit
--   (`class_memberships_regained`).
-- - Join (decision 2, corrections 2 and 3): the later row is emptied
--   `joined` into the earlier one, which ends where it begins; then the
--   earlier row takes the later row's end and own end. Rows ended
--   `branch_move` or `merge` change only in a join, on either side. A join
--   changes no day, so it runs no year check (decision 5, Look first); the
--   commit check `class_memberships_joined` holds the earlier row to the
--   later row's days and end.
-- A row ended `withdrawn`, `undone` or `joined` stays final, except that a
-- merge's carry moves it to the other record. Every other rule as in 0054.
create or replace function class_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
  joining boolean := new.valid_until > old.valid_until
    and new.student_id = old.student_id
    and class_membership_joining(new.id, old.valid_until);
  joined boolean := new.ended_by = 'joined' and old.ended_by is distinct from 'joined';
begin
  -- The carry of a merge moves a row to the other record and changes
  -- nothing else of it, an ended row included (`memberships_merge` of 0054
  -- guards it): a row emptied `joined`, `withdrawn` or `undone` goes with
  -- its record too.
  if (to_jsonb(new) - 'student_id') = (to_jsonb(old) - 'student_id') then
    return new;
  end if;
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'ended_by_move_id'
        - 'ended_by_branch_move_id' - 'student_id' - 'own_until' - 'joined_into_id' - 'joined_xact')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id'
        - 'ended_by_move_id' - 'ended_by_branch_move_id' - 'student_id' - 'own_until'
        - 'joined_into_id' - 'joined_xact')
    or old.ended_by in ('withdrawn', 'undone', 'joined')
    or (new.own_until <> old.own_until and not joining)
    or ((new.joined_into_id is distinct from old.joined_into_id
      or new.joined_xact is distinct from old.joined_xact) and not joined)
    or (old.ended_by in ('branch_move', 'merge') and not joining and not joined
      and (new.ended_by is distinct from old.ended_by or new.valid_until <> old.valid_until)) then
    raise exception 'class_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'class_memberships_only_shrink';
  end if;
  if joined then
    if old.valid_from >= old.valid_until
      or new.joined_xact is distinct from pg_current_xact_id()
      or new.student_id <> old.student_id
      or not exists (
        select 1 from class_memberships r
        where r.id = new.joined_into_id
          and r.id <> new.id
          and r.student_id = new.student_id
          and r.class_id = new.class_id
          and r.valid_from < r.valid_until
          and r.valid_until = old.valid_from
      ) then
      raise exception 'class_memberships_join'
        using errcode = 'check_violation', constraint = 'class_memberships_join';
    end if;
  elsif new.valid_until > old.valid_until and not joining then
    if old.ended_by is null
      or old.ended_by not in ('leaving', 'transfer')
      or not membership_cut_taken_back(
        old.ended_by, old.leaving_id, old.ended_by_move_id, old.valid_until, new.valid_until
      )
      or (new.ended_by is not null and new.ended_by not in ('leaving', 'transfer')) then
      raise exception 'class_memberships_only_shrink'
        using errcode = 'check_violation', constraint = 'class_memberships_only_shrink';
    end if;
  elsif not joining
    and old.ended_by in ('leaving', 'transfer', 'branch_move', 'merge') and new.ended_by is null then
    raise exception 'class_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'class_memberships_only_shrink';
  end if;
  -- Decision 10 of 3.1b: a placement is withdrawn only before its first day
  -- in the branch's time zone; without a moment, never.
  if new.ended_by = 'withdrawn' and old.ended_by is distinct from 'withdrawn'
    and old.valid_from <= coalesce(branch_today(new.branch_id), 'infinity'::date) then
    raise exception 'class_memberships_withdraw_planned'
      using errcode = 'check_violation', constraint = 'class_memberships_withdraw_planned';
  end if;
  if new.leaving_id is not null
    and new.leaving_id is distinct from old.leaving_id
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'class_memberships_leaving'
      using errcode = 'check_violation', constraint = 'class_memberships_leaving';
  end if;
  if (new.ended_by_move_id is not null
      and new.ended_by_move_id is distinct from old.ended_by_move_id
      and not student_move_of(new.student_id, new.ended_by_move_id))
    or (new.ended_by = 'undone'
      and new.ended_by_move_id is distinct from old.written_by_move_id) then
    raise exception 'class_memberships_move'
      using errcode = 'check_violation', constraint = 'class_memberships_move';
  end if;
  if new.valid_until <> old.valid_until and not joining and not joined then
    perform 1 from classes c where c.id = new.class_id for share;
    select c.academic_year_id into year_id from classes c where c.id = new.class_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

-- The same for group rows; a class-withdrawn row is final too, and the review
-- tag only goes from true to false.
create or replace function group_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
  joining boolean := new.valid_until > old.valid_until
    and new.student_id = old.student_id
    and group_membership_joining(new.id, old.valid_until);
  joined boolean := new.ended_by = 'joined' and old.ended_by is distinct from 'joined';
begin
  -- The carry of a merge moves a row to the other record and changes
  -- nothing else of it, an ended row included (`memberships_merge` of 0054
  -- guards it): a row emptied `joined`, `withdrawn` or `undone` goes with
  -- its record too.
  if (to_jsonb(new) - 'student_id') = (to_jsonb(old) - 'student_id') then
    return new;
  end if;
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review' - 'ended_by_move_id'
        - 'ended_by_branch_move_id' - 'student_id' - 'own_until' - 'joined_into_id' - 'joined_xact')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review'
        - 'ended_by_move_id' - 'ended_by_branch_move_id' - 'student_id' - 'own_until'
        - 'joined_into_id' - 'joined_xact')
    or old.ended_by in ('withdrawn', 'class_withdrawn', 'undone', 'joined')
    or (new.own_until <> old.own_until and not joining)
    or ((new.joined_into_id is distinct from old.joined_into_id
      or new.joined_xact is distinct from old.joined_xact) and not joined)
    or (old.ended_by in ('branch_move', 'merge') and not joining and not joined
      and (new.ended_by is distinct from old.ended_by or new.valid_until <> old.valid_until))
    or (new.review and not old.review) then
    raise exception 'group_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'group_memberships_only_shrink';
  end if;
  if joined then
    if old.valid_from >= old.valid_until
      or new.joined_xact is distinct from pg_current_xact_id()
      or new.student_id <> old.student_id
      or not exists (
        select 1 from group_memberships r
        where r.id = new.joined_into_id
          and r.id <> new.id
          and r.student_id = new.student_id
          and r.group_id = new.group_id
          and r.valid_from < r.valid_until
          and r.valid_until = old.valid_from
      ) then
      raise exception 'group_memberships_join'
        using errcode = 'check_violation', constraint = 'group_memberships_join';
    end if;
  elsif new.valid_until > old.valid_until and not joining then
    if old.ended_by is null
      or old.ended_by not in ('leaving', 'transfer')
      or not membership_cut_taken_back(
        old.ended_by, old.leaving_id, old.ended_by_move_id, old.valid_until, new.valid_until
      )
      or (new.ended_by is not null and new.ended_by not in ('leaving', 'transfer')) then
      raise exception 'group_memberships_only_shrink'
        using errcode = 'check_violation', constraint = 'group_memberships_only_shrink';
    end if;
  elsif not joining
    and old.ended_by in ('leaving', 'transfer', 'branch_move', 'merge') and new.ended_by is null then
    raise exception 'group_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'group_memberships_only_shrink';
  end if;
  if new.ended_by in ('withdrawn', 'class_withdrawn') and old.ended_by is distinct from new.ended_by
    and old.valid_from <= coalesce(branch_today(new.branch_id), 'infinity'::date) then
    raise exception 'group_memberships_withdraw_planned'
      using errcode = 'check_violation', constraint = 'group_memberships_withdraw_planned';
  end if;
  if new.leaving_id is not null
    and new.leaving_id is distinct from old.leaving_id
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'group_memberships_leaving'
      using errcode = 'check_violation', constraint = 'group_memberships_leaving';
  end if;
  if (new.ended_by_move_id is not null
      and new.ended_by_move_id is distinct from old.ended_by_move_id
      and not student_move_of(new.student_id, new.ended_by_move_id))
    or (new.ended_by = 'undone'
      and new.ended_by_move_id is distinct from old.written_by_move_id) then
    raise exception 'group_memberships_move'
      using errcode = 'check_violation', constraint = 'group_memberships_move';
  end if;
  if new.valid_until <> old.valid_until and not joining and not joined then
    perform 1 from groups g where g.id = new.group_id for share;
    select g.academic_year_id into year_id from groups g where g.id = new.group_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The end triggers of 0051, 0053 and 0054 accept an end the earlier row
-- of a join takes over from the later row, and only that (decision 1); the
-- commit check `*_joined` holds it to the later row's end. Every other rule
-- as before.

create or replace function memberships_move_end() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.ended_by in ('transfer', 'undone')
    and (new.ended_by is distinct from old.ended_by
      or new.ended_by_move_id is distinct from old.ended_by_move_id
      or new.valid_until is distinct from old.valid_until)
    and not membership_joining_here(tg_table_name, new.id, new.valid_until, old.valid_until)
    and not membership_move_end_valid(
      new.student_id, new.ended_by_move_id, new.ended_by, new.valid_from, new.valid_until
    ) then
    raise exception 'memberships_move_end'
      using errcode = 'check_violation', constraint = 'memberships_move_end';
  end if;
  return new;
end;
$$;

-- Whether an update of a row of either membership table is the earlier row
-- of a join written in this transaction.
create function membership_joining_here(
  table_name text,
  row_ref uuid,
  new_until date,
  old_until date
) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select new_until > old_until and case table_name
    when 'class_memberships' then class_membership_joining(row_ref, old_until)
    when 'group_memberships' then group_membership_joining(row_ref, old_until)
    else false
  end
$$;

create or replace function memberships_branch_move() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.ended_by = 'branch_move'
      or (new.cause = 'branch_move' and not exists (
        select 1 from student_branch_moves m
        where m.student_id = new.student_id
          and m.to_branch_id = new.branch_id
          and m.accepted_xact = pg_current_xact_id()
          and m.effective_on = new.valid_from
      )) then
      raise exception 'memberships_branch_move'
        using errcode = 'check_violation', constraint = 'memberships_branch_move';
    end if;
    return new;
  end if;
  if new.ended_by = 'branch_move'
    and (new.ended_by is distinct from old.ended_by
      or new.ended_by_branch_move_id is distinct from old.ended_by_branch_move_id
      or new.valid_until is distinct from old.valid_until)
    and not membership_joining_here(tg_table_name, new.id, new.valid_until, old.valid_until)
    and not exists (
      select 1 from student_branch_moves m
      where m.id = new.ended_by_branch_move_id
        and m.student_id = new.student_id
        and m.from_branch_id = new.branch_id
        and m.accepted_xact = pg_current_xact_id()
        and (new.valid_until = m.effective_on
          or (new.valid_until = new.valid_from and new.valid_from >= m.effective_on))
    ) then
    raise exception 'memberships_branch_move'
      using errcode = 'check_violation', constraint = 'memberships_branch_move';
  end if;
  return new;
end;
$$;

create or replace function memberships_merge() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.ended_by = 'merge' then
      raise exception 'memberships_merge'
        using errcode = 'check_violation', constraint = 'memberships_merge';
    end if;
    return new;
  end if;
  if new.student_id is distinct from old.student_id
    and ((to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id')
      or not student_merge_here(old.student_id, new.student_id)) then
    raise exception 'memberships_merge'
      using errcode = 'check_violation', constraint = 'memberships_merge';
  end if;
  if new.ended_by = 'merge' and old.ended_by is distinct from 'merge'
    and not membership_joining_here(tg_table_name, new.id, new.valid_until, old.valid_until)
    and (old.ended_by is not null
      or new.leaving_id is not null
      or new.ended_by_move_id is not null
      or new.ended_by_branch_move_id is not null
      or not student_merging_here(new.student_id)) then
    raise exception 'memberships_merge'
      using errcode = 'check_violation', constraint = 'memberships_merge';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The days a row gets back pass every check of an insert, at the commit
-- (plan item 3; .claude/rules/database.md: "A rule that a check waives for
-- rows out of service ... is checked again when the row comes back into
-- service ... The re-check covers every rule the waiver skipped"). The class
-- (group) is locked FOR UPDATE here, in the commit check, never in a
-- before-row trigger; every application path that gives rows back has
-- locked its classes and groups FOR UPDATE in the order of their id before
-- its first write, so this is a re-take. The days are those the row holds at
-- the commit beyond its end before this update. A join gets no day back and
-- is not checked. The refusals name the constraints of the insert guard, so
-- that they answer the same codes.

create function class_memberships_regained() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  now_row record;
  pupil record;
  held record;
  from_day date := old.valid_until;
begin
  select m.* into now_row from class_memberships m where m.id = new.id;
  if not found or now_row.valid_until <= from_day
    or exists (
      select 1 from class_memberships j
      where j.joined_into_id = new.id and j.joined_xact = pg_current_xact_id()
    ) then
    return null;
  end if;
  perform 1 from classes c where c.id = now_row.class_id for update;
  select s.grade, s.branch_id into pupil from students s where s.id = now_row.student_id;
  if not found or pupil.branch_id is distinct from now_row.branch_id then
    raise exception 'class_memberships_student_branch'
      using errcode = 'check_violation', constraint = 'class_memberships_student_branch';
  end if;
  select c.archived_at, c.academic_year_id, c.grade, c.max_size into held
    from classes c where c.id = now_row.class_id;
  if held.archived_at is not null then
    raise exception 'class_memberships_class_archived'
      using errcode = 'check_violation', constraint = 'class_memberships_class_archived';
  end if;
  perform class_year_open(held.academic_year_id);
  if pupil.grade <> held.grade then
    raise exception 'class_memberships_grade'
      using errcode = 'check_violation', constraint = 'class_memberships_grade';
  end if;
  if now_row.leaving_id is not null
    and not class_membership_leaving_valid(now_row.student_id, now_row.leaving_id) then
    raise exception 'class_memberships_leaving'
      using errcode = 'check_violation', constraint = 'class_memberships_leaving';
  end if;
  if class_members_peak(now_row.class_id, from_day, now_row.valid_until) > held.max_size then
    raise exception 'class_memberships_full'
      using errcode = 'check_violation', constraint = 'class_memberships_full';
  end if;
  if exists (
    select 1
    from class_group_subjects(now_row.class_id) subject
    where not isempty(coalesce(class_row_gaps(now_row.id, subject, from_day), '{}'::datemultirange))
  ) then
    raise exception 'class_memberships_need_groups'
      using errcode = 'check_violation', constraint = 'class_memberships_need_groups';
  end if;
  return null;
end;
$$;

create constraint trigger class_memberships_regained
  after update on class_memberships
  deferrable initially deferred
  for each row
  when (new.valid_until > old.valid_until)
  execute function class_memberships_regained();

create function group_memberships_regained() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  now_row record;
  pupil_branch uuid;
  held record;
  from_day date := old.valid_until;
begin
  select m.* into now_row from group_memberships m where m.id = new.id;
  if not found or now_row.valid_until <= from_day
    or exists (
      select 1 from group_memberships j
      where j.joined_into_id = new.id and j.joined_xact = pg_current_xact_id()
    ) then
    return null;
  end if;
  perform 1 from groups g where g.id = now_row.group_id for update;
  select s.branch_id into pupil_branch from students s where s.id = now_row.student_id;
  if not found or pupil_branch is distinct from now_row.branch_id then
    raise exception 'group_memberships_student_branch'
      using errcode = 'check_violation', constraint = 'group_memberships_student_branch';
  end if;
  select g.archived_at, g.academic_year_id, g.max_size into held
    from groups g where g.id = now_row.group_id;
  if held.archived_at is not null then
    raise exception 'group_memberships_group_archived'
      using errcode = 'check_violation', constraint = 'group_memberships_group_archived';
  end if;
  perform class_year_open(held.academic_year_id);
  if now_row.leaving_id is not null
    and not class_membership_leaving_valid(now_row.student_id, now_row.leaving_id) then
    raise exception 'group_memberships_leaving'
      using errcode = 'check_violation', constraint = 'group_memberships_leaving';
  end if;
  if group_members_peak(now_row.group_id, from_day, now_row.valid_until) > held.max_size then
    raise exception 'group_memberships_full'
      using errcode = 'check_violation', constraint = 'group_memberships_full';
  end if;
  return null;
end;
$$;

create constraint trigger group_memberships_regained
  after update on group_memberships
  deferrable initially deferred
  for each row
  when (new.valid_until > old.valid_until)
  execute function group_memberships_regained();

-- Correction 3: a row emptied `joined` is held, on every day it had, by the
-- row its `joined_into_id` names, at the commit; when that row ends where the
-- joined row ended, with the same end and own end. Otherwise a row emptied
-- `joined` with no row grown would lose a stay that no reader can tell.
create function class_memberships_joined() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from class_memberships r
    where r.id = new.joined_into_id
      and r.student_id = old.student_id
      and r.class_id = old.class_id
      and r.valid_from <= old.valid_from
      and r.valid_until >= old.valid_until
      and (r.valid_until > old.valid_until
        or (r.own_until = old.own_until
          and r.ended_by is not distinct from old.ended_by
          and r.leaving_id is not distinct from old.leaving_id
          and r.ended_by_move_id is not distinct from old.ended_by_move_id
          and r.ended_by_branch_move_id is not distinct from old.ended_by_branch_move_id))
  ) then
    raise exception 'class_memberships_join'
      using errcode = 'check_violation', constraint = 'class_memberships_join';
  end if;
  return null;
end;
$$;

create constraint trigger class_memberships_joined
  after update on class_memberships
  deferrable initially deferred
  for each row
  when (new.ended_by = 'joined' and old.ended_by is distinct from 'joined')
  execute function class_memberships_joined();

create function group_memberships_joined() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from group_memberships r
    where r.id = new.joined_into_id
      and r.student_id = old.student_id
      and r.group_id = old.group_id
      and r.valid_from <= old.valid_from
      and r.valid_until >= old.valid_until
      and (r.valid_until > old.valid_until
        or (r.own_until = old.own_until
          and r.ended_by is not distinct from old.ended_by
          and r.leaving_id is not distinct from old.leaving_id
          and r.ended_by_move_id is not distinct from old.ended_by_move_id
          and r.ended_by_branch_move_id is not distinct from old.ended_by_branch_move_id))
  ) then
    raise exception 'group_memberships_join'
      using errcode = 'check_violation', constraint = 'group_memberships_join';
  end if;
  return null;
end;
$$;

create constraint trigger group_memberships_joined
  after update on group_memberships
  deferrable initially deferred
  for each row
  when (new.ended_by = 'joined' and old.ended_by is distinct from 'joined')
  execute function group_memberships_joined();

-- ---------------------------------------------------------------------------
-- 5. A changed scheduled move is one move (H34, decision 6): the new move
-- names the cancelled move it replaces. Written on the insert by the change;
-- filled once by this migration for the changes made before it. One move is
-- replaced at most once.

alter table student_moves
  add column replaces_move_id uuid references student_moves (id);
create unique index student_moves_replaces_idx on student_moves (replaces_move_id);
grant insert (replaces_move_id) on student_moves to sodiq_app;

-- The move replaced is a cancelled move of the same student, kind and
-- subject, not the move itself. For every user. Runs as the invoker.
create function student_move_replaces_valid(
  move uuid,
  replaced uuid,
  student uuid,
  move_kind text,
  subject uuid
) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from student_moves m
    where m.id = replaced
      and m.id <> move
      and m.student_id = student
      and m.kind = move_kind
      and m.subject_id is not distinct from subject
      and m.cancelled_at is not null
  )
$$;

create function student_moves_replaces() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.replaces_move_id is not null
    and (tg_op = 'INSERT' or old.replaces_move_id is null)
    and not student_move_replaces_valid(
      new.id, new.replaces_move_id, new.student_id, new.kind, new.subject_id
    ) then
    raise exception 'student_moves_replaces'
      using errcode = 'check_violation', constraint = 'student_moves_replaces';
  end if;
  return new;
end;
$$;

create trigger student_moves_replaces
  before insert or update of replaces_move_id on student_moves
  for each row execute function student_moves_replaces();

-- The state rule of 0054 with one path added: `replaces_move_id` is filled
-- once where it is empty (this migration's fill; the application has no
-- update grant on it), nothing else of the move changing. Every other rule
-- as before.
create or replace function student_moves_state() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  today date := branch_today(new.branch_id);
begin
  if new.student_id is distinct from old.student_id then
    if (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id')
      or not student_merge_here(old.student_id, new.student_id) then
      raise exception 'student_moves_state'
        using errcode = 'check_violation', constraint = 'student_moves_state';
    end if;
    return new;
  end if;
  if new.replaces_move_id is distinct from old.replaces_move_id then
    if old.replaces_move_id is not null
      or (to_jsonb(new) - 'replaces_move_id') is distinct from (to_jsonb(old) - 'replaces_move_id') then
      raise exception 'student_moves_state'
        using errcode = 'check_violation', constraint = 'student_moves_state';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'cancelled_at' - 'undone_at' - 'cancelled_by_leaving_id' - 'reason')
      is distinct from (to_jsonb(old) - 'cancelled_at' - 'undone_at' - 'cancelled_by_leaving_id' - 'reason')
    or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at)
    or (old.undone_at is not null and new.undone_at is distinct from old.undone_at)
    or (old.cancelled_by_leaving_id is not null
      and new.cancelled_by_leaving_id is distinct from old.cancelled_by_leaving_id)
    or (old.reason is not null and new.reason is distinct from old.reason) then
    raise exception 'student_moves_state'
      using errcode = 'check_violation', constraint = 'student_moves_state';
  end if;
  if old.cancelled_at is null and new.cancelled_at is not null
    and (today is null or new.effective_on <= today) then
    raise exception 'student_moves_not_scheduled'
      using errcode = 'check_violation', constraint = 'student_moves_not_scheduled';
  end if;
  if old.undone_at is null and new.undone_at is not null
    and (today is null or new.effective_on > today) then
    raise exception 'student_moves_not_begun'
      using errcode = 'check_violation', constraint = 'student_moves_not_begun';
  end if;
  return new;
end;
$$;

-- The fill for the changes made before this migration, from their audit
-- entries (decision 4): the entry of a change names the cancelled move
-- (`old_value.moveId`) and the new one (`new_value.moveId`).
update student_moves m
set replaces_move_id = (a.old_value ->> 'moveId')::uuid
from audit_log a
where a.action in ('student.class_transfer_changed', 'student.group_transfer_changed')
  and m.id = (a.new_value ->> 'moveId')::uuid
  and m.replaces_move_id is null
  and a.old_value ->> 'moveId' is not null;

-- ---------------------------------------------------------------------------
-- 6. The History of a student who moved branch reads the old branch's rows
-- with their ends and the moves with the move they replace (should-fix 3 of
-- the plan review). Decision 3 of 3.3c as before: ids, names, dates, causes
-- and links; nothing personal.
create or replace function student_rows_elsewhere(student uuid, branch uuid)
returns table (kind text, data jsonb)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with allowed as (
    select s.id from public.students s
    where s.id = student_rows_elsewhere.student
      and s.branch_id = student_rows_elsewhere.branch
      and student_rows_elsewhere.branch = any (public.app_branch_ids())
  )
  select 'class', jsonb_build_object(
      'id', m.id, 'branchId', m.branch_id, 'classId', m.class_id, 'grade', c.grade,
      'name', c.name, 'validFrom', m.valid_from, 'validUntil', m.valid_until,
      'ownUntil', m.own_until, 'cause', m.cause, 'endedBy', m.ended_by,
      'writtenByMoveId', m.written_by_move_id)
  from public.class_memberships m
  join allowed a on a.id = m.student_id
  join public.classes c on c.id = m.class_id
  where m.branch_id <> student_rows_elsewhere.branch
  union all
  select 'group', jsonb_build_object(
      'id', m.id, 'branchId', m.branch_id, 'groupId', m.group_id, 'name', g.name,
      'subjectId', m.subject_id, 'validFrom', m.valid_from, 'validUntil', m.valid_until,
      'ownUntil', m.own_until, 'cause', m.cause, 'endedBy', m.ended_by,
      'writtenByMoveId', m.written_by_move_id)
  from public.group_memberships m
  join allowed a on a.id = m.student_id
  join public.groups g on g.id = m.group_id
  where m.branch_id <> student_rows_elsewhere.branch
  union all
  select 'move', jsonb_build_object(
      'id', m.id, 'branchId', m.branch_id, 'kind', m.kind, 'subjectId', m.subject_id,
      'effectiveOn', m.effective_on, 'madeAt', m.made_at,
      'cancelled', m.cancelled_at is not null, 'undone', m.undone_at is not null,
      'cancelledByLeaving', m.cancelled_by_leaving_id is not null,
      'replacesMoveId', m.replaces_move_id,
      'fromClass', case when fc.id is null then null else
        jsonb_build_object('id', fc.id, 'grade', fc.grade, 'name', fc.name) end,
      'toClass', case when tc.id is null then null else
        jsonb_build_object('id', tc.id, 'grade', tc.grade, 'name', tc.name) end,
      'fromGroup', case when fg.id is null then null else
        jsonb_build_object('id', fg.id, 'name', fg.name) end,
      'toGroup', case when tg.id is null then null else
        jsonb_build_object('id', tg.id, 'name', tg.name) end)
  from public.student_moves m
  join allowed a on a.id = m.student_id
  left join public.classes fc on fc.id = m.from_class_id
  left join public.classes tc on tc.id = m.to_class_id
  left join public.groups fg on fg.id = m.from_group_id
  left join public.groups tg on tg.id = m.to_group_id
  where m.branch_id <> student_rows_elsewhere.branch
$$;

-- ---------------------------------------------------------------------------
-- 7. The rows already split are joined (H36; decision 4, Look first), class
-- rows first, then group rows, each chain pair by pair from its first row,
-- through the join path of item 2. One audit entry per student and branch of
-- the rows joined: ids and dates, nothing personal (actor empty: the system;
-- the moment of the transaction, as 0041).

create temporary table one_stay_joined (
  student_id uuid not null,
  branch_id uuid not null,
  kind text not null,
  kept_id uuid not null,
  joined_id uuid not null,
  joined_from date not null,
  joined_until date not null
) on commit drop;

do $$
declare
  pair record;
begin
  loop
    select a.id as kept_id, a.branch_id, a.student_id,
        b.id as joined_id, b.valid_from, b.valid_until, b.own_until, b.ended_by, b.leaving_id,
        b.ended_by_move_id, b.ended_by_branch_move_id
      into pair
      from class_memberships a
      join class_memberships b
        on b.student_id = a.student_id
        and b.class_id = a.class_id
        and b.valid_from = a.valid_until
        and b.id <> a.id
      where a.valid_from < a.valid_until and b.valid_from < b.valid_until
      order by a.valid_from, a.id
      limit 1;
    exit when not found;
    update class_memberships
      set valid_until = valid_from, ended_by = 'joined', joined_into_id = pair.kept_id,
        joined_xact = pg_current_xact_id(), leaving_id = null, ended_by_move_id = null,
        ended_by_branch_move_id = null
      where id = pair.joined_id;
    update class_memberships
      set valid_until = pair.valid_until, own_until = pair.own_until, ended_by = pair.ended_by,
        leaving_id = pair.leaving_id, ended_by_move_id = pair.ended_by_move_id,
        ended_by_branch_move_id = pair.ended_by_branch_move_id
      where id = pair.kept_id;
    insert into one_stay_joined values (
      pair.student_id, pair.branch_id, 'class', pair.kept_id, pair.joined_id,
      pair.valid_from, pair.valid_until
    );
  end loop;
  loop
    select a.id as kept_id, a.branch_id, a.student_id,
        b.id as joined_id, b.valid_from, b.valid_until, b.own_until, b.ended_by, b.leaving_id,
        b.ended_by_move_id, b.ended_by_branch_move_id
      into pair
      from group_memberships a
      join group_memberships b
        on b.student_id = a.student_id
        and b.group_id = a.group_id
        and b.valid_from = a.valid_until
        and b.id <> a.id
      where a.valid_from < a.valid_until and b.valid_from < b.valid_until
      order by a.valid_from, a.id
      limit 1;
    exit when not found;
    update group_memberships
      set valid_until = valid_from, ended_by = 'joined', joined_into_id = pair.kept_id,
        joined_xact = pg_current_xact_id(), leaving_id = null, ended_by_move_id = null,
        ended_by_branch_move_id = null
      where id = pair.joined_id;
    update group_memberships
      set valid_until = pair.valid_until, own_until = pair.own_until, ended_by = pair.ended_by,
        leaving_id = pair.leaving_id, ended_by_move_id = pair.ended_by_move_id,
        ended_by_branch_move_id = pair.ended_by_branch_move_id
      where id = pair.kept_id;
    insert into one_stay_joined values (
      pair.student_id, pair.branch_id, 'group', pair.kept_id, pair.joined_id,
      pair.valid_from, pair.valid_until
    );
  end loop;
end;
$$;

insert into audit_log (
  occurred_at, branch_id, actor_id, action, record_type, record_id, old_value, new_value, reason
)
select
  now(),
  j.branch_id,
  null,
  'student.stays_joined',
  'student',
  j.student_id,
  null,
  jsonb_build_object(
    'memberships', coalesce(jsonb_agg(jsonb_build_object(
      'keptId', j.kept_id, 'joinedId', j.joined_id, 'from', j.joined_from, 'until', j.joined_until
    ) order by j.joined_from) filter (where j.kind = 'class'), '[]'::jsonb),
    'groupMemberships', coalesce(jsonb_agg(jsonb_build_object(
      'keptId', j.kept_id, 'joinedId', j.joined_id, 'from', j.joined_from, 'until', j.joined_until
    ) order by j.joined_from) filter (where j.kind = 'group'), '[]'::jsonb)
  ),
  'One stay per class and group (task 3.5c)'
from one_stay_joined j
group by j.student_id, j.branch_id;

-- ---------------------------------------------------------------------------
-- 8. No two adjoining rows of one student in one class, or in one group
-- (decision 2, the done-when): on closed ranges a row that ends where the
-- next begins meets it; an empty row meets nothing. Deferred, so that a
-- merge's carry and its join meet in one transaction.
alter table class_memberships add constraint class_memberships_one_stay exclude using gist (
  student_id with =,
  class_id with =,
  daterange(valid_from, valid_until, '[]') with &&
) where (valid_from < valid_until) deferrable initially deferred;

alter table group_memberships add constraint group_memberships_one_stay exclude using gist (
  student_id with =,
  group_id with =,
  daterange(valid_from, valid_until, '[]') with &&
) where (valid_from < valid_until) deferrable initially deferred;
