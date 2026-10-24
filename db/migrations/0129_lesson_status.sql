-- 0129 Lesson status: "not graded" cells and the assignment of orphan
-- lessons (task 8.7, pull request #225).
--
-- docs/spec/07-journal.md, Lesson status: "A present student left without a
-- number keeps the lesson in progress; the teacher can set those cells to
-- 'not graded' in one click, which completes the lesson and leaves them out
-- of the average." docs/spec/edge-cases/journal.md, Locks: "A teacher leaves
-- the school with incomplete lessons. They go to an 'orphan lessons' list.
-- The Academic Vice Principal assigns a teacher to complete them, with a
-- reason."
--
-- The plan approved on pull request #225: decisions 3 and 4 (Look first).
-- The status itself is never stored: it is worked out on each request
-- (`lessonStatusOf`, packages/shared/src/lesson-status.ts).

-- ---------------------------------------------------------------------------
-- "Not graded" (decision 3): a flag of a work's cell with no number. It is
-- left out of every average as an empty cell is (07, rule 4), and it is not
-- data on a lesson (edge/00-definitions). A typed number clears it.

alter table journal_cells
  add column not_graded boolean not null default false,
  add constraint journal_cells_not_graded_check check (
    not not_graded or (work_id is not null and score is null)
  );

grant insert (not_graded) on journal_cells to sodiq_app;
grant update (not_graded) on journal_cells to sodiq_app;

alter table journal_cell_history
  add column not_graded_before boolean not null default false,
  add column not_graded_after boolean not null default false;

-- A number clears the flag; a flag is set only where a number could be typed:
-- the work has a total and is held, and the student is expected. Named so it
-- runs between journal_cells_edit_guard and journal_cells_write (BEFORE
-- triggers run in the order of their names); it takes the memberships FOR
-- SHARE as journal_cells_write does for a value.
create function journal_cells_not_graded() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lesson_row lessons;
  work_row journal_works;
begin
  if new.score is not null then
    new.not_graded := false;
    return new;
  end if;
  -- An attendance cell is refused by journal_cells_not_graded_check.
  if new.work_id is null or not new.not_graded or (tg_op = 'UPDATE' and old.not_graded) then
    return new;
  end if;
  -- A restore of a forced delete gives back the cells as stored (0111).
  if new.changed_how = 'restored'
    or (tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id)) then
    return new;
  end if;
  select * into work_row from journal_works w where w.id = new.work_id for share;
  if work_row.total is null then
    raise exception 'journal_cell_no_total'
      using errcode = 'check_violation', constraint = 'journal_cell_no_total';
  end if;
  if work_row.not_held then
    raise exception 'journal_cell_not_held'
      using errcode = 'check_violation', constraint = 'journal_cell_not_held';
  end if;
  select * into lesson_row from lessons l where l.id = new.lesson_id;
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

create trigger journal_cells_not_graded
  before insert on journal_cells
  for each row execute function journal_cells_not_graded();
create trigger journal_cells_not_graded_update
  before update on journal_cells
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_cells_not_graded();

-- ---------------------------------------------------------------------------
-- The assignment of an orphan lesson (decision 4): the Academic Vice
-- Principal names a teacher of the branch who completes a held, incomplete
-- lesson whose teacher left the school, with a reason, for 1 to 7 days (the
-- shape of an unlock, 8.4 decision 4). Never deleted by the application; it
-- goes with a lesson removed by a forced delete.

create table journal_orphan_assignments (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  lesson_id uuid not null,
  -- The teacher who completes the lesson: a person active in the branch.
  staff_id uuid not null references staff (id),
  reason text not null constraint journal_orphan_assignments_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  days smallint not null constraint journal_orphan_assignments_days_check check (
    days between 1 and 7
  ),
  assigned_by uuid not null references accounts (id),
  -- The transaction's moment (the injected clock) and 00:00 of the branch day
  -- after the assignment day plus the days, by the trigger.
  assigned_at timestamptz not null,
  open_until timestamptz not null,
  withdrawn_by uuid references accounts (id),
  withdrawn_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_orphan_assignments_withdrawn_check check (
    (withdrawn_by is null) = (withdrawn_at is null)
  ),
  constraint journal_orphan_assignments_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade
);

-- One open assignment per lesson; a new one withdraws the open one first.
create unique index journal_orphan_assignments_open_key
  on journal_orphan_assignments (branch_id, lesson_id)
  where withdrawn_at is null;
create index journal_orphan_assignments_lesson_idx on journal_orphan_assignments (lesson_id);
create index journal_orphan_assignments_staff_idx on journal_orphan_assignments (staff_id);

alter table journal_orphan_assignments enable row level security;
create policy branch_filter on journal_orphan_assignments for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_orphan_assignments to sodiq_app;
grant insert (id, branch_id, lesson_id, staff_id, reason, days, assigned_by, assigned_at, open_until)
  on journal_orphan_assignments to sodiq_app;
grant update (withdrawn_by) on journal_orphan_assignments to sodiq_app;

-- The moments, the teacher's state and the one way of a withdraw.
create function journal_orphan_assignments_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  zone text;
  today date;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  select b.time_zone into zone from branches b where b.id = new.branch_id;
  today := (moment at time zone zone)::date;
  if tg_op = 'INSERT' then
    -- The staff row FOR SHARE: a status change of the teacher waits, then is seen.
    perform 1 from staff s where s.id = new.staff_id for share;
    if not exists (
      select 1 from staff s
      join staff_branches sb on sb.staff_id = s.id and sb.branch_id = new.branch_id
      where s.id = new.staff_id and s.kind = 'person'
    ) or exists (
      select 1 from staff_statuses st
      where st.staff_id = new.staff_id
        and st.status in ('inactive', 'left')
        and st.valid_from <= today
        and (st.valid_until is null or st.valid_until > today)
    ) then
      raise exception 'orphan_teacher_inactive'
        using errcode = 'check_violation', constraint = 'orphan_teacher_inactive';
    end if;
    new.assigned_at := moment;
    new.open_until := (((today + new.days + 1)::timestamp) at time zone zone);
    new.withdrawn_by := null;
    new.withdrawn_at := null;
    return new;
  end if;
  if old.withdrawn_at is not null or new.withdrawn_by is null then
    raise exception 'orphan_assignment_withdrawn'
      using errcode = 'check_violation', constraint = 'orphan_assignment_withdrawn';
  end if;
  new.withdrawn_at := moment;
  return new;
end;
$$;

create trigger journal_orphan_assignments_write
  before insert or update on journal_orphan_assignments
  for each row execute function journal_orphan_assignments_write();

-- Whether the open assignment named covers the account's person and the
-- lesson at the moment. The row is read FOR SHARE: a withdraw held open makes
-- the entry wait.
create function journal_orphan_covers(
  assignment_ref uuid,
  account_ref uuid,
  lesson_ref uuid,
  moment timestamptz
) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found_row journal_orphan_assignments;
begin
  if assignment_ref is null or lesson_ref is null then
    return false;
  end if;
  select * into found_row from journal_orphan_assignments a where a.id = assignment_ref for share;
  if not found then
    return false;
  end if;
  return found_row.withdrawn_at is null
    and found_row.lesson_id = lesson_ref
    and found_row.assigned_at <= moment
    and moment < found_row.open_until
    and exists (select 1 from staff s where s.id = found_row.staff_id and s.account_id = account_ref);
end;
$$;

grant execute on function journal_orphan_covers(uuid, uuid, uuid, timestamptz) to sodiq_app;

-- 0122's guard with the one new path of decision 4: from the lock, a write
-- of the person of the open orphan assignment named by
-- `app.orphan_assignment_id` passes as an unlock's does. Same name and
-- signature; otherwise unchanged.
create or replace function journal_edit_judge(
  branch_ref uuid,
  lock_at timestamptz,
  how text,
  writer uuid,
  reason text,
  lesson_ref uuid,
  journal_ref uuid,
  quarter_ref uuid
) returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if how not in (
    'entry', 'offline_entry', 'not_held', 'carry', 'deleted', 'undo', 'late_entry', 'correction'
  ) then
    return how;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    if session_user = 'sodiq_app' then
      raise exception 'journal_cell_moment'
        using errcode = 'check_violation', constraint = 'journal_cell_moment';
    end if;
    return how;
  end if;
  if how = 'correction' or coalesce(reason, '') <> '' then
    if length(btrim(coalesce(reason, ''))) = 0 then
      raise exception 'journal_correction_reason'
        using errcode = 'check_violation', constraint = 'journal_correction_reason';
    end if;
    if not journal_corrector(writer, branch_ref, moment) then
      raise exception 'journal_correction_role'
        using errcode = 'check_violation', constraint = 'journal_correction_role';
    end if;
    return case when how = 'deleted' then how else 'correction' end;
  end if;
  if lock_at is null or moment < lock_at then
    return how;
  end if;
  if not journal_unlock_covers(
    nullif(current_setting('app.unlock_id', true), '')::uuid,
    writer, lesson_ref, journal_ref, quarter_ref, moment
  ) and not journal_orphan_covers(
    nullif(current_setting('app.orphan_assignment_id', true), '')::uuid,
    writer, lesson_ref, moment
  ) then
    raise exception 'journal_locked'
      using errcode = 'check_violation', constraint = 'journal_locked';
  end if;
  return case when how in ('entry', 'offline_entry', 'not_held', 'carry') then 'late_entry' else how end;
end;
$$;

-- ---------------------------------------------------------------------------
-- The histories keep the orphan assignment a late write was made under, as
-- they keep the unlock (0122). The bodies of 0122 otherwise unchanged; the
-- cells' history also keeps "not graded" before and after.

alter table journal_cell_history add column orphan_assignment_id uuid;
alter table journal_work_history add column orphan_assignment_id uuid;
alter table journal_comment_history add column orphan_assignment_id uuid;

create function journal_line_orphan(how text) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when how in ('late_entry', 'undo', 'deleted') then
      nullif(current_setting('app.orphan_assignment_id', true), '')::uuid
  end
$$;

grant execute on function journal_line_orphan(text) to sodiq_app;

create or replace function journal_cells_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_before, mark_after, score_before, score_after, not_graded_before, not_graded_after,
      changed_by, changed_how, changed_at, reason, unlock_id, orphan_assignment_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      old.mark, new.mark, old.score, new.score, old.not_graded, new.not_graded,
      new.changed_by, new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how)
    );
  else
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_after, score_after, not_graded_after, changed_by, changed_how, changed_at, reason,
      unlock_id, orphan_assignment_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      new.mark, new.score, new.not_graded, new.changed_by, new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how)
    );
  end if;
  return null;
end;
$$;

create or replace function journal_works_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  author uuid;
begin
  if tg_op = 'INSERT' then
    if new.changed_how = 'restored' or forced_restore_names('lesson', new.lesson_id) then
      insert into journal_work_history (
        branch_id, work_id, lesson_id, source_lesson_id, kind, version, total_after,
        not_held_after, carried_from_after, plan_work_after, changed_by, changed_how, changed_at
      ) values (
        new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
        new.total, new.not_held, new.carried_from_lesson_id, new.plan_work_id, new.changed_by,
        'restored', coalesce(class_tutors_moment(), new.changed_at)
      );
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.total is not distinct from old.total
      and new.not_held = old.not_held
      and new.lesson_id = old.lesson_id
      and new.carried_from_lesson_id is not distinct from old.carried_from_lesson_id
      and new.plan_work_id is not distinct from old.plan_work_id then
      return null;
    end if;
    insert into journal_work_history (
      branch_id, work_id, lesson_id, source_lesson_id, kind, version,
      total_before, total_after, not_held_before, not_held_after, lesson_before,
      carried_from_after, plan_work_before, plan_work_after, changed_by, changed_how, changed_at,
      reason, unlock_id, orphan_assignment_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
      old.total, new.total, old.not_held, new.not_held,
      case when new.lesson_id <> old.lesson_id then old.lesson_id end,
      new.carried_from_lesson_id, old.plan_work_id, new.plan_work_id, new.changed_by,
      new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how)
    );
    return null;
  end if;
  moment := class_tutors_moment();
  select f.deleted_by into author from forced_deletes f
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
    limit 1;
  if author is null and pg_trigger_depth() > 1 and old.total is null and not old.not_held then
    return null;
  end if;
  if moment is null then
    if session_user <> 'sodiq_app' then
      return null;
    end if;
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  insert into journal_work_history (
    branch_id, work_id, lesson_id, source_lesson_id, kind, version,
    total_before, not_held_before, plan_work_before, changed_by, changed_how, changed_at,
    reason, unlock_id, orphan_assignment_id
  ) values (
    old.branch_id, old.id, old.lesson_id, old.source_lesson_id, old.kind, old.version + 1,
    old.total, old.not_held, old.plan_work_id, coalesce(author, old.changed_by),
    case when author is null then 'deleted' else 'forced_delete' end, moment,
    case when author is null then journal_line_reason('deleted') end,
    case when author is null then journal_line_unlock('deleted') end,
    case when author is null then journal_line_orphan('deleted') end
  );
  return null;
end;
$$;

create or replace function journal_comments_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  author uuid;
  moment timestamptz;
begin
  if tg_op = 'DELETE' then
    select f.deleted_by into author from forced_deletes f
      where f.created_xact = pg_current_xact_id()
        and f.record_type = 'lesson'
        and f.record_id = old.lesson_id
      limit 1;
    moment := class_tutors_moment();
    if moment is null then
      raise exception 'journal_cell_moment'
        using errcode = 'check_violation', constraint = 'journal_cell_moment';
    end if;
    insert into journal_comment_history (
      branch_id, comment_id, student_id, target, lesson_id, work_id, rating_exam_id, version,
      body_before, visibility_before, changed_by, changed_how, changed_at
    ) values (
      old.branch_id, old.id, old.student_id, old.target, old.lesson_id, old.work_id,
      old.rating_exam_id, old.version + 1, old.body, old.visibility, author, 'forced_delete', moment
    );
    return null;
  end if;
  if tg_op = 'UPDATE' and new.version = old.version then
    return null;
  end if;
  insert into journal_comment_history (
    branch_id, comment_id, student_id, target, lesson_id, work_id, rating_exam_id, version,
    body_before, body_after, visibility_before, visibility_after, changed_by, changed_how, changed_at,
    reason, unlock_id, orphan_assignment_id
  ) values (
    new.branch_id, new.id, new.student_id, new.target, new.lesson_id, new.work_id,
    new.rating_exam_id, new.version,
    case when tg_op = 'UPDATE' then old.body end, new.body,
    case when tg_op = 'UPDATE' then old.visibility end, new.visibility,
    new.changed_by, new.changed_how, coalesce(class_tutors_moment(), new.changed_at),
    journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
    journal_line_orphan(new.changed_how)
  );
  return null;
end;
$$;
