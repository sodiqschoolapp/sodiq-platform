-- 0191 Codes for topics and works (task 11.27; the owner's spec change of
-- 25 November 2026, docs/spec-changes.md).
--
-- docs/spec/09-lesson-plans.md, Codes: "The Super Admin switches codes on for
-- chosen subjects: a switch on the subject, off by default." "A code is free
-- text of at most 20 characters (spaces at either end are dropped); it need
-- not be unique." docs/spec/05-classes-groups-subjects.md, Subject: "codes
-- switch (off by default; set by the Super Admin only)".
--
-- Plan approved on pull request #399:
-- - One value on the subject, read on every request (decision 10); no
--   per-quarter log, so the switch is not one of the switches of 0120.
-- - A code is null when there is none (decision 4); a code is trimmed and
--   never empty. The work columns are named `work_code`, a name no other table
--   uses, so the source test of its readers finds every one.
-- - No trigger: the proposal asks for no database rule beyond the length check
--   (plan review); the route refuses a code sent while codes are off.
--
-- Columns and checks only: nothing changes or removes an existing row. Every
-- new column is nullable or has a constant default, so no table is rewritten;
-- the checks are added `not valid` and validated apart (every row is null).

alter table subjects add column codes_on boolean not null default false;

-- Written only by the codes switch's route (`subject_codes`, the Super
-- Admin's); a new subject starts off, so the insert grant is not widened.
grant update (codes_on) on subjects to sodiq_app;

alter table lesson_plan_items add column topic_code text;
alter table lesson_plan_items
  add constraint lesson_plan_items_topic_code_check check (
    topic_code is null or (
      char_length(topic_code) between 1 and 20 and topic_code = btrim(topic_code, E' \t\r\n')
    )
  ) not valid;
alter table lesson_plan_items validate constraint lesson_plan_items_topic_code_check;
grant insert (topic_code), update (topic_code) on lesson_plan_items to sodiq_app;

alter table lesson_plan_works add column work_code text;
alter table lesson_plan_works
  add constraint lesson_plan_works_work_code_check check (
    work_code is null or (
      char_length(work_code) between 1 and 20 and work_code = btrim(work_code, E' \t\r\n')
    )
  ) not valid;
alter table lesson_plan_works validate constraint lesson_plan_works_work_code_check;
grant insert (work_code), update (work_code) on lesson_plan_works to sodiq_app;

alter table lesson_plan_master_items add column topic_code text;
alter table lesson_plan_master_items
  add constraint lesson_plan_master_items_topic_code_check check (
    topic_code is null or (
      char_length(topic_code) between 1 and 20 and topic_code = btrim(topic_code, E' \t\r\n')
    )
  ) not valid;
alter table lesson_plan_master_items validate constraint lesson_plan_master_items_topic_code_check;
grant insert (topic_code), update (topic_code) on lesson_plan_master_items to sodiq_app;

alter table lesson_plan_master_works add column work_code text;
alter table lesson_plan_master_works
  add constraint lesson_plan_master_works_work_code_check check (
    work_code is null or (
      char_length(work_code) between 1 and 20 and work_code = btrim(work_code, E' \t\r\n')
    )
  ) not valid;
alter table lesson_plan_master_works validate constraint lesson_plan_master_works_work_code_check;
grant insert (work_code), update (work_code) on lesson_plan_master_works to sodiq_app;
