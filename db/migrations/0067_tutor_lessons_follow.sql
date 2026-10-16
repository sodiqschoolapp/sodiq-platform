-- 0067 Tutor lessons follow the Tutor (task 3.6c-2, pull request #125).
--
-- Owner's answer 2 of 15 October 2026 and answer 1 of 16 October 2026 (issue
-- #42); docs/spec/edge-cases/timetable.md, Structure, "The Homework slot and
-- Ma'naviyat soati": "Their teacher is always the class's Tutor in force on
-- the lesson's date (the acting Tutor while one is set); nobody picks it by
-- hand." The plan approved on pull request #125: decisions 1 to 3 and 13.
--
-- Nothing is rewritten: a load row written by 3.4a's rule keeps its teacher
-- until its teacher changes, and the load page lists it.

-- Decision 3: the Tutor of a class for a day, the one reading of the database
-- (`tutorAt` of packages/timetable-rules at the same moment): the row in
-- force at the last moment of the day in the class's branch time, the acting
-- one first; its staff record, found through the assignment's account. Runs as
-- the invoker.
create function class_tutor_on(class_ref uuid, on_day date) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select st.id
  from public.class_tutors ct
  join public.classes c on c.id = ct.class_id
  join public.branches b on b.id = c.branch_id
  join public.assignments a on a.id = ct.assignment_id
  join public.staff st on st.account_id = a.account_id
  cross join lateral (
    select ((on_day + 1)::timestamp at time zone b.time_zone) as day_end
  ) d
  where ct.class_id = class_ref
    and ct.valid_from < d.day_end
    and (ct.valid_until is null or ct.valid_until >= d.day_end)
  order by (ct.kind = 'acting') desc, ct.valid_from desc
  limit 1
$$;

-- The row trigger of 0055 (decisions 7, 9, 11 and 13 of 3.4a), with the Tutor
-- row of decision 1: on insert and on a change of the teacher, a Tutor row
-- names the class's Tutor on the later of the version's start date and today
-- (`load_tutor_row_teacher`), and a class with none refuses
-- (`load_no_tutor`). The rest is as 0055 wrote it.
create or replace function teaching_load_rows_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  row_ref teaching_load_rows%rowtype;
  version_year uuid;
  version_state text;
  version_start date;
  year_state text;
  unit_year uuid;
  unit_archived timestamptz;
  unit_language text;
  unit_subject uuid;
  unit_grades smallint[];
  subject_archived timestamptz;
  subject_grades smallint[];
  subject_language_rule boolean;
  subject_tutors boolean;
  zone text;
  tutor_on uuid;
  teacher_state text;
  status_on date;
  teacher_change boolean;
begin
  if tg_op = 'DELETE' then
    row_ref := old;
  else
    row_ref := new;
  end if;

  -- A version, class, group or room of another branch: the foreign keys
  -- answer it.
  select v.academic_year_id into version_year
    from timetable_versions v where v.id = row_ref.version_id and v.branch_id = row_ref.branch_id;
  if found then
    perform 1 from academic_years y where y.id = version_year for share;
    perform 1 from timetable_versions v where v.id = row_ref.version_id for share;
    select v.status, v.starts_on into version_state, version_start
      from timetable_versions v where v.id = row_ref.version_id;
    select y.status into year_state from academic_years y where y.id = version_year;
    if version_state <> 'draft' then
      raise exception 'load_version_draft'
        using errcode = 'check_violation', constraint = 'load_version_draft';
    end if;
    if year_state = 'closed' then
      raise exception 'load_year_closed'
        using errcode = 'check_violation', constraint = 'load_year_closed';
    end if;
  else
    -- The foreign key answers it.
    return row_ref;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and (
    new.version_id is distinct from old.version_id
    or new.class_id is distinct from old.class_id
    or new.group_id is distinct from old.group_id
    or new.subject_id is distinct from old.subject_id
    or new.branch_id is distinct from old.branch_id
  ) then
    raise exception 'teaching_load_rows_fixed'
      using errcode = 'check_violation', constraint = 'teaching_load_rows_fixed';
  end if;

  if (new.class_id is null) = (new.group_id is null) or new.teacher_id is null then
    -- teaching_load_rows_unit_check and the not-null constraint answer it.
    return new;
  end if;

  teacher_change := tg_op = 'INSERT' or new.teacher_id is distinct from old.teacher_id;

  -- The unit: its year, archive, language and grades (a group's grades are
  -- those of its classes).
  if new.class_id is not null then
    select c.academic_year_id, c.archived_at, c.language, array[c.grade]::smallint[]
      into unit_year, unit_archived, unit_language, unit_grades
      from classes c where c.id = new.class_id and c.branch_id = new.branch_id;
  else
    select g.academic_year_id, g.archived_at, g.language, g.subject_id
      into unit_year, unit_archived, unit_language, unit_subject
      from groups g where g.id = new.group_id and g.branch_id = new.branch_id;
    select coalesce(array_agg(distinct c.grade order by c.grade), '{}')::smallint[]
      into unit_grades
      from group_classes gc join classes c on c.id = gc.class_id
      where gc.group_id = new.group_id;
  end if;
  if unit_year is null then
    -- No such class or group of the branch: the foreign key answers it.
    return new;
  end if;

  select s.archived_at, s.grades, s.language_rule, d.tutors
    into subject_archived, subject_grades, subject_language_rule, subject_tutors
    from subjects s join departments d on d.id = s.department_id
    where s.id = new.subject_id;

  if tg_op = 'INSERT' then
    if unit_year is distinct from version_year then
      raise exception 'load_unit_year'
        using errcode = 'check_violation', constraint = 'load_unit_year';
    end if;
    if unit_archived is not null then
      raise exception 'load_unit_archived'
        using errcode = 'check_violation', constraint = 'load_unit_archived';
    end if;
    if new.group_id is not null and unit_subject is distinct from new.subject_id then
      raise exception 'load_group_subject'
        using errcode = 'check_violation', constraint = 'load_group_subject';
    end if;
    if subject_archived is not null then
      raise exception 'load_subject_archived'
        using errcode = 'check_violation', constraint = 'load_subject_archived';
    end if;
    if not (subject_grades @> unit_grades) then
      raise exception 'load_subject_grade'
        using errcode = 'check_violation', constraint = 'load_subject_grade';
    end if;
  end if;

  if teacher_change then
    perform 1 from staff s where s.id = new.teacher_id for key share;

    -- Decision 11: the status row in force on the start date, or today in the
    -- branch's time zone when the start date has passed (spec review of the
    -- build, should-fix 3: a draft that started still takes writes, and may
    -- not name a teacher out today); none counts as in. Today is the moment
    -- of the transaction (`app.now`), the same as the API reads. Task
    -- 3.6c-2 reads the Tutor of a Tutor row on the same day.
    select b.time_zone into zone from branches b where b.id = new.branch_id;
    status_on := greatest(
      version_start,
      coalesce((class_tutors_moment() at time zone zone)::date, version_start)
    );

    -- Task 3.6c-2, decision 1: a Tutor row (a Tutor subject on a class row)
    -- holds the class's Tutor of the version and nobody else.
    if subject_tutors and new.class_id is not null then
      tutor_on := class_tutor_on(new.class_id, status_on);
      if tutor_on is null then
        raise exception 'load_no_tutor'
          using errcode = 'check_violation', constraint = 'load_no_tutor';
      end if;
      if tutor_on <> new.teacher_id then
        raise exception 'load_tutor_row_teacher'
          using errcode = 'check_violation', constraint = 'load_tutor_row_teacher';
      end if;
    end if;

    if not exists (
      select 1 from staff_branches b
      where b.staff_id = new.teacher_id and b.branch_id = new.branch_id
    ) then
      raise exception 'load_teacher_branch'
        using errcode = 'check_violation', constraint = 'load_teacher_branch';
    end if;

    select st.status into teacher_state
      from staff_statuses st
      where st.staff_id = new.teacher_id
        and st.valid_from <= status_on
        and (st.valid_until is null or st.valid_until > status_on);
    if teacher_state in ('inactive', 'left', 'closed') then
      raise exception 'load_teacher_status'
        using errcode = 'check_violation', constraint = 'load_teacher_status';
    end if;

    -- The class's Tutor takes a Tutor row without the profile row (3.4a
    -- decision 2 as narrowed by task 3.6c-2); every other row, a group row of
    -- a Tutor subject included, needs it.
    if not (subject_tutors and new.class_id is not null) and not exists (
      select 1 from staff_subjects ss
      where ss.staff_id = new.teacher_id
        and ss.subject_id = new.subject_id
        and ss.grades @> unit_grades
    ) then
      raise exception 'load_teacher_subject'
        using errcode = 'check_violation', constraint = 'load_teacher_subject';
    end if;

    if subject_language_rule and not exists (
      select 1 from staff_languages sl
      where sl.staff_id = new.teacher_id and sl.language = unit_language
    ) then
      raise exception 'load_teacher_language'
        using errcode = 'check_violation', constraint = 'load_teacher_language';
    end if;
  end if;

  if new.room_id is not null and (tg_op = 'INSERT' or new.room_id is distinct from old.room_id)
    and exists (
      select 1 from rooms r
      where r.id = new.room_id and r.branch_id = new.branch_id and r.status = 'closed'
    ) then
    raise exception 'load_room_closed'
      using errcode = 'check_violation', constraint = 'load_room_closed';
  end if;

  return new;
end;
$$;


-- The load rows a department move would leave outside the subject's
-- department (0057), with the Tutor row read by `class_tutor_on` in place of
-- "a Tutor of the class overlapping the day" (decision 3, review should-fix 7).
-- `is not distinct from`: a class with no Tutor leaves no row out.
create or replace function department_move_loads(
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
          and public.class_tutor_on(
            c.class_id,
            (
              select greatest(
                c.version_start,
                department_move_loads.starts_on,
                (today_moment at time zone br.time_zone)::date
              )
              from public.branches br
              where br.id = c.branch_id
            )
          ) is not distinct from c.teacher_id
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


-- Decision 13: the times of a teacher's lessons and exams in every branch,
-- for the clash and the travel time of a Tutor lesson that follows a change
-- of Tutor (06, Teachers who work in several branches, "One clash check").
-- Moments and branch only: no class, subject, room or name. Only for a
-- teacher linked to `branch_ref`, a branch of the transaction.
create function teacher_claims_elsewhere(
  branch_ref uuid, teacher_ref uuid, from_moment timestamptz, until_moment timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, branch_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not (teacher_claims_elsewhere.branch_ref = any (public.app_branch_ids())) then
    raise exception 'teacher_claims_branch'
      using errcode = 'check_violation', constraint = 'teacher_claims_branch';
  end if;
  if not exists (
    select 1 from public.staff_branches b
    where b.staff_id = teacher_claims_elsewhere.teacher_ref
      and b.branch_id = teacher_claims_elsewhere.branch_ref
  ) then
    raise exception 'teacher_claims_branch'
      using errcode = 'check_violation', constraint = 'teacher_claims_branch';
  end if;
  return query
    select lower(c.during), upper(c.during), c.branch_id
    from public.time_claims c
    where c.teacher_id = teacher_claims_elsewhere.teacher_ref
      and c.during && tstzrange(
        teacher_claims_elsewhere.from_moment, teacher_claims_elsewhere.until_moment
      )
    order by lower(c.during), upper(c.during), c.branch_id;
end;
$$;

revoke execute on function teacher_claims_elsewhere(uuid, uuid, timestamptz, timestamptz)
  from public;
grant execute on function teacher_claims_elsewhere(uuid, uuid, timestamptz, timestamptz)
  to sodiq_app;
