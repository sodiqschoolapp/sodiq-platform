-- 0057 The department move against the teaching load (task 3.4c, pull request
-- #101).
--
-- docs/spec/edge-cases/people-roles-accounts.md, row 15: "A teacher moves to
-- another department, or a subject is moved, mid-year. Both changes carry a
-- start date and are made by the Super Admin. They are refused while a
-- teaching load would have a teacher outside the subject's department; those
-- loads are listed for reassignment first." Row 13: "Tutor subjects come with
-- the Tutor assignment of a class and are outside that rule." Row 14: a person
-- works in several branches, and every request is checked against one.
--
-- The plan approved on pull request #101 with corrections 1 to 5: decisions 1
-- (a draft's row counts), 2 (the department changes on the record when the
-- move is saved; the start date says which versions' loads must follow it), 3
-- (this function), 4 and correction 1 (a vacancy's row counts on a subject
-- move), 6 (no constraint: the start date is a fact of the request), 7 (the
-- Tutor exception) and 8 (the date the department has held since).

-- Decision 8: the start date of the last move, empty for a record never
-- moved. Written by the move only.
alter table subjects add column department_since date;
grant update (department_since) on subjects to sodiq_app;

alter table staff_divisions add column department_since date;
grant update (department_since) on staff_divisions to sodiq_app;

-- Decisions 1 to 3, 7 and correction 1: the load rows a move would leave with
-- a teacher (or a vacancy) outside the subject's department. Exactly one of
-- `teacher_ref` (a teacher move: `department_ref` is the new department of the
-- person's Academic division, null when the division is removed) and
-- `subject_ref` (a subject move to `department_ref`, never null). A row counts
-- when its version is not archived, its year is not closed and ends on or
-- after `starts_on`, and, after the move, its subject's department is not its
-- teacher's Academic department; except a Tutor subject (a subject of the
-- department marked `tutors`, read after the move) on a class row whose
-- teacher is a Tutor of the class on the later of the version's start date,
-- `starts_on` and today in the row's branch time (3.4a decisions 2 and 11).
-- The rows of `branch_ref`, a branch of the transaction, come back one each
-- with their id and version; the rows of every other branch as one count per
-- branch, with no id. A teacher move is answered only for a person linked to
-- `branch_ref`, as `vacancy_delete` checks.
create function department_move_loads(
  branch_ref uuid, teacher_ref uuid, subject_ref uuid, department_ref uuid, starts_on date
)
returns table (row_id uuid, version_id uuid, branch_id uuid, rows integer)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  today_moment timestamptz;
begin
  if not (department_move_loads.branch_ref = any (public.app_branch_ids())) then
    raise exception 'department_move_branch'
      using errcode = 'check_violation', constraint = 'department_move_branch';
  end if;
  if (department_move_loads.teacher_ref is null) = (department_move_loads.subject_ref is null)
    or department_move_loads.starts_on is null
    or (department_move_loads.subject_ref is not null and department_move_loads.department_ref is null)
  then
    raise exception 'department_move_input'
      using errcode = 'check_violation', constraint = 'department_move_input';
  end if;
  if department_move_loads.teacher_ref is not null and not exists (
    select 1 from public.staff_branches b
    where b.staff_id = department_move_loads.teacher_ref
      and b.branch_id = department_move_loads.branch_ref
  ) then
    raise exception 'department_move_branch'
      using errcode = 'check_violation', constraint = 'department_move_branch';
  end if;
  today_moment := public.class_tutors_moment();
  if today_moment is null then
    raise exception 'department_move_needs_moment'
      using errcode = 'check_violation', constraint = 'department_move_needs_moment';
  end if;

  return query
    with counted as (
      select r.id, r.version_id, r.branch_id, r.class_id, r.teacher_id, v.starts_on as version_start,
        case when department_move_loads.subject_ref is not null
          then department_move_loads.department_ref else s.department_id end as subject_department,
        case when department_move_loads.teacher_ref is not null
          then department_move_loads.department_ref
          else (
            select sd.department_id from public.staff_divisions sd
            join public.divisions d on d.id = sd.division_id
            where sd.staff_id = r.teacher_id and d.built_in
          ) end as teacher_department
      from public.teaching_load_rows r
      join public.timetable_versions v on v.id = r.version_id
      join public.academic_years y on y.id = v.academic_year_id
      join public.subjects s on s.id = r.subject_id
      where v.status <> 'archived'
        and y.status <> 'closed'
        and y.end_date >= department_move_loads.starts_on
        and (department_move_loads.teacher_ref is null or r.teacher_id = department_move_loads.teacher_ref)
        and (department_move_loads.subject_ref is null or r.subject_id = department_move_loads.subject_ref)
    ),
    outside as (
      select c.* from counted c
      where c.subject_department is distinct from c.teacher_department
        and not (
          c.class_id is not null
          and exists (
            select 1 from public.departments dep
            where dep.id = c.subject_department and dep.tutors
          )
          and exists (
            select 1
            from public.branches br
            cross join lateral (
              select greatest(
                c.version_start,
                department_move_loads.starts_on,
                (today_moment at time zone br.time_zone)::date
              ) as on_day
            ) day
            join public.class_tutors ct on ct.class_id = c.class_id
            join public.assignments a on a.id = ct.assignment_id
            join public.staff st on st.account_id = a.account_id
            where br.id = c.branch_id
              and st.id = c.teacher_id
              and st.kind = 'person'
              and tstzrange(ct.valid_from, ct.valid_until)
                && tstzrange(
                  day.on_day::timestamp at time zone br.time_zone,
                  (day.on_day + 1)::timestamp at time zone br.time_zone
                )
          )
        )
    )
    select o.id, o.version_id, o.branch_id, 1
      from outside o where o.branch_id = department_move_loads.branch_ref
    union all
    select null::uuid, null::uuid, o.branch_id, count(*)::integer
      from outside o where o.branch_id <> department_move_loads.branch_ref
      group by o.branch_id;
end;
$$;

revoke execute on function department_move_loads(uuid, uuid, uuid, uuid, date) from public;
grant execute on function department_move_loads(uuid, uuid, uuid, uuid, date) to sodiq_app;
