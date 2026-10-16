-- 0065 The department move takes effect on its start date (task 3.6b-3, pull
-- request #123).
--
-- Owner's answer of 15 October 2026, L195 (issue #42): "The move takes effect
-- on its start date: the record shows the old department until then". The
-- plan approved on pull request #123: decisions 1 (the rules keep reading
-- `department_id`, the department after the move, from the save) and 8 (the
-- department in force until `department_since` is stored beside it).
--
-- `department_before` is the department in force until `department_since`,
-- and `department_before_since` the date it had held since (null when it was
-- never moved). The record shows `department_before` while today in branch
-- time is before `department_since`, read on each request; nothing flips it.
-- A move dated today writes neither. No rule reads them.

alter table subjects
  add column department_before uuid references departments (id),
  add column department_before_since date,
  add constraint subjects_department_before_check check (
    (department_before is null or department_since is not null)
    and (department_before_since is null or department_before is not null)
  );
grant update (department_before, department_before_since) on subjects to sodiq_app;

alter table staff_divisions
  add column department_before uuid,
  add column department_before_since date,
  add constraint staff_divisions_department_before_fkey foreign key (department_before, division_id)
    references departments (id, division_id),
  add constraint staff_divisions_department_before_check check (
    (department_before is null or department_since is not null)
    and (department_before_since is null or department_before is not null)
  );
grant update (department_before, department_before_since) on staff_divisions to sodiq_app;
