-- 0109 Journal cells: the fixes of the spec review of the code of task 6.1a
-- (pull request #205). 0108 is applied where the build ran, so its fixes come
-- in a migration of their own.
--
-- 1. A cell of a cancelled lesson is not cleared either (decision 8;
--    edge/timetable, After publishing: "The entries are kept, struck through
--    and left out of every figure. Restoring the lesson brings them back").
-- 2. A student's cells with no value go with the student (decision 13;
--    edge/students-classes-groups, "A student is created twice by mistake":
--    the delete is allowed when "there is no attendance, number, ..."; an
--    empty cell is no data, edge/00-definitions). A cell with a value still
--    refuses the delete by its key.

create or replace function journal_cells_write() returns trigger
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
  select * into lesson_row from lessons l where l.id = new.lesson_id;
  if lesson_row.cancel_cause is not null then
    raise exception 'journal_cell_cancelled'
      using errcode = 'check_violation', constraint = 'journal_cell_cancelled';
  end if;
  if new.mark is null and new.score is null then
    -- A cleared value: allowed on a lesson that is not cancelled, the old
    -- value stays in the history.
    return new;
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

-- The student's empty cells first; the history lines stay. Runs as the
-- invoker: a cell of a branch the transaction does not see stays and its key
-- refuses the delete. `journal_cells_delete` (0108) lets this through
-- (trigger depth 2, no value).
create function students_clear_empty_cells() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  delete from journal_cells c
    where c.student_id = old.id and c.mark is null and c.score is null;
  return old;
end;
$$;

create trigger students_clear_empty_cells
  before delete on students
  for each row execute function students_clear_empty_cells();
