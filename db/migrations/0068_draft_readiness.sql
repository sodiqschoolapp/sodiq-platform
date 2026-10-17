-- 0068 The readiness of a draft's steps 1 to 4 (task 5.3a, pull request #127).
--
-- docs/spec/06-timetable.md, Building a timetable, step 1: "Sets the intended
-- start date ... and confirms the day templates of each weekday in force on
-- that date, per grade range where they differ". Ready when: "The start date
-- is set and the table of templates per weekday and grade is confirmed."
--
-- Decision 3: readiness is computed on each read and never stored; the one
-- stored thing is the table as it was confirmed, each cell's weekday, grade,
-- date, template and the kind, start and end of its slots. The API compares
-- it with the table of today on each read: a later template change or a new
-- start date makes it unconfirmed with no write. Null: never confirmed. Only
-- the confirm route writes it; a copy starts unconfirmed (no grant on insert).

alter table timetable_versions add column templates_confirmed jsonb;

grant update (templates_confirmed) on timetable_versions to sodiq_app;

-- As starts_on and left_rows (0055): changed only while the version is a
-- draft of a year that is not closed.
create trigger timetable_versions_confirm_draft
  before update of templates_confirmed on timetable_versions
  for each row execute function timetable_versions_draft();
