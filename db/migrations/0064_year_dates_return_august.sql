-- 0064 The year's dates move with its stays (task 3.6b-2, pull request #120).
--
-- Owner's answer of 15 October 2026, L128: an academic year "may always be
-- made longer, and shorter only when no lesson with data, mark, attendance or
-- stay falls in the days cut off". 0045 refused every change of a year's dates
-- while a class of the year held a row; this replaces that rule.
-- docs/spec/edge-cases/time-dates-calendar.md, "The academic year is extended
-- or shortened". The plan and the corrections of its review: decisions 1 to 3
-- and corrections 1 and 2 of the review of pull request #120.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/setup/setup-refusals.ts).

-- ---------------------------------------------------------------------------
-- 1. One rule, one function: the class and group rows that stand in the days
-- a change of the year's dates cuts off. Read by the trigger below and by the
-- service, so that the two never drift (the route names what is in the way).
-- A row that holds days is in the way when
-- - it starts before a later start;
-- - the end moves earlier and it starts in the days cut off, ends by a dated
--   leaving or move inside them (or on the first of them), or is a row with
--   its own end inside them that is not the year's.
-- A row that runs to the year's last day (`own_until` = old end + 1, not ended
-- early) is not in the way: it follows the new last day (decision 1, Look
-- first). Runs as the invoker: the rows the branch filter lets the caller see.
create function year_cut_holds(year_id uuid, new_start date, new_end date)
returns table (
  kind text,
  row_id uuid,
  student_id uuid,
  holder_id uuid,
  valid_from date,
  valid_until date
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with year as (
    select y.start_date, y.end_date from academic_years y where y.id = year_id
  ), rows as (
    select 'class'::text as kind, m.id, m.student_id, m.class_id as holder_id,
      m.valid_from, m.valid_until, m.own_until
    from class_memberships m
    join classes c on c.id = m.class_id
    where c.academic_year_id = year_id and m.valid_from < m.valid_until
    union all
    select 'group'::text, m.id, m.student_id, m.group_id, m.valid_from, m.valid_until, m.own_until
    from group_memberships m
    join groups g on g.id = m.group_id
    where g.academic_year_id = year_id and m.valid_from < m.valid_until
  )
  select r.kind, r.id, r.student_id, r.holder_id, r.valid_from, r.valid_until
  from rows r, year y
  where r.valid_from < new_start
    or (
      new_end < y.end_date
      and (
        r.valid_from >= new_end + 1
        or (r.valid_until < r.own_until and r.valid_until >= new_end + 1)
        or (r.own_until > new_end + 1 and r.own_until <> y.end_date + 1)
      )
    )
  order by r.kind, r.valid_from, r.id
$$;

-- ---------------------------------------------------------------------------
-- 2. The guard replaces 0045's `academic_years_has_members` (decision 2).
drop trigger academic_years_has_members on academic_years;
drop function academic_years_has_members();

create function academic_years_dates_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (select 1 from year_cut_holds(new.id, new.start_date, new.end_date)) then
    raise exception 'academic_years_cut_holds'
      using errcode = 'check_violation', constraint = 'academic_years_cut_holds';
  end if;
  return new;
end;
$$;

create trigger academic_years_dates_guard
  before update of start_date, end_date on academic_years
  for each row
  when (new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date)
  execute function academic_years_dates_guard();

-- ---------------------------------------------------------------------------
-- 3. The follow (decision 3): the rows that run to the year's end move with
-- it. Row by row, by shape:
-- - a row in force to its own end: `own_until` and `valid_until` both move;
-- - a row cut early by a leaving or a move: `own_until` only, so that taking
--   the cut back later gives the row back to the new end and never past it;
-- - a row that holds no day because it was withdrawn, undone or joined is
--   final and untouched; so is a row that starts after the new last day.
-- The mark `app.year_follow` (year id, old end, new end) is a transaction
-- setting of its own, set here with `set_config(..., true)` and cleared after
-- the updates; the shrink rule below honours it only at trigger depth 2 and
-- only for exactly this shape.
create function academic_years_dates_follow() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform set_config(
    'app.year_follow',
    new.id::text || '|' || old.end_date::text || '|' || new.end_date::text,
    true
  );
  update class_memberships m
    set own_until = new.end_date + 1,
        valid_until = case when m.valid_until = m.own_until then new.end_date + 1 else m.valid_until end
    from classes c
    where c.id = m.class_id
      and c.academic_year_id = new.id
      and m.own_until = old.end_date + 1
      and (m.ended_by is null or m.ended_by in ('leaving', 'transfer', 'branch_move', 'merge'))
      and m.valid_from < new.end_date + 1;
  update group_memberships m
    set own_until = new.end_date + 1,
        valid_until = case when m.valid_until = m.own_until then new.end_date + 1 else m.valid_until end
    from groups g
    where g.id = m.group_id
      and g.academic_year_id = new.id
      and m.own_until = old.end_date + 1
      and (m.ended_by is null or m.ended_by in ('leaving', 'transfer', 'branch_move', 'merge'))
      and m.valid_from < new.end_date + 1;
  perform set_config('app.year_follow', '', true);
  return null;
end;
$$;

create trigger academic_years_dates_follow
  after update of end_date on academic_years
  for each row
  when (new.end_date is distinct from old.end_date)
  execute function academic_years_dates_follow();

-- Whether an update of a membership row is exactly the follow's: written at
-- trigger depth 2 under the mark, the row of a class or group of the marked
-- year, its own end moving from the old end + 1 to the year's end + 1 as the
-- year now stands, its end in force moving with it only where it was at its
-- own end, and no other column changing (`.claude/rules/database.md`, "A path
-- of a trigger that waives checks ... exactly what justified the waiver").
create function membership_year_follow(
  old_row jsonb,
  new_row jsonb,
  holder_year uuid
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  mark text := nullif(current_setting('app.year_follow', true), '');
  parts text[];
  year_end date;
begin
  if mark is null or pg_trigger_depth() < 2 then
    return false;
  end if;
  parts := string_to_array(mark, '|');
  if array_length(parts, 1) <> 3 or holder_year is distinct from parts[1]::uuid then
    return false;
  end if;
  select y.end_date into year_end from academic_years y where y.id = holder_year;
  return year_end is not null
    and year_end = parts[3]::date
    and (new_row - 'own_until' - 'valid_until') = (old_row - 'own_until' - 'valid_until')
    and (old_row ->> 'own_until')::date = parts[2]::date + 1
    and (new_row ->> 'own_until')::date = year_end + 1
    and (old_row ->> 'valid_from')::date < year_end + 1
    and (old_row ->> 'ended_by' is null
      or old_row ->> 'ended_by' in ('leaving', 'transfer', 'branch_move', 'merge'))
    and (new_row ->> 'valid_until')::date = case
      when old_row ->> 'valid_until' = old_row ->> 'own_until' then year_end + 1
      else (old_row ->> 'valid_until')::date
    end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The shrink rule of 0062 with one path added (decision 3, Look first,
-- correction 2 of the review): a row may move its own end, and its end in
-- force with it, only in the exact shape of the follow above. Every other
-- rule as in 0062; an application write grows nothing.

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
  -- The follow of a year's new last day (decision 3 of 3.6b-2): exactly its
  -- shape, written by `academic_years_dates_follow`, and nothing else grows
  -- or moves an own end.
  if (to_jsonb(new) - 'valid_until' - 'own_until') = (to_jsonb(old) - 'valid_until' - 'own_until')
    and (new.own_until <> old.own_until or new.valid_until <> old.valid_until)
    and old.ended_by is not distinct from new.ended_by
    and membership_year_follow(
      to_jsonb(old), to_jsonb(new),
      (select h.academic_year_id from classes h where h.id = new.class_id)
    ) then
    return new;
  end if;
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
      or (new.ended_by is not null and new.ended_by not in ('leaving', 'transfer'))
      or (new.ended_by = 'leaving' and not membership_leaving_stands(new.leaving_id, new.valid_until)) then
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
  -- The follow of a year's new last day (decision 3 of 3.6b-2): exactly its
  -- shape, written by `academic_years_dates_follow`, and nothing else grows
  -- or moves an own end.
  if (to_jsonb(new) - 'valid_until' - 'own_until') = (to_jsonb(old) - 'valid_until' - 'own_until')
    and (new.own_until <> old.own_until or new.valid_until <> old.valid_until)
    and old.ended_by is not distinct from new.ended_by
    and membership_year_follow(
      to_jsonb(old), to_jsonb(new),
      (select h.academic_year_id from groups h where h.id = new.group_id)
    ) then
    return new;
  end if;
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
      or (new.ended_by is not null and new.ended_by not in ('leaving', 'transfer'))
      or (new.ended_by = 'leaving' and not membership_leaving_stands(new.leaving_id, new.valid_until)) then
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

