-- 0071 Busy elsewhere and the drafts of other branches (task 5.4b-1, pull
-- request #132).
--
-- docs/spec/06-timetable.md, Teachers who work in several branches: "One
-- clash check. A teacher cannot be in two lessons at once, counted across all
-- branches by clock time". "Busy elsewhere. In a branch's timetable the
-- teacher's lessons in other branches show as grey blocks marked with the
-- branch. They cannot be moved from here, and the generator treats them, and
-- the travel time around them, as fixed." "Two drafts at once. When two
-- branches prepare drafts that use the same teacher at the same time, each
-- grid warns that the teacher is also planned in a draft of the other branch."
--
-- The row filter hides another branch's pattern, so two functions read it,
-- on the model of `teacher_load_elsewhere` (0056): only for a branch of the
-- transaction (`branch_ref`), only for staff records linked to it, only rows
-- of the other branches, and only the weekday, the times and the branch
-- (decision 2, Look first): no class, group, subject, room or student of
-- another branch leaves them. `tutor_lesson` says whether the entry is a
-- Tutor lesson (a class row of a Tutor subject), so that the load step lists a
-- Tutor of classes in two branches (the From 5.3b-2 line of 5.4b).
--
-- No table, constraint or trigger is added, changed or removed.

-- The pattern entries of the teachers in the published version in force on
-- `on_date` in every other branch: of the academic year that holds the date,
-- the latest start on or before it, ties by number (decision 4).
create function timetable_busy_elsewhere(branch_ref uuid, staff_ids uuid[], on_date date)
returns table (
  staff_id uuid,
  branch_id uuid,
  entry_id uuid,
  weekday smallint,
  start_minutes smallint,
  end_minutes smallint,
  tutor_lesson boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not (timetable_busy_elsewhere.branch_ref = any (public.app_branch_ids())) then
    raise exception 'timetable_elsewhere_branch'
      using errcode = 'check_violation', constraint = 'timetable_elsewhere_branch';
  end if;
  return query
    with in_force as (
      select distinct on (v.branch_id) v.id, v.branch_id
      from public.timetable_versions v
      join public.academic_years y on y.id = v.academic_year_id
      where v.branch_id <> timetable_busy_elsewhere.branch_ref
        and v.status = 'published'
        and y.start_date <= timetable_busy_elsewhere.on_date
        and y.end_date >= timetable_busy_elsewhere.on_date
        and v.starts_on <= timetable_busy_elsewhere.on_date
      order by v.branch_id, v.starts_on desc, v.number desc
    )
    select e.teacher_id, e.branch_id, e.id, e.weekday, e.start_minutes, e.end_minutes,
      (r.class_id is not null and d.tutors)
    from in_force
    join public.pattern_entries e on e.version_id = in_force.id
    join public.teaching_load_rows r on r.id = e.load_row_id
    join public.subjects s on s.id = r.subject_id
    join public.departments d on d.id = s.department_id
    where e.teacher_id = any (timetable_busy_elsewhere.staff_ids)
      and exists (
        select 1 from public.staff_branches b
        where b.staff_id = e.teacher_id and b.branch_id = timetable_busy_elsewhere.branch_ref
      );
end;
$$;

revoke execute on function timetable_busy_elsewhere(uuid, uuid[], date) from public;
grant execute on function timetable_busy_elsewhere(uuid, uuid[], date) to sodiq_app;

-- The pattern entries of the teachers in the drafts of every other branch
-- that can overlap a draft from `from_date` to `until_date`: a start on or
-- before `until_date`, a year that does not end before `from_date`
-- (decision 5).
create function timetable_drafts_elsewhere(
  branch_ref uuid,
  staff_ids uuid[],
  from_date date,
  until_date date
)
returns table (
  staff_id uuid,
  branch_id uuid,
  entry_id uuid,
  weekday smallint,
  start_minutes smallint,
  end_minutes smallint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not (timetable_drafts_elsewhere.branch_ref = any (public.app_branch_ids())) then
    raise exception 'timetable_elsewhere_branch'
      using errcode = 'check_violation', constraint = 'timetable_elsewhere_branch';
  end if;
  return query
    select e.teacher_id, e.branch_id, e.id, e.weekday, e.start_minutes, e.end_minutes
    from public.timetable_versions v
    join public.academic_years y on y.id = v.academic_year_id
    join public.pattern_entries e on e.version_id = v.id
    where v.branch_id <> timetable_drafts_elsewhere.branch_ref
      and v.status = 'draft'
      and v.starts_on <= timetable_drafts_elsewhere.until_date
      and y.end_date >= timetable_drafts_elsewhere.from_date
      and e.teacher_id = any (timetable_drafts_elsewhere.staff_ids)
      and exists (
        select 1 from public.staff_branches b
        where b.staff_id = e.teacher_id and b.branch_id = timetable_drafts_elsewhere.branch_ref
      );
end;
$$;

revoke execute on function timetable_drafts_elsewhere(uuid, uuid[], date, date) from public;
grant execute on function timetable_drafts_elsewhere(uuid, uuid[], date, date) to sodiq_app;
