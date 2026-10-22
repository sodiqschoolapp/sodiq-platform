-- 0110 Lessons that hold data, kept by the writers of dated lessons (task
-- 6.1b-1, pull request #206, decision 2, Look first).
--
-- 06, What a change does to existing data: lessons from the start date are
-- "Removed, if they hold no data", and of an earlier version restored
-- "Lessons that already hold data are kept and listed". A lesson with data
-- that a version no longer has stays in its block under its own version,
-- cancelled with the cause kept_data: kept held, it would still claim its
-- class, teacher and room at a time the version gives to other lessons
-- (edge/developer-rules: the claims are of lessons not cancelled), and its
-- entries are kept and out of every figure as those of any cancelled lesson
-- (edge/timetable, After publishing). Every earlier cause stays; 0058 is not
-- edited.

alter table lessons drop constraint lessons_cancel_cause_check;
alter table lessons add constraint lessons_cancel_cause_check check (
  cancel_cause in ('not_in_template', 'exam', 'exam_week', 'day_off', 'reason', 'kept_data')
);
