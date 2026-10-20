-- 0093 Quarter and year dates after lessons exist (task 5.6b-5a, pull request
-- #179, decisions 2 to 8 and spec review of the plan, must-fix 1).
--
-- docs/spec/edge-cases/time-dates-calendar.md, "Quarter dates are edited
-- after lessons exist": "Every school day lies in exactly one quarter. ... A
-- boundary can move only over future dates, so a held lesson never changes
-- quarter." docs/spec/edge-cases/00-definitions.md, Quarter of a lesson: "The
-- quarter that contains its date. It is stored on the lesson." The From lines
-- of 5.1a and 5.1b: `lesson_block_quarter` and `exam_year` run only on writes
-- to `lesson_blocks` and `exams`; this migration guards the other side, the
-- quarter's and the year's dates, and closes the moment between the two.
--
-- A block dated today or earlier never changes quarter
-- (`lesson_block_quarter_fixed`, 0059), so a quarter moved over a held
-- lesson's date is refused at the commit by `quarters_lessons`; a block after
-- today is refused unless the save moved it to the quarter that now holds its
-- date in the same transaction.
--
-- The writer side (`lesson_blocks_quarter_commit`, `exams_year_commit`) locks
-- the quarter or the year row `for share` at its commit and reads its dates
-- again in a statement of its own: the lock waits for a save of the quarter's
-- or the year's dates (`for no key update` of its update), so the later of
-- the two sees the other's dates. No lock is taken in a before-row trigger
-- (.claude/rules/database.md).
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/setup/setup-refusals.ts).

-- For the query of `quarters_lessons`.
create index lesson_blocks_quarter_date_idx on lesson_blocks (quarter_id, lesson_date);

-- At the end of the transaction: every block of a quarter whose dates changed
-- lies in its dates. A quarter left undated over a block is refused too; the
-- condition is written so that a null never passes. Runs as the invoker.
create function quarters_lessons() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  quarter_start date;
  quarter_end date;
begin
  select q.start_date, q.end_date into quarter_start, quarter_end
    from quarters q where q.id = new.id;
  if not found then
    return null;
  end if;
  if exists (
    select 1 from lesson_blocks b
    where b.quarter_id = new.id
      and (quarter_start is null or quarter_end is null
        or b.lesson_date < quarter_start or b.lesson_date > quarter_end)
  ) then
    raise exception 'quarter_leaves_lesson'
      using errcode = 'check_violation', constraint = 'quarter_leaves_lesson';
  end if;
  return null;
end;
$$;

create constraint trigger quarters_lessons
  after update of start_date, end_date on quarters
  deferrable initially deferred
  for each row execute function quarters_lessons();

-- At the end of the transaction: a block written lies in its quarter's dates
-- as they stand once the quarter row is locked `for share`, read in a
-- statement of its own. Runs as the invoker.
create function lesson_blocks_quarter_commit() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block_quarter uuid;
  block_date date;
  quarter_start date;
  quarter_end date;
begin
  select b.quarter_id, b.lesson_date into block_quarter, block_date
    from lesson_blocks b where b.id = new.id;
  if not found then
    -- Removed later in the transaction.
    return null;
  end if;
  perform 1 from quarters q where q.id = block_quarter for share;
  select q.start_date, q.end_date into quarter_start, quarter_end
    from quarters q where q.id = block_quarter;
  if not found then
    -- The foreign key answers it.
    return null;
  end if;
  if quarter_start is null or quarter_end is null
    or block_date < quarter_start or block_date > quarter_end then
    raise exception 'lesson_block_quarter'
      using errcode = 'check_violation', constraint = 'lesson_block_quarter';
  end if;
  return null;
end;
$$;

create constraint trigger lesson_blocks_quarter_commit
  after insert or update of lesson_date, quarter_id on lesson_blocks
  deferrable initially deferred
  for each row execute function lesson_blocks_quarter_commit();

-- At the end of the transaction: every exam of a year whose dates changed
-- lies in the year's dates, cancelled ones too, as `exam_year` (0060) keeps
-- every exam row (decision 8). Runs as the invoker.
create function academic_years_exams() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_start date;
  year_end date;
begin
  select y.start_date, y.end_date into year_start, year_end
    from academic_years y where y.id = new.id;
  if not found then
    return null;
  end if;
  if exists (
    select 1 from exams e
    where e.academic_year_id = new.id
      and (e.exam_date < year_start or e.exam_date > year_end)
  ) then
    raise exception 'year_leaves_exam'
      using errcode = 'check_violation', constraint = 'year_leaves_exam';
  end if;
  return null;
end;
$$;

create constraint trigger academic_years_exams
  after update of start_date, end_date on academic_years
  deferrable initially deferred
  for each row execute function academic_years_exams();

-- At the end of the transaction: an exam written lies in its year's dates as
-- they stand once the year row is locked `for share`, read in a statement of
-- its own. Runs as the invoker.
create function exams_year_commit() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_year_id uuid;
  exam_day date;
  year_start date;
  year_end date;
begin
  select e.academic_year_id, e.exam_date into exam_year_id, exam_day
    from exams e where e.id = new.id;
  if not found then
    return null;
  end if;
  perform 1 from academic_years y where y.id = exam_year_id for share;
  select y.start_date, y.end_date into year_start, year_end
    from academic_years y where y.id = exam_year_id;
  if found and (exam_day < year_start or exam_day > year_end) then
    raise exception 'exam_year' using errcode = 'check_violation', constraint = 'exam_year';
  end if;
  return null;
end;
$$;

create constraint trigger exams_year_commit
  after insert or update of exam_date on exams
  deferrable initially deferred
  for each row execute function exams_year_commit();
