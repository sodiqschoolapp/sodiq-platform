-- 0075 The readers that follow the published version (task 5.5a-2c, pull
-- request #144).
--
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "The load belongs
-- to a timetable version. The live load is read only; it changes only in a
-- draft and takes effect on that version's start date."
-- docs/spec/05-classes-groups-subjects.md, Group: "Whether a class is split
-- for a subject is set in the teaching load; the subject's group switch is
-- only the default. Every student of the classes involved must be in exactly
-- one group for that subject".
--
-- The plan approved on pull request #144: decisions 1 to 7 (1 and 7 Look
-- first). No table, column, constraint or index is added or removed; the two
-- triggers of the class side keep their names and events, and read the split
-- or group subjects of a class per day.

-- Decisions 1 to 4: the split or group subjects of a class, per stretch of
-- days [from_day, until_day), a null end being open. Before the first
-- published version of the class's branch and year, the subjects of the
-- active groups that draw from the class (`class_group_subjects`, 0049,
-- decision 5). On the run of each published version, from its start to the
-- next published version's start (ties on a start go to the higher number),
-- the subjects of its group rows whose group is not archived and draws from
-- the class. Each line carries the groups of its stretch; adjacent stretches
-- of a subject with the same groups are one line (spec review should-fix 5).
-- Runs as the invoker, so the branch filter applies; the versions are those
-- of the class's own branch and year, also in a transaction that holds
-- several branches (review correction 2).
create function class_group_subject_runs(class_ref uuid)
returns table (subject_id uuid, from_day date, until_day date, group_ids uuid[])
language sql
stable
set search_path = pg_catalog, public
as $$
  with the_class as (
    select c.branch_id, c.academic_year_id from classes c where c.id = class_ref
  ),
  published as (
    select distinct on (v.starts_on) v.id, v.starts_on
    from timetable_versions v
    join the_class tc
      on tc.branch_id = v.branch_id and tc.academic_year_id = v.academic_year_id
    where v.status = 'published'
    order by v.starts_on, v.number desc
  ),
  runs as (
    select p.id, p.starts_on as from_day,
      lead(p.starts_on) over (order by p.starts_on) as until_day
    from published p
  ),
  stretches as (
    select subject as subject_id, null::date as from_day,
      (select min(p.starts_on) from published p) as until_day,
      array(
        select g.id from group_classes gc
        join groups g on g.id = gc.group_id
        where gc.class_id = class_ref and g.archived_at is null and g.subject_id = subject
        order by g.id
      ) as group_ids
    from class_group_subjects(class_ref) subject
    union all
    select lr.subject_id, r.from_day, r.until_day, array_agg(distinct g.id order by g.id)
    from runs r
    join teaching_load_rows lr on lr.version_id = r.id and lr.group_id is not null
    join groups g on g.id = lr.group_id and g.archived_at is null
    join group_classes gc on gc.group_id = g.id and gc.class_id = class_ref
    group by lr.subject_id, r.from_day, r.until_day
  ),
  marked as (
    select s.*,
      case
        when lag(s.until_day) over w = s.from_day and lag(s.group_ids) over w = s.group_ids
        then 0 else 1
      end as fresh
    from stretches s
    window w as (partition by s.subject_id order by s.from_day nulls first)
  ),
  islands as (
    select m.*, sum(m.fresh) over (
      partition by m.subject_id order by m.from_day nulls first
    ) as island
    from marked m
  )
  select i.subject_id,
    case when bool_or(i.from_day is null) then null else min(i.from_day) end,
    case when bool_or(i.until_day is null) then null else max(i.until_day) end,
    -- One island has one list of groups.
    min(i.group_ids)
  from islands i
  group by i.subject_id, i.island
  order by i.subject_id, 2 nulls first
$$;

grant execute on function class_group_subject_runs(uuid) to sodiq_app;

-- The days of a class row that a split or group subject binds and that hold
-- no group row of the student of that subject, from `from_day` on: every
-- stretch of the subject cut out of `class_row_gaps` (0049). The one check of
-- both triggers below. Runs as the invoker. The parameter is named with the
-- function: a bare `from_day` is the column of the runs.
create function class_row_needs_groups(membership_ref uuid, class_ref uuid, from_day date)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from class_group_subject_runs(class_ref) run
    where not isempty(
      coalesce(
        class_row_gaps(membership_ref, run.subject_id, class_row_needs_groups.from_day),
        '{}'::datemultirange
      )
        * datemultirange(daterange(run.from_day, run.until_day))
    )
  )
$$;

grant execute on function class_row_needs_groups(uuid, uuid, date) to sodiq_app;

-- 0049, decision 1, with the subjects read per day (decision 1 of this task).
create or replace function class_memberships_need_groups() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if class_row_needs_groups(new.id, new.class_id, '-infinity'::date) then
    raise exception 'class_memberships_need_groups'
      using errcode = 'check_violation', constraint = 'class_memberships_need_groups';
  end if;
  return null;
end;
$$;

-- 0062 (`class_memberships_regained`) with the subjects read per day (decision 1
-- of this task); nothing else changes.
create or replace function class_memberships_regained() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  now_row record;
  pupil record;
  held record;
  from_day date := old.valid_until;
begin
  select m.* into now_row from class_memberships m where m.id = new.id;
  if not found or now_row.valid_until <= from_day
    or exists (
      select 1 from class_memberships j
      where j.joined_into_id = new.id
        and j.joined_xact = pg_current_xact_id()
        and j.valid_from = old.valid_until
    ) then
    return null;
  end if;
  perform 1 from classes c where c.id = now_row.class_id for update;
  select s.grade, s.branch_id into pupil from students s where s.id = now_row.student_id;
  if not found or pupil.branch_id is distinct from now_row.branch_id then
    raise exception 'class_memberships_student_branch'
      using errcode = 'check_violation', constraint = 'class_memberships_student_branch';
  end if;
  select c.archived_at, c.academic_year_id, c.grade, c.max_size into held
    from classes c where c.id = now_row.class_id;
  if held.archived_at is not null then
    raise exception 'class_memberships_class_archived'
      using errcode = 'check_violation', constraint = 'class_memberships_class_archived';
  end if;
  perform class_year_open(held.academic_year_id);
  if pupil.grade <> held.grade then
    raise exception 'class_memberships_grade'
      using errcode = 'check_violation', constraint = 'class_memberships_grade';
  end if;
  if class_members_peak(now_row.class_id, from_day, now_row.valid_until) > held.max_size then
    raise exception 'class_memberships_full'
      using errcode = 'check_violation', constraint = 'class_memberships_full';
  end if;
  if class_row_needs_groups(now_row.id, now_row.class_id, from_day) then
    raise exception 'class_memberships_need_groups'
      using errcode = 'check_violation', constraint = 'class_memberships_need_groups';
  end if;
  return null;
end;
$$;

-- Decision 7 (Look first): `department_move_loads` as 0067 wrote it, with a
-- published version left out once its run ended before the start date of the
-- move: a later published version of its branch and year (ties on a start by
-- number) starts on or before that date. A draft counts as before (3.4c,
-- decision 1); only a published version ends a run (review correction 3).
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
        and not (
          v.status = 'published'
          and exists (
            select 1 from public.timetable_versions later
            where later.branch_id = v.branch_id
              and later.academic_year_id = v.academic_year_id
              and later.status = 'published'
              and (later.starts_on > v.starts_on
                or (later.starts_on = v.starts_on and later.number > v.number))
              and later.starts_on <= department_move_loads.starts_on
          )
        )
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
