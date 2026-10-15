-- 0054 The merge of two student records (task 3.3d, pull request #98).
--
-- docs/spec/edge-cases/students-classes-groups.md, "A student who left in
-- 2025 is created again as new": "The Super Admin can merge two records; the
-- older UID survives." "A student is created twice by mistake. ... Otherwise
-- 'leave' or the merge is used." docs/spec/04-people.md, UID sets: a UID
-- "stays with the student for good ... and it is never given to another
-- student"; "Every student ... has one profile that keeps its full history."
--
-- The plan approved on pull request #98 with corrections 1 to 5. A merge is a
-- row of `student_merges`, written first in the Super Admin's transaction;
-- every row of the merged record is then carried to the kept record, cut at
-- its tail or left behind (decision 4), and the merged record is removed and
-- archived whole on the merge row (`merged_record`, `left_rows`; decision 1).
-- Its UIDs stay in `student_uids`, released, so they are never given again.
--
-- Decision 2 (Look first): the guards below gain a merge path, each passing
-- only with a merge of exactly the two records written in this transaction
-- (`student_merge_here`); none is taken away, and nothing named in
-- edge/developer-rules (the overlap exclusions, the peak functions,
-- group_memberships_in_class, class_memberships_need_groups,
-- class_memberships_active) changes: they check every row carried or cut.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/people/student-merges.ts).

-- One merge: the record merged into the kept one, archived whole. The row
-- belongs to the kept record's branch and follows it (the key below), so a
-- later branch holds every merge of the record. `merged_id` has no key: that
-- record is removed by the merge.
create table student_merges (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  kept_id uuid not null,
  merged_id uuid not null,
  merged_branch_id uuid not null references branches (id),
  kept_uid text not null constraint student_merges_kept_uid_check check (kept_uid ~ '^[0-9]{7}$'),
  merged_uid text not null constraint student_merges_merged_uid_check check (merged_uid ~ '^[0-9]{7}$'),
  -- Every UID the merged record held, its current one first; a search or a
  -- UID check by any of them leads to the kept record.
  merged_uids text[] not null,
  -- The merged record's every column, as it was before the merge.
  merged_record jsonb not null,
  -- Every row of either record the merge did not carry, whole, by table.
  left_rows jsonb not null,
  reason text not null constraint student_merges_reason_check check (
    reason = btrim(reason) and length(reason) between 1 and 500
  ),
  merged_by uuid not null references accounts (id),
  assignment_id uuid references assignments (id),
  -- The moment of the merge, from the injected clock.
  merged_at timestamptz not null,
  -- The transaction that merged; `student_merge_here` reads it.
  merged_xact xid8 not null default pg_current_xact_id(),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint student_merges_kept_fkey foreign key (kept_id, branch_id)
    references students (id, branch_id) on update cascade,
  constraint student_merges_pair_check check (kept_id <> merged_id),
  constraint student_merges_uids_check check (
    merged_uids[1] = merged_uid and cardinality(merged_uids) between 1 and 100
  )
);

create unique index student_merges_merged_uid_idx on student_merges (merged_uid);
create unique index student_merges_merged_idx on student_merges (merged_id);
create index student_merges_kept_idx on student_merges (kept_id);
create index student_merges_branch_idx on student_merges (branch_id);
create index student_merges_uids_idx on student_merges using gin (merged_uids);
create index student_merges_xact_idx on student_merges (merged_xact);

alter table student_merges enable row level security;
create policy branch_filter on student_merges for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on student_merges to sodiq_app;
grant insert (branch_id, kept_id, merged_id, merged_branch_id, kept_uid, merged_uid, merged_uids,
  merged_record, left_rows, reason, merged_by, assignment_id, merged_at)
  on student_merges to sodiq_app;
grant update (kept_id, branch_id) on student_merges to sodiq_app;

-- Whether a merge of the pair {a, b}, either way, was written in the current
-- transaction.
create function student_merge_here(a uuid, b uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from student_merges m
    where m.merged_xact = pg_current_xact_id()
      and ((m.kept_id = a and m.merged_id = b) or (m.kept_id = b and m.merged_id = a))
  )
$$;

-- Whether a merge naming the student, kept or merged, was written in the
-- current transaction.
create function student_merging_here(student uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from student_merges m
    where m.merged_xact = pg_current_xact_id()
      and (m.kept_id = student or m.merged_id = student)
  )
$$;

-- A new merge: of two records that exist, each in its branch, with their
-- current UIDs, at the transaction's moment. For every user. Runs as the
-- invoker.
create function student_merges_insert_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform 1 from students s where s.id in (new.kept_id, new.merged_id) order by s.id for update;
  if not exists (
      select 1 from students s
      where s.id = new.kept_id and s.branch_id = new.branch_id and s.uid = new.kept_uid
    )
    or not exists (
      select 1 from students s
      where s.id = new.merged_id and s.branch_id = new.merged_branch_id and s.uid = new.merged_uid
    )
    or new.merged_at is distinct from nullif(current_setting('app.now', true), '')::timestamptz then
    raise exception 'student_merges_state'
      using errcode = 'check_violation', constraint = 'student_merges_state';
  end if;
  new.merged_xact := pg_current_xact_id();
  return new;
end;
$$;

create trigger student_merges_insert_guard
  before insert on student_merges
  for each row execute function student_merges_insert_guard();

-- A merge is final. Its branch follows the kept record (the cascade of the
-- key; the key keeps it the record's own branch). Its kept record changes
-- only to the record it was merged into in this transaction (a chain: A
-- merged into B, then B into C: A's row names C). For every user. Runs as
-- the invoker.
create function student_merges_state() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (to_jsonb(new) - 'kept_id' - 'branch_id') is distinct from (to_jsonb(old) - 'kept_id' - 'branch_id')
    or (new.kept_id is distinct from old.kept_id and not exists (
      select 1 from student_merges m
      where m.merged_xact = pg_current_xact_id()
        and m.merged_id = old.kept_id
        and m.kept_id = new.kept_id
    )) then
    raise exception 'student_merges_state'
      using errcode = 'check_violation', constraint = 'student_merges_state';
  end if;
  return new;
end;
$$;

create trigger student_merges_state
  before update on student_merges
  for each row execute function student_merges_state();

-- The branch of a student changes from a move accepted in this transaction
-- (0053), or, for the kept record of a merge written in it, to the merged
-- record's branch: the later life's (decision 7). Never otherwise.
create or replace function students_branch_move() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not student_branch_move_accepted_here(old.id, old.branch_id, new.branch_id)
    and not exists (
      select 1 from student_merges m
      where m.merged_xact = pg_current_xact_id()
        and m.kept_id = old.id
        and m.merged_branch_id = new.branch_id
    ) then
    raise exception 'students_branch_move'
      using errcode = 'check_violation', constraint = 'students_branch_move';
  end if;
  return new;
end;
$$;

-- The start of a student's life (0032 fixes it at the create, where the
-- first status row starts) changes only for the kept record of a merge
-- written in this transaction: to the first day of the joined life.
create function students_starts_on() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from student_merges m
    where m.merged_xact = pg_current_xact_id() and m.kept_id = old.id
  ) then
    raise exception 'students_starts_on'
      using errcode = 'check_violation', constraint = 'students_starts_on';
  end if;
  return new;
end;
$$;

create trigger students_starts_on
  before update of starts_on on students
  for each row
  when (new.starts_on is distinct from old.starts_on)
  execute function students_starts_on();

grant update (starts_on) on students to sodiq_app;

-- The delete guard of 0033 with one path added: the merged record of a merge
-- written in this transaction is removed whatever it holds, its rows carried
-- or archived on the merge row.
create or replace function students_delete_guard() returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from student_merges m
    where m.merged_xact = pg_current_xact_id() and m.merged_id = old.id
  ) then
    return old;
  end if;
  if old.scholarship_type <> 'none'
    or exists (
      select 1 from student_statuses ss
      where ss.student_id = old.id
        and ss.status <> 'active'
        and ss.valid_from < coalesce(ss.valid_until, 'infinity'::date)
    )
    or (select count(*) from student_contracts sc where sc.student_id = old.id) > 1 then
    raise exception 'students_delete_guard'
      using errcode = 'check_violation', constraint = 'students_delete_guard';
  end if;
  return old;
end
$$;

-- The shrink rule of 0033 for status rows with one path added: a row goes to
-- the other record of a merge written in this transaction (with the kept
-- record's branch). Every other rule as before.
create or replace function student_statuses_only_shrink() returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'valid_until' - 'branch_id' - 'student_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'branch_id' - 'student_id')
    or (new.student_id is distinct from old.student_id
      and not student_merge_here(old.student_id, new.student_id))
    or (old.valid_until is not null
      and (new.valid_until is null or new.valid_until > old.valid_until)) then
    raise exception 'dated_rows_only_shrink'
      using errcode = 'check_violation', constraint = 'dated_rows_only_shrink';
  end if;
  return new;
end
$$;

-- The status guard of 0053 with one path added: a cut made while a merge of
-- the student is written in this transaction. The joined life is decided in
-- the Super Admin's transaction, which sees every branch, and
-- `class_memberships_active` checks it at the commit.
create or replace function student_statuses_branch_move() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  day date;
begin
  if tg_op = 'INSERT' then
    day := new.valid_from;
  else
    day := new.valid_until;
    if student_merging_here(new.student_id) then
      return new;
    end if;
  end if;
  if day is not null and exists (
    select 1 from student_branch_moves m
    where m.student_id = new.student_id
      and m.accepted_at is not null
      and m.effective_on > day
  ) then
    raise exception 'student_statuses_before_branch_move'
      using errcode = 'check_violation', constraint = 'student_statuses_before_branch_move';
  end if;
  return new;
end;
$$;

-- A contract goes to the other record of a merge written in this
-- transaction; its branch follows the record (the cascade, or the merge with
-- the kept record's branch; the key keeps it the record's own). Number and
-- date are corrected by the edit as before.
create function student_contracts_student() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.student_id is distinct from old.student_id
    and not student_merge_here(old.student_id, new.student_id) then
    raise exception 'student_contracts_student'
      using errcode = 'check_violation', constraint = 'student_contracts_student';
  end if;
  return new;
end;
$$;

create trigger student_contracts_student
  before update on student_contracts
  for each row execute function student_contracts_student();

grant update (student_id, branch_id) on student_contracts to sodiq_app;
grant update (student_id, branch_id) on student_statuses to sodiq_app;

-- The state rule of 0050 for moves with one path added: a move goes to the
-- other record of a merge written in this transaction, nothing else of it
-- changing. Every other rule as before.
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

grant update (student_id) on student_moves to sodiq_app;

-- The state rule of 0053 for branch moves with one path added: a branch
-- move goes to the other record of a merge written in this transaction, with
-- the kept record's branch, or follows the kept record into the merged
-- record's branch (the cascade), nothing else of it changing.
create or replace function student_branch_moves_state() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz := nullif(current_setting('app.now', true), '')::timestamptz;
begin
  if new.student_id is distinct from old.student_id then
    if (to_jsonb(new) - 'branch_id' - 'student_id') is distinct from (to_jsonb(old) - 'branch_id' - 'student_id')
      or not student_merge_here(old.student_id, new.student_id) then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    return new;
  end if;
  if new.branch_id is distinct from old.branch_id then
    if (to_jsonb(new) - 'branch_id') is distinct from (to_jsonb(old) - 'branch_id')
      or not (
        student_branch_move_accepted_here(new.student_id, old.branch_id, new.branch_id)
        or exists (
          select 1 from student_merges m
          where m.merged_xact = pg_current_xact_id()
            and m.kept_id = new.student_id
            and m.merged_branch_id = new.branch_id
        )
      ) then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'cancelled_at' - 'declined_at' - 'accepted_at' - 'accepted_xact'
        - 'decline_reason' - 'cancelled_by_leaving_id')
      is distinct from (to_jsonb(old) - 'cancelled_at' - 'declined_at' - 'accepted_at'
        - 'accepted_xact' - 'decline_reason' - 'cancelled_by_leaving_id')
    or new.accepted_xact is distinct from old.accepted_xact
    or old.cancelled_at is not null
    or old.declined_at is not null
    or old.accepted_at is not null then
    raise exception 'student_branch_moves_state'
      using errcode = 'check_violation', constraint = 'student_branch_moves_state';
  end if;
  if new.accepted_at is not null then
    if new.accepted_at is distinct from moment then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    if not (new.to_branch_id = any (app_branch_ids())) then
      raise exception 'student_branch_moves_side'
        using errcode = 'check_violation', constraint = 'student_branch_moves_side';
    end if;
    if coalesce(branch_today(new.to_branch_id) < new.effective_on, true) then
      raise exception 'student_branch_moves_not_yet'
        using errcode = 'check_violation', constraint = 'student_branch_moves_not_yet';
    end if;
    new.accepted_xact := pg_current_xact_id();
  end if;
  if new.declined_at is not null then
    if new.declined_at is distinct from moment then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    if not (new.to_branch_id = any (app_branch_ids())) then
      raise exception 'student_branch_moves_side'
        using errcode = 'check_violation', constraint = 'student_branch_moves_side';
    end if;
  end if;
  if new.cancelled_at is not null then
    if new.cancelled_at is distinct from moment then
      raise exception 'student_branch_moves_state'
        using errcode = 'check_violation', constraint = 'student_branch_moves_state';
    end if;
    if not (new.from_branch_id = any (app_branch_ids())) then
      raise exception 'student_branch_moves_side'
        using errcode = 'check_violation', constraint = 'student_branch_moves_side';
    end if;
  end if;
  return new;
end;
$$;

grant update (student_id, branch_id) on student_branch_moves to sodiq_app;

-- Decision 4: the end `merge`, a row of the side that loses days cut at its
-- first lost day. Such a row keeps its days before it; it is final.
alter table class_memberships drop constraint class_memberships_ended_by_check;
alter table class_memberships add constraint class_memberships_ended_by_check check (
  ended_by in ('leaving', 'withdrawn', 'transfer', 'undone', 'branch_move', 'merge')
);
alter table group_memberships drop constraint group_memberships_ended_by_check;
alter table group_memberships add constraint group_memberships_ended_by_check check (
  ended_by in ('leaving', 'withdrawn', 'class_withdrawn', 'transfer', 'undone', 'branch_move', 'merge')
);
alter table group_memberships drop constraint group_memberships_withdrawn_check;
alter table group_memberships add constraint group_memberships_withdrawn_check check (
  ended_by is null or ended_by in ('leaving', 'transfer', 'branch_move', 'merge')
    or valid_until = valid_from
);

-- The shrink rule of 0053 for class rows with the merge path added; none
-- taken away. A row goes to the other record of a merge written in this
-- transaction (the student, nothing else, guarded by `memberships_merge`); a
-- row ended by a merge is final. Every other rule as in 0053.
create or replace function class_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'ended_by_move_id'
        - 'ended_by_branch_move_id' - 'student_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id'
        - 'ended_by_move_id' - 'ended_by_branch_move_id' - 'student_id')
    or new.valid_until > old.valid_until
    or old.ended_by in ('withdrawn', 'undone')
    or (old.ended_by in ('leaving', 'transfer', 'branch_move', 'merge') and new.ended_by is null)
    or (old.ended_by in ('branch_move', 'merge')
      and (new.ended_by is distinct from old.ended_by or new.valid_until <> old.valid_until)) then
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
  if new.valid_until <> old.valid_until then
    perform 1 from classes c where c.id = new.class_id for share;
    select c.academic_year_id into year_id from classes c where c.id = new.class_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

-- The same for group rows.
create or replace function group_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review' - 'ended_by_move_id'
        - 'ended_by_branch_move_id' - 'student_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id' - 'review'
        - 'ended_by_move_id' - 'ended_by_branch_move_id' - 'student_id')
    or new.valid_until > old.valid_until
    or old.ended_by in ('withdrawn', 'class_withdrawn', 'undone')
    or (old.ended_by in ('leaving', 'transfer', 'branch_move', 'merge') and new.ended_by is null)
    or (old.ended_by in ('branch_move', 'merge')
      and (new.ended_by is distinct from old.ended_by or new.valid_until <> old.valid_until))
    or (new.review and not old.review) then
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
  if new.valid_until <> old.valid_until then
    perform 1 from groups g where g.id = new.group_id for share;
    select g.academic_year_id into year_id from groups g where g.id = new.group_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

-- What a merge writes on a class or group row: the student changes only to
-- the other record of a merge written in this transaction, alone; a row is
-- ended by `merge` only from no end, while a merge of its student is written
-- in this transaction; a row is never inserted ended by a merge. A trigger of
-- its own beside the shrink triggers, for both membership tables. For every
-- user. Runs as the invoker.
create function memberships_merge() returns trigger
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

create trigger class_memberships_merge
  before insert or update on class_memberships
  for each row execute function memberships_merge();

create trigger group_memberships_merge
  before insert or update on group_memberships
  for each row execute function memberships_merge();

grant update (student_id) on class_memberships to sodiq_app;
grant update (student_id) on group_memberships to sodiq_app;

-- Decision 6 (Look first, correction 2): the record a merged UID leads to,
-- for the branch of the request named by the caller: the kept record's id
-- when it is of that branch, a row with no id when it is of another branch,
-- no row when the UID was never merged. Nothing else of the record. Read by
-- the UID check of the create and the correction, and by the searches.
create function student_merged_uid_holder(uid text, branch uuid)
returns table (student_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when s.branch_id = student_merged_uid_holder.branch then s.id end
  from public.student_merges m
  join public.students s on s.id = m.kept_id
  where student_merged_uid_holder.uid = any (m.merged_uids)
    and student_merged_uid_holder.branch = any (public.app_branch_ids())
  limit 1
$$;

revoke execute on function student_merged_uid_holder(text, uuid) from public;
grant execute on function student_merged_uid_holder(text, uuid) to sodiq_app;
