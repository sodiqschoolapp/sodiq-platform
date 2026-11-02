-- 0151 Grade 0 (task 9.4d, the owner's spec change of 1 November 2026, item 3).
--
-- docs/spec/05-classes-groups-subjects.md, Class: "Grade (0–11) … A class is
-- shown as grade and name: 7 Oxford, 0 London." Every grade check of the
-- database takes 0 to 11, and -1 and 12 stay refused. The merged migrations
-- that wrote them (0017, 0018, 0020, 0032, 0042, 0091, 0118) are not edited:
-- each check is dropped and added again here under its own name.
--
-- No row is changed or removed. Every check is wider than before, so every
-- existing row holds it. The one exclusion that changes,
-- `calendar_entries_no_overlap`, refuses more, not less: a whole-branch entry
-- now holds grades 0 to 11, so a grade 0 entry of its kind and date is refused
-- beside it (answer 17); no existing row has grade 0, so none clashes. The
-- tables are small (at most about 2,000 students, the rest in the hundreds),
-- so the checks are added in one step (decision 3 of the plan).
--
-- Unchanged on purpose: `day_template_assignments_no_overlap` (0017) compares
-- rows of one level only, whose grades are all null or all set, so its
-- `coalesce(..., 1)` never meets grade 0; 0123 and 0126 already read a missing
-- grade as 0 and 99.

-- The grades of a subject or of a teacher's subject: one dimension, at least
-- one, no null, each 0 to 11, strictly ascending (0020; the same rule as the
-- subject schemas of packages/shared). Still immutable: it reads nothing but
-- its argument. `subjects_grades_check` and `staff_subjects_grades_check` call it.
create or replace function subject_grades_valid(grades smallint[]) returns boolean
language sql
immutable
as $$
  select array_ndims(grades) = 1
    and cardinality(grades) >= 1
    and array_position(grades, null) is null
    and grades[1] >= 0
    and grades[cardinality(grades)] <= 11
    and not exists (
      select 1 from generate_subscripts(grades, 1) as i
      where i > 1 and grades[i] <= grades[i - 1]
    )
$$;

alter table classes drop constraint classes_grade_check;
alter table classes add constraint classes_grade_check check (grade between 0 and 11);

alter table students drop constraint students_grade_check;
alter table students add constraint students_grade_check check (grade between 0 and 11);

alter table day_template_assignments drop constraint day_template_assignments_grade_from_check;
alter table day_template_assignments
  add constraint day_template_assignments_grade_from_check check (grade_from between 0 and 11);
alter table day_template_assignments drop constraint day_template_assignments_grade_to_check;
alter table day_template_assignments
  add constraint day_template_assignments_grade_to_check check (grade_to between 0 and 11);

alter table calendar_entries drop constraint calendar_entries_grades_check;
alter table calendar_entries add constraint calendar_entries_grades_check check (
  (grade_from is null and grade_to is null)
  or (grade_from is not null and grade_to is not null
    and grade_from between 0 and 11 and grade_to between 0 and 11 and grade_from <= grade_to)
);

-- Answer 17 and decision 2 of task 1.4: two active entries of one kind never
-- share a date for overlapping grades; a whole-branch entry holds grades 0 to 11.
alter table calendar_entries drop constraint calendar_entries_no_overlap;
alter table calendar_entries add constraint calendar_entries_no_overlap exclude using gist (
  branch_id with =,
  kind with =,
  int4range(coalesce(grade_from, 0), coalesce(grade_to, 11), '[]') with &&,
  daterange(first_date, last_date, '[]') with &&
) where (archived_at is null);

alter table timetable_version_days drop constraint timetable_version_days_grade_check;
alter table timetable_version_days
  add constraint timetable_version_days_grade_check check (grade between 0 and 11);

alter table lesson_plan_masters drop constraint lesson_plan_masters_grade_check;
alter table lesson_plan_masters
  add constraint lesson_plan_masters_grade_check check (grade between 0 and 11);
