-- 0108 Journal cells, their versions and their history (task 6.1a, pull
-- request #205).
--
-- docs/spec/edge-cases/developer-rules.md, Cells: "Unique on (lesson,
-- student, work). Each cell has a version number used to refuse stale
-- saves." History and audit: "Append-only: the application's database user
-- cannot update or delete them. Partitioned by month." docs/spec/07-journal.md,
-- Editing rules and locks: "Every cell keeps its history: old value, new
-- value, who and when." "A student's cells start on the date they joined the
-- class or group and end on the date they left. Other cells are closed."
-- docs/spec/edge-cases/00-definitions.md, Expected student and Data on a
-- lesson.
--
-- The plan approved on pull request #205 with corrections 1 and 2: decisions
-- 1 to 12. No route writes a cell yet (decision 2); the writer is
-- `saveCells` (apps/api/src/modules/journal/cells.ts).

-- ---------------------------------------------------------------------------
-- The works of a lesson, the minimum a cell's key needs; 8.1 adds the title,
-- the plan item, the unplanned flag, the position and the carry.

create table journal_works (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The lesson whose column it is: the classwork's lesson, the homework's
  -- check lesson. No action: a lesson with data is never deleted.
  lesson_id uuid not null,
  kind text not null constraint journal_works_kind_check check (kind in ('classwork', 'homework')),
  -- Null until the teacher sets it (edge/journal: "A total is from 1 to 1000").
  total integer constraint journal_works_total_check check (total between 1 and 1000),
  not_held boolean not null default false,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_works_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id),
  constraint journal_works_id_lesson_key unique (id, lesson_id)
);

create index journal_works_lesson_idx on journal_works (lesson_id);

alter table journal_works enable row level security;
create policy branch_filter on journal_works for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- No update until 8.1 writes totals and "not held" with their audit; a delete
-- only through the clearing of an empty lesson (below).
grant select, delete on journal_works to sodiq_app;
grant insert (id, branch_id, lesson_id, kind) on journal_works to sodiq_app;

-- ---------------------------------------------------------------------------
-- The cells.

create table journal_cells (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  lesson_id uuid not null,
  student_id uuid not null,
  -- Null for the attendance cell.
  work_id uuid,
  -- The typed attendance mark (07, Entering data). Marks 4 and 5 are never
  -- stored: they come from the exemption in force (decision 4).
  mark smallint constraint journal_cells_mark_check check (mark between 0 and 3),
  -- The typed number; its bound by the total is 8.1's (decision 6).
  score integer constraint journal_cells_score_check check (score >= 0),
  -- Written by journal_cells_write: 1 on insert, one more on every update.
  version integer not null,
  changed_by uuid not null references accounts (id),
  -- How the value came (edge/journal, "My grade disappeared"; decision 5).
  changed_how text not null constraint journal_cells_changed_how_check check (
    changed_how in (
      'entry', 'late_entry', 'correction', 'exemption', 'transfer', 'cancellation',
      'not_held', 'offline_entry', 'undo'
    )
  ),
  -- From the transaction's moment (the injected clock), written by the trigger.
  changed_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_cells_attendance_check check (work_id is not null or score is null),
  constraint journal_cells_work_check check (work_id is null or mark is null),
  -- No action on every key (task 2.4b-1, task 5.5b-1): a student or a lesson
  -- with data is never deleted.
  constraint journal_cells_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id),
  constraint journal_cells_student_fkey foreign key (student_id) references students (id),
  -- A work's cells are on the work's own lesson.
  constraint journal_cells_work_fkey foreign key (work_id, lesson_id)
    references journal_works (id, lesson_id),
  -- Cells (edge/developer-rules): one attendance cell per student and lesson
  -- too, since nulls are not distinct.
  constraint journal_cells_key unique nulls not distinct (branch_id, lesson_id, student_id, work_id)
);

create index journal_cells_lesson_idx on journal_cells (lesson_id);
create index journal_cells_student_idx on journal_cells (student_id);
create index journal_cells_work_idx on journal_cells (work_id) where work_id is not null;

alter table journal_cells enable row level security;
create policy branch_filter on journal_cells for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The version and the moment are overwritten by journal_cells_write; the
-- lesson, the student and the work never change.
grant select, delete on journal_cells to sodiq_app;
grant insert (id, branch_id, lesson_id, student_id, work_id, mark, score, version, changed_by, changed_how, changed_at)
  on journal_cells to sodiq_app;
grant update (mark, score, changed_by, changed_how) on journal_cells to sodiq_app;

-- ---------------------------------------------------------------------------
-- Who is expected in a lesson (edge/00-definitions, Expected student: "A
-- student who is a member of the class or group on the lesson's date and is
-- not exempt for that lesson"). The one definition of closed and expected;
-- 8.5 adds the exemption here. Run as the invoker.

create function lesson_student_expected(lesson_ref uuid, student_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from lessons l
    where l.id = lesson_ref
      and (
        exists (
          select 1 from class_memberships m
          where l.class_id is not null
            and m.class_id = l.class_id
            and m.student_id = student_ref
            and m.valid_from <= l.lesson_date
            and l.lesson_date < m.valid_until
        )
        or exists (
          select 1 from group_memberships m
          where l.group_id is not null
            and m.group_id = l.group_id
            and m.student_id = student_ref
            and m.valid_from <= l.lesson_date
            and l.lesson_date < m.valid_until
        )
      )
  );
$$;

create function lesson_expected_students(lesson_ref uuid) returns setof uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select s.student_id
  from (
    select m.student_id from lessons l
      join class_memberships m on m.class_id = l.class_id
      where l.id = lesson_ref
    union
    select m.student_id from lessons l
      join group_memberships m on m.group_id = l.group_id
      where l.id = lesson_ref
  ) s
  where lesson_student_expected(lesson_ref, s.student_id);
$$;

grant execute on function lesson_student_expected(uuid, uuid) to sodiq_app;
grant execute on function lesson_expected_students(uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The version, the moment, closed cells and cancelled lessons. Runs as the
-- invoker. The lesson row is read after `saveCells` locked it FOR SHARE, so a
-- cancel, a date move or a delete of the lesson waits for the save or the
-- save for it. The membership rows are locked FOR SHARE here, in a statement
-- of their own: share locks do not conflict with each other, and no
-- membership writer waits for a cell, so no cycle closes (decision 10).

create function journal_cells_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  lesson_row lessons;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  if new.mark is null and new.score is null then
    -- A cleared value: always allowed, the old value stays in the history.
    return new;
  end if;
  select * into lesson_row from lessons l where l.id = new.lesson_id;
  if lesson_row.cancel_cause is not null then
    raise exception 'journal_cell_cancelled'
      using errcode = 'check_violation', constraint = 'journal_cell_cancelled';
  end if;
  perform 1 from class_memberships m
    where lesson_row.class_id is not null
      and m.class_id = lesson_row.class_id
      and m.student_id = new.student_id
    for share;
  perform 1 from group_memberships m
    where lesson_row.group_id is not null
      and m.group_id = lesson_row.group_id
      and m.student_id = new.student_id
    for share;
  if not lesson_student_expected(new.lesson_id, new.student_id) then
    raise exception 'journal_cell_not_member'
      using errcode = 'check_violation', constraint = 'journal_cell_not_member';
  end if;
  return new;
end;
$$;

create trigger journal_cells_write
  before insert or update on journal_cells
  for each row execute function journal_cells_write();

-- ---------------------------------------------------------------------------
-- The history of every cell, written only by the trigger below, append-only
-- and partitioned by month (edge/developer-rules, History and audit).

create table journal_cell_history (
  id uuid not null default uuidv7(),
  branch_id uuid not null references branches (id),
  -- No key: the history outlives the cell.
  cell_id uuid not null,
  lesson_id uuid not null,
  student_id uuid not null,
  work_id uuid,
  version integer not null,
  mark_before smallint,
  mark_after smallint,
  score_before integer,
  score_after integer,
  changed_by uuid not null,
  changed_how text not null,
  -- The transaction's moment (the injected clock).
  changed_at timestamptz not null,
  -- Ties the line to the audit entries of its transaction.
  written_xact xid8 not null default pg_current_xact_id(),
  primary key (id, changed_at)
) partition by range (changed_at);

create index journal_cell_history_cell_idx on journal_cell_history (cell_id, version);
create index journal_cell_history_branch_idx on journal_cell_history (branch_id, changed_at);
create index journal_cell_history_xact_idx on journal_cell_history (written_xact);

alter table journal_cell_history enable row level security;
create policy branch_filter on journal_cell_history for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

do $$
declare
  month date;
  suffix text;
  partition name;
begin
  for month in
    select generate_series(date '2026-10-01', date '2029-12-01', interval '1 month')::date
  loop
    suffix := to_char(month, 'YYYY_MM');
    execute format(
      'create table public.%I partition of public.journal_cell_history for values from (%L) to (%L)',
      'journal_cell_history_' || suffix,
      to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  end loop;

  create table public.journal_cell_history_default partition of public.journal_cell_history default;

  for partition in
    select c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.journal_cell_history'::regclass
  loop
    execute format('alter table public.%I enable row level security', partition);
    execute format(
      'create policy branch_filter on public.%I for all to sodiq_app
         using (branch_id = any ((select public.app_branch_ids())::uuid[]))
         with check (branch_id = any ((select public.app_branch_ids())::uuid[]))',
      partition
    );
  end loop;
end
$$;

-- The trigger runs as the writer, so the application inserts; a direct insert
-- is refused by the depth guard of 0058. No update or delete.
grant select, insert on journal_cell_history to sodiq_app;

create trigger journal_cell_history_direct
  before insert on journal_cell_history
  for each row execute function timetable_trigger_only('journal_cell_history_direct');

create function journal_cells_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_before, mark_after, score_before, score_after, changed_by, changed_how, changed_at
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      old.mark, new.mark, old.score, new.score, new.changed_by, new.changed_how, new.changed_at
    );
  else
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_after, score_after, changed_by, changed_how, changed_at
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      new.mark, new.score, new.changed_by, new.changed_how, new.changed_at
    );
  end if;
  return null;
end;
$$;

create trigger journal_cells_history
  after insert or update on journal_cells
  for each row execute function journal_cells_history();

-- ---------------------------------------------------------------------------
-- Every line has an audit entry of its transaction in its branch (correction
-- 1): `lesson_history_unaudited` (0105), which Transactions.run asks before
-- every commit, reads both histories. Same name and signature.

create or replace function lesson_history_unaudited(xact xid8) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select xact is not null and (
    exists (
      select 1 from lesson_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_cell_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Data on a lesson (edge/00-definitions: "An attendance mark, a number, a
-- total, a 'not held' mark or a comment entered by a person"); comments join
-- with 8.2. 0105 is not edited.

create or replace function lesson_holds_data(lesson_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from journal_cells c
    where c.lesson_id = lesson_ref and (c.mark is not null or c.score is not null)
  )
  or exists (
    select 1 from journal_works w
    where w.lesson_id = lesson_ref and (w.total is not null or w.not_held)
  );
$$;

-- ---------------------------------------------------------------------------
-- A lesson whose cells and works hold no data is still removed (06, What a
-- change does to existing data: "Removed, if they hold no data"): its empty
-- rows go first. A lesson with data keeps them and lessons_delete_data (0105)
-- refuses it. Runs as the invoker.

create function lessons_clear_empty() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  delete from journal_cells c
    where c.lesson_id = old.id and c.mark is null and c.score is null;
  delete from journal_works w
    where w.lesson_id = old.id and w.total is null and not w.not_held
      and not exists (select 1 from journal_cells c where c.work_id = w.id);
  return old;
end;
$$;

create trigger lessons_clear_empty
  before delete on lessons
  for each row execute function lessons_clear_empty();

-- A cell or a work is deleted only by that clearing, and only with no data.
create function journal_cells_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() <= 1 or old.mark is not null or old.score is not null then
    raise exception 'journal_cell_delete'
      using errcode = 'check_violation', constraint = 'journal_cell_delete';
  end if;
  return old;
end;
$$;

create trigger journal_cells_delete
  before delete on journal_cells
  for each row execute function journal_cells_delete();

create function journal_works_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() <= 1 or old.total is not null or old.not_held then
    raise exception 'journal_cell_delete'
      using errcode = 'check_violation', constraint = 'journal_cell_delete';
  end if;
  return old;
end;
$$;

create trigger journal_works_delete
  before delete on journal_works
  for each row execute function journal_works_delete();
