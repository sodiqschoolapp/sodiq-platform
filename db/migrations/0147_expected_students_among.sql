-- 0147 The expected students of a lesson among some students (task 10.1b, pull request #263).
--
-- One student's results page asked `lesson_expected_students` for every lesson of the year and
-- kept that student only: each lesson worked out every member's exemption (about 0.3 s of the
-- page at the school's size). `lesson_expected_students_among` gives the same answer for the
-- students named only, `null` naming every member; `lesson_expected_students` keeps its
-- signature (the closed-cell check of 0123 and every reader call it) and is now that function
-- with `null`, so the rule stays in one place. No row is changed or removed.

create function lesson_expected_students_among(lesson_ref uuid, among uuid[])
returns setof uuid
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  kept boolean := lesson_kept_out_possible(lesson_ref);
begin
  return query
  select s.student_id
  from (
    select m.student_id from lessons l
      join class_memberships m on m.class_id = l.class_id
        and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
      where l.id = lesson_ref and (among is null or m.student_id = any (among))
    union
    select m.student_id from lessons l
      join group_memberships m on m.group_id = l.group_id
        and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
      where l.id = lesson_ref and (among is null or m.student_id = any (among))
  ) s
  where (
    (not kept and not exists (
      select 1 from exemption_spans x where x.student_id = s.student_id and x.live
    ))
    or lesson_student_exemption(lesson_ref, s.student_id) is null
  );
end
$$;

grant execute on function lesson_expected_students_among(uuid, uuid[]) to sodiq_app;

-- Same answer as 0124: every member on the lesson's date who is expected.
create or replace function lesson_expected_students(lesson_ref uuid) returns setof uuid
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  return query select s from lesson_expected_students_among(lesson_ref, null) as s;
end
$$;
