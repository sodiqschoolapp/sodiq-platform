-- 0186 Homework is graded at the lesson where it was given (task 11.24).
--
-- docs/spec/07-journal.md, Homework column: "A homework is graded at the
-- lesson where it was given (owner, 25 November 2026). Each homework of a
-- lesson's plan item is a homework column of that lesson ... No other lesson
-- has a column for it." docs/spec/edge-cases/journal.md, Entering: "Homework
-- numbers were saved before 25 November 2026 at a later lesson than the one
-- where the homework was given ... Once, on the change, each such homework
-- column moves with its total, "not held", numbers and comments to the lesson
-- where the homework was given ... Each move writes an audit entry and a line
-- in each cell's history. A number of a student who was exempt, or not yet in
-- the group, at the lesson where the homework was given does not move: it
-- leaves the averages and stays in the cell's history."
--
-- The plan approved on pull request #394 with corrections 1 and 2. The owner
-- approved this move, and only it, under stop item 3 (build plan, 11.24).
--
-- 1. The move mode: the migrator with `app.homework_move` on. Only this
--    migration writes in it; the guards of the journal let it through, and the
--    history triggers write its lines with the kind `homework_move` and no
--    author. No row of journal_cells, journal_works or journal_comments ever
--    holds that kind (their checks refuse it), so the application cannot use
--    it to pass a guard.
-- 2. A cell follows its work's lesson (`on update cascade`), as a comment does
--    (0120); a change of a cell's lesson alone is the cascade of the move and
--    nothing else (journal_cells_lesson_move).
-- 3. A work's lesson and its carry are fixed: a homework is stored at the
--    lesson where it was given (journal_works_at_source, validated in 0187).
-- 4. The move itself, refused as a whole, naming what it found, when a
--    homework to move lies in a closed or closing quarter, at a lesson whose
--    edit period has ended, at a cancelled source, or when a planned homework
--    would gain a column at such a lesson.

create function journal_homework_move_on() returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select session_user <> 'sodiq_app'
    and coalesce(current_setting('app.homework_move', true), '') = 'on'
$$;

grant execute on function journal_homework_move_on() to sodiq_app;

-- ---------------------------------------------------------------------------
-- The history tables take the move's lines: no author (the platform made the
-- change, `edge/journal`, "My grade disappeared."), the kind `homework_move`.
-- The checks are wider than before, so validating them cannot fail; they are
-- validated in 0187 so that no history table is scanned under this lock.

alter table journal_cell_history alter column changed_by drop not null;
alter table journal_comment_history alter column changed_by drop not null;

alter table journal_work_history
  drop constraint journal_work_history_changed_how_check,
  add constraint journal_work_history_changed_how_check check (
    changed_how in (
      'entry', 'not_held', 'carry', 'move', 'takeover', 'separation', 'restored', 'deleted',
      'forced_delete', 'late_entry', 'correction', 'homework_move'
    )
  ) not valid;

alter table journal_comment_history
  drop constraint journal_comment_history_changed_how_check,
  add constraint journal_comment_history_changed_how_check check (
    changed_how in (
      'entry', 'restored', 'forced_delete', 'late_entry', 'correction', 'transfer', 'leaving',
      'homework_move'
    )
  ) not valid;

-- ---------------------------------------------------------------------------
-- A work's lesson and its carry are fixed. The carry ("check at the next
-- lesson") and the move of an empty column to the next held lesson are gone
-- with the check lesson; only the move of this migration changes a lesson,
-- to the lesson where the homework was given, and it deletes no cell (the
-- cells follow by cascade). A carry whose lesson is removed (`on delete set
-- null`) may still lose its reference.

create or replace function journal_works_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  moment := class_tutors_moment();
  if moment is null and session_user = 'sodiq_app' then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    if new.carried_from_lesson_id is not null then
      raise exception 'journal_work_fixed'
        using errcode = 'check_violation', constraint = 'journal_work_fixed';
    end if;
    if not forced_restore_names('lesson', new.lesson_id) then
      new.version := 1;
      new.changed_at := moment;
    end if;
    return new;
  end if;
  if new.kind is distinct from old.kind
    or new.source_lesson_id is distinct from old.source_lesson_id
      and new.source_lesson_id is not null then
    raise exception 'journal_work_fixed'
      using errcode = 'check_violation', constraint = 'journal_work_fixed';
  end if;
  if new.lesson_id is distinct from old.lesson_id then
    if not (journal_homework_move_on() and new.lesson_id = old.source_lesson_id) then
      raise exception 'journal_work_fixed'
        using errcode = 'check_violation', constraint = 'journal_work_fixed';
    end if;
  end if;
  if new.carried_from_lesson_id is distinct from old.carried_from_lesson_id and not (
    new.carried_from_lesson_id is null and (
      journal_homework_move_on()
      or not exists (select 1 from lessons l where l.id = old.carried_from_lesson_id)
    )
  ) then
    raise exception 'journal_work_fixed'
      using errcode = 'check_violation', constraint = 'journal_work_fixed';
  end if;
  if journal_homework_move_on() then
    -- The row keeps its own kind and author; the move is in its history line.
    new.changed_how := old.changed_how;
    new.changed_by := old.changed_by;
  end if;
  if new.total is null and old.total is not null then
    raise exception 'journal_work_total_cleared'
      using errcode = 'check_violation', constraint = 'journal_work_total_cleared';
  end if;
  if new.total is distinct from old.total and exists (
    select 1 from journal_cells c where c.work_id = new.id and c.score > new.total
  ) then
    raise exception 'journal_work_total_below'
      using errcode = 'check_violation', constraint = 'journal_work_total_below';
  end if;
  if new.plan_work_id is distinct from old.plan_work_id then
    if new.plan_work_id is null or (
      old.plan_work_id is not null and not exists (
        select 1 from lesson_plan_works nw
        join lesson_plan_items ni on ni.id = nw.item_id
        join lesson_plan_works ow on ow.id = old.plan_work_id
        where nw.id = new.plan_work_id
          and ni.copied_from = ow.item_id
          and nw.kind = ow.kind
          and nw.position = ow.position
      )
    ) then
      raise exception 'journal_work_plan_link'
        using errcode = 'check_violation', constraint = 'journal_work_plan_link';
    end if;
  end if;
  new.version := old.version + 1;
  new.changed_at := moment;
  return new;
end;
$$;

revoke update (lesson_id, carried_from_lesson_id) on journal_works from sodiq_app;
revoke insert (carried_from_lesson_id) on journal_works from sodiq_app;

-- ---------------------------------------------------------------------------
-- The guards and history writers of the journal, as they stand, with the move
-- mode added: the guards let the migration's writes through (it checks them
-- itself, below), and the history writes the move's lines.

create or replace function journal_cells_edit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  lock_at timestamptz;
  plan_work uuid;
begin
  -- The homework move of 0186 (the migrator only) is checked by the migration.
  if journal_homework_move_on() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Only the clearing of an empty lesson and the works triggers delete a cell (0108, 0119).
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  lock_at := journal_lesson_lock(new.lesson_id);
  if new.changed_how in ('entry', 'offline_entry', 'not_held', 'undo')
    and coalesce(journal_correction_reason(), '') = ''
    and lock_at is not null and class_tutors_moment() >= lock_at
    and (exemption_reopened_open(new.lesson_id, new.student_id)
      or journal_optional_open(new.lesson_id, new.student_id)) then
    new.changed_how := case when new.changed_how = 'undo' then 'undo' else 'late_entry' end;
    return new;
  end if;
  if new.work_id is not null then
    select w.plan_work_id into plan_work from journal_works w where w.id = new.work_id;
  end if;
  new.changed_how := journal_edit_judge_work(
    new.branch_id, lock_at, new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, plan_work
  );
  return new;
end;
$function$;

create or replace function journal_comments_edit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  exam_row journal_rating_exams;
begin
  -- The homework move of 0186 (the migrator only) is checked by the migration.
  if journal_homework_move_on() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Only a forced delete of the lesson removes a comment (0120).
    return old;
  end if;
  if tg_op = 'INSERT' and new.changed_how = 'restored' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.body is not distinct from old.body
    and new.visibility = old.visibility then
    return new;
  end if;
  if new.rating_exam_id is not null then
    select * into exam_row from journal_rating_exams x where x.id = new.rating_exam_id;
    new.changed_how := journal_edit_judge(
      new.branch_id, journal_rating_lock(exam_row.journal_id, exam_row.quarter_id),
      new.changed_how, new.changed_by, journal_correction_reason(), null,
      exam_row.journal_id, exam_row.quarter_id
    );
  else
    new.changed_how := journal_edit_judge(
      new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
      journal_correction_reason(), new.lesson_id, null, null
    );
  end if;
  return new;
end;
$function$;

create or replace function journal_works_edit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- The homework move of 0186 (the migrator only) is checked by the migration.
  if journal_homework_move_on() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or forced_delete_names('lesson', old.lesson_id) then
      return old;
    end if;
    perform journal_edit_judge(
      old.branch_id, journal_lesson_lock(old.lesson_id), 'deleted', old.changed_by,
      journal_correction_reason(), old.lesson_id, null, null
    );
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.lesson_id is distinct from old.lesson_id then
    perform journal_edit_judge_work(
      old.branch_id, journal_lesson_lock(old.lesson_id), new.changed_how, new.changed_by,
      journal_correction_reason(), old.lesson_id, new.plan_work_id
    );
  end if;
  new.changed_how := journal_edit_judge_work(
    new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, new.plan_work_id
  );
  return new;
end;
$function$;

create or replace function journal_closed_quarter()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  row_new jsonb;
  row_old jsonb;
  quarter_ref uuid;
  journal_ref uuid;
  lesson_ref uuid;
begin
  -- The homework move of 0186 (the migrator only) is checked by the migration.
  if journal_homework_move_on() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- A person's delete goes through the judge (`deleted`), which checks it.
    return old;
  end if;
  row_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    row_old := to_jsonb(old);
    if (row_new - array['student_id', 'lesson_id']) = (row_old - array['student_id', 'lesson_id']) then
      return new;
    end if;
  end if;
  if tg_table_name = 'journal_rating_exams' then
    if (row_new -> 'exam_date', row_new -> 'not_held')
      is not distinct from (row_old -> 'exam_date', row_old -> 'not_held') then
      return new;
    end if;
    quarter_ref := (row_new ->> 'quarter_id')::uuid;
    journal_ref := (row_new ->> 'journal_id')::uuid;
    perform quarter_journal_open_guard(quarter_ref, journal_ref);
    -- The exam's date and "not held" in a reopened quarter: a corrector's only.
    if quarter_ever_closed(quarter_ref) and not journal_corrector(
      (row_new ->> 'changed_by')::uuid, new.branch_id, class_tutors_moment()
    ) and class_tutors_moment() is not null then
      raise exception 'journal_locked'
        using errcode = 'check_violation', constraint = 'journal_locked';
    end if;
    return new;
  end if;
  if coalesce(row_new ->> 'changed_how', '') not in (
    'entry', 'offline_entry', 'not_held', 'carry', 'deleted', 'undo', 'late_entry', 'correction'
  ) then
    return new;
  end if;
  if row_new ->> 'rating_exam_id' is not null then
    select x.quarter_id, x.journal_id into quarter_ref, journal_ref from journal_rating_exams x
      where x.id = (row_new ->> 'rating_exam_id')::uuid;
  else
    lesson_ref := (row_new ->> 'lesson_id')::uuid;
    quarter_ref := lesson_quarter(lesson_ref);
    journal_ref := lesson_journal(lesson_ref);
  end if;
  perform quarter_journal_open_guard(quarter_ref, journal_ref);
  perform journal_reopened_check(
    quarter_ref, journal_ref, lesson_ref, row_new ->> 'changed_how',
    (row_new ->> 'changed_by')::uuid, journal_correction_reason()
  );
  return new;
end
$function$;

create or replace function journal_works_not_given()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- The homework move of 0186 (the migrator only) is checked by the migration.
  if journal_homework_move_on() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if new.kind = 'homework' and new.plan_work_id is not null and new.source_lesson_id is not null
    and (new.total is not null or new.not_held or new.carried_from_lesson_id is not null)
    and new.changed_how not in ('move', 'separation', 'restored')
    and journal_homework_not_given_live(new.source_lesson_id, new.plan_work_id) then
    raise exception 'journal_work_not_given'
      using errcode = 'check_violation', constraint = 'journal_work_not_given';
  end if;
  return new;
end;
$function$;

create or replace function journal_cells_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op = 'UPDATE' then
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_before, mark_after, score_before, score_after, not_graded_before, not_graded_after,
      changed_by, changed_how, changed_at, reason, unlock_id, orphan_assignment_id,
      plan_request_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      old.mark, new.mark, old.score, new.score, old.not_graded, new.not_graded,
      case when journal_homework_move_on() then null else new.changed_by end,
      case when journal_homework_move_on() then 'homework_move' else new.changed_how end, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how), journal_line_plan_request(new.changed_how)
    );
  else
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_after, score_after, not_graded_after, changed_by, changed_how, changed_at, reason,
      unlock_id, orphan_assignment_id, plan_request_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      new.mark, new.score, new.not_graded, case when journal_homework_move_on() then null else new.changed_by end,
      case when journal_homework_move_on() then 'homework_move' else new.changed_how end, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how), journal_line_plan_request(new.changed_how)
    );
  end if;
  return null;
end;
$function$;

create or replace function journal_works_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  moment timestamptz;
  author uuid;
begin
  if tg_op = 'INSERT' then
    if new.changed_how = 'restored' or forced_restore_names('lesson', new.lesson_id) then
      insert into journal_work_history (
        branch_id, work_id, lesson_id, source_lesson_id, kind, version, total_after,
        not_held_after, carried_from_after, plan_work_after, title_after, changed_by,
        changed_how, changed_at
      ) values (
        new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
        new.total, new.not_held, new.carried_from_lesson_id, new.plan_work_id, new.title,
        new.changed_by, 'restored', coalesce(class_tutors_moment(), new.changed_at)
      );
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.total is not distinct from old.total
      and new.not_held = old.not_held
      and new.lesson_id = old.lesson_id
      and new.carried_from_lesson_id is not distinct from old.carried_from_lesson_id
      and new.plan_work_id is not distinct from old.plan_work_id
      and new.title is not distinct from old.title then
      return null;
    end if;
    insert into journal_work_history (
      branch_id, work_id, lesson_id, source_lesson_id, kind, version,
      total_before, total_after, not_held_before, not_held_after, lesson_before,
      carried_from_after, plan_work_before, plan_work_after, title_before, title_after,
      changed_by, changed_how, changed_at, reason, unlock_id, orphan_assignment_id,
      plan_request_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
      old.total, new.total, old.not_held, new.not_held,
      case when new.lesson_id <> old.lesson_id then old.lesson_id end,
      new.carried_from_lesson_id, old.plan_work_id, new.plan_work_id, old.title, new.title,
      case when journal_homework_move_on() then null else new.changed_by end,
      case when journal_homework_move_on() then 'homework_move' else new.changed_how end, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how), journal_line_plan_request(new.changed_how)
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
    total_before, not_held_before, plan_work_before, title_before, changed_by, changed_how,
    changed_at, reason, unlock_id, orphan_assignment_id
  ) values (
    old.branch_id, old.id, old.lesson_id, old.source_lesson_id, old.kind, old.version + 1,
    old.total, old.not_held, old.plan_work_id, old.title, coalesce(author, old.changed_by),
    case when author is null then 'deleted' else 'forced_delete' end, moment,
    case when author is null then journal_line_reason('deleted') end,
    case when author is null then journal_line_unlock('deleted') end,
    case when author is null then journal_line_orphan('deleted') end
  );
  return null;
end;
$function$;

create or replace function journal_comments_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    case when journal_homework_move_on() then null else new.changed_by end,
    case when journal_homework_move_on() then 'homework_move' else new.changed_how end,
    coalesce(class_tutors_moment(), new.changed_at),
    journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
    journal_line_orphan(new.changed_how)
  );
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- A cell follows its work's lesson. The key is added again with the cascade,
-- not valid here and validated in 0187 (journal_cells is the largest table of
-- the journal): the same columns and rows, so no row it refused is allowed.

alter table journal_cells drop constraint journal_cells_work_fkey;
alter table journal_cells
  add constraint journal_cells_work_fkey foreign key (work_id, lesson_id)
    references journal_works (id, lesson_id) on update cascade not valid;

-- The writers of a cell's change skip the cascade of its lesson; the cascade
-- is checked and written to the history by journal_cells_lesson_move.

drop trigger journal_cells_write_update on journal_cells;
create trigger journal_cells_write_update
  before update on journal_cells
  for each row
  when (old.student_id is not distinct from new.student_id
    and old.lesson_id is not distinct from new.lesson_id)
  execute function journal_cells_write();

drop trigger journal_cells_edit_guard_update on journal_cells;
create trigger journal_cells_edit_guard_update
  before update on journal_cells
  for each row
  when (old.student_id is not distinct from new.student_id
    and old.lesson_id is not distinct from new.lesson_id)
  execute function journal_cells_edit_guard();

drop trigger journal_cells_not_graded_update on journal_cells;
create trigger journal_cells_not_graded_update
  before update on journal_cells
  for each row
  when (old.student_id is not distinct from new.student_id
    and old.lesson_id is not distinct from new.lesson_id)
  execute function journal_cells_not_graded();

drop trigger journal_cells_history_update on journal_cells;
create trigger journal_cells_history_update
  after update on journal_cells
  for each row
  when (old.student_id is not distinct from new.student_id
    and old.lesson_id is not distinct from new.lesson_id)
  execute function journal_cells_history();

-- A cell's lesson changes only by the cascade of the move: in the move mode,
-- with nothing else of the cell changed. Its line keeps the cell's version
-- (the row's version, author, kind and moment are unchanged, so the markers
-- and the digest read the cell as before), with no author.
create function journal_cells_lesson_move() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not journal_homework_move_on()
    or (to_jsonb(new) - 'lesson_id') is distinct from (to_jsonb(old) - 'lesson_id') then
    raise exception 'journal_cell_lesson_fixed'
      using errcode = 'check_violation', constraint = 'journal_cell_lesson_fixed';
  end if;
  insert into journal_cell_history (
    branch_id, cell_id, lesson_id, student_id, work_id, version,
    mark_before, mark_after, score_before, score_after, not_graded_before, not_graded_after,
    changed_by, changed_how, changed_at
  ) values (
    new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
    old.mark, new.mark, old.score, new.score, old.not_graded, new.not_graded,
    null, 'homework_move', class_tutors_moment()
  );
  return null;
end;
$$;

create trigger journal_cells_lesson_move
  after update on journal_cells
  for each row
  when (old.lesson_id is distinct from new.lesson_id)
  execute function journal_cells_lesson_move();

-- ---------------------------------------------------------------------------
-- The move.

do $$
declare
  moment timestamptz;
  found_cases text;
begin
  -- The platform's own moment: `app.now` when the run sets it (the tests),
  -- otherwise the server's time with the demo clock's offset where one is
  -- kept (0156; the test environment).
  moment := class_tutors_moment();
  if moment is null then
    select now() + make_interval(secs => (
      case when now() >= c.effective_at then c.offset_ms else c.previous_offset_ms end
    ) / 1000.0)
      into moment
      from demo_clock c;
    moment := coalesce(moment, now());
    perform set_config('app.now', moment::text, true);
  end if;
  perform set_config('app.homework_move', 'on', true);

  create temporary table homework_moves on commit drop as
    select w.id, w.branch_id, w.kind, w.lesson_id as stored_at, w.source_lesson_id as given_at,
      w.carried_from_lesson_id as carried_from
    from journal_works w
    where w.source_lesson_id is not null and w.lesson_id <> w.source_lesson_id;

  -- A close in progress holds its quarter: wait for it, then read the state.
  perform 1 from quarters q
    where q.id in (
      select lesson_quarter(m.stored_at) from homework_moves m
      union select lesson_quarter(m.given_at) from homework_moves m
    )
    order by q.id
    for key share;

  with lesson_cases as (
    select m.id as work_id, l.id as lesson_id, l.lesson_date, l.cancel_cause,
      m.given_at = l.id as is_source, m.kind
    from homework_moves m
    join lessons l on l.id in (m.stored_at, m.given_at)
  ),
  move_cases as (
    select format(
      'work %s at %s (%s): %s', c.work_id, c.lesson_date,
      case when c.is_source then 'given' else 'stored' end, reason
    ) as line
    from lesson_cases c
    cross join lateral (
      select 'not a homework' as reason where c.kind <> 'homework' and c.is_source
      union all
      select 'cancelled' where c.cancel_cause is not null and c.is_source
      union all
      select 'quarter closed or closing'
        where quarter_ever_closed(lesson_quarter(c.lesson_id))
          or quarter_is_closed(lesson_quarter(c.lesson_id))
      union all
      select 'edit period ended' where journal_lesson_lock(c.lesson_id) <= moment
    ) r
  ),
  -- A planned homework with no stored row would become a column of its own
  -- held lesson: refused when that lesson is locked or its quarter closed
  -- (the owner's answer to question 3 of the proposal).
  planned_cases as (
    select format(
      'planned homework %s at %s: %s', pw.id, l.lesson_date,
      case when journal_lesson_lock(l.id) <= moment then 'edit period ended'
        else 'quarter closed or closing' end
    ) as line
    from (
      -- The plan row of each lesson, as the journal lays a plan on its lessons
      -- (journal-works.query.ts, planItemsOf): the place of the lesson among the
      -- journal's lessons of the quarter that are not cancelled, in order.
      -- lesson_plan_rows is only the snapshot of the last follow.
      select l.id as lesson_id, pj.plan_id, pj.journal_id,
        row_number() over (
          partition by pj.journal_id, pj.quarter_id order by l.starts_at, l.id
        ) as position
      from lessons l
      join lesson_plan_journals pj
        on pj.journal_id = lesson_journal(l.id) and pj.quarter_id = lesson_quarter(l.id)
      where l.cancel_cause is null
    ) r
    join lesson_plan_places p
      on p.plan_id = r.plan_id and p.journal_id = r.journal_id and p.position = r.position
    join lesson_plan_works pw on pw.item_id = p.item_id and pw.kind = 'homework'
    join lessons l on l.id = r.lesson_id
    where l.cancel_cause is null
      and l.starts_at <= moment
      and (
        journal_lesson_lock(l.id) <= moment
        or quarter_ever_closed(lesson_quarter(l.id))
        or quarter_is_closed(lesson_quarter(l.id))
      )
      and not journal_homework_not_given_live(l.id, pw.id)
      and not exists (
        select 1 from journal_works w
        where w.source_lesson_id = l.id and w.plan_work_id = pw.id
      )
  )
  select string_agg(line, E'\n' order by line) into found_cases
    from (select line from move_cases union all select line from planned_cases) c;
  if found_cases is not null then
    raise exception 'homework_move_refused: %', E'\n' || found_cases
      using errcode = 'check_violation', constraint = 'homework_move_refused';
  end if;

  -- The cells of students not expected at the lesson where the homework was
  -- given: their numbers do not move; they leave the averages and stay in the
  -- cell's history (the `homework_move` line holds them as the value before).
  create temporary table homework_left_out on commit drop as
    select c.id as cell_id, c.work_id, c.student_id, c.score, c.not_graded, m.given_at, m.stored_at
    from homework_moves m
    join journal_cells c on c.work_id = m.id and c.lesson_id = m.stored_at
    where not lesson_student_expected(m.given_at, c.student_id);

  update journal_cells c
    set score = null, not_graded = false
    from homework_left_out o
    where c.id = o.cell_id and (c.score is not null or c.not_graded);

  -- Their comments are cleared the same way, never deleted (correction 1).
  update journal_comments k
    set body = null
    from homework_left_out o
    where k.target = 'work' and k.work_id = o.work_id and k.student_id = o.student_id
      and k.body is not null;

  -- A value an exemption cleared at the old lesson follows its cell; one of a
  -- student left out has nothing to give back.
  update exemption_clears e
    set given_back_at = moment
    from homework_left_out o
    where e.cell_id = o.cell_id and e.given_back_at is null;
  update exemption_clears e
    set lesson_id = m.given_at
    from journal_cells c
    join homework_moves m on m.id = c.work_id
    where e.cell_id = c.id and e.lesson_id = m.stored_at;

  -- The works, and by cascade their cells and comments.
  update journal_works w
    set lesson_id = m.given_at, carried_from_lesson_id = null
    from homework_moves m
    where w.id = m.id;

  insert into audit_log (
    occurred_at, branch_id, actor_id, action, record_type, record_id, old_value, new_value, reason
  )
  select
    moment,
    m.branch_id,
    null,
    'journal.homework_move',
    'lesson',
    m.given_at,
    jsonb_build_object('lessonId', m.stored_at, 'carriedFrom', m.carried_from),
    jsonb_build_object(
      'workId', m.id,
      'lessonId', m.given_at,
      'cells', coalesce((
        select jsonb_agg(c.id order by c.id) from journal_cells c
        where c.work_id = m.id
          and not exists (select 1 from homework_left_out o where o.cell_id = c.id)
      ), '[]'::jsonb),
      'leftOut', coalesce((
        select jsonb_agg(jsonb_build_object(
          'cellId', o.cell_id, 'studentId', o.student_id, 'score', o.score,
          'notGraded', o.not_graded
        ) order by o.cell_id)
        from homework_left_out o where o.work_id = m.id
      ), '[]'::jsonb)
    ),
    'Homework is graded at the lesson where it was given (task 11.24)'
  from homework_moves m;

  perform set_config('app.homework_move', '', true);
end
$$;

-- ---------------------------------------------------------------------------
-- From now on a work is stored at the lesson where it was given. A work whose
-- source was removed (`on delete set null`) stays a column of its own lesson.
-- Validated in 0187.

alter table journal_works
  add constraint journal_works_at_source check (
    source_lesson_id is null or lesson_id = source_lesson_id
  ) not valid;
