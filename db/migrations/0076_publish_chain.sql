-- 0076 Publish: the chain (task 5.5a-3a, pull request #145).
--
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "Publishing before
-- an already published later version asks: 'run until that version starts',
-- 'replace the versions that follow', or — offered only when the new version
-- differs from the version it started from in nothing but the teachers or
-- rooms of entries — 'carry the change into them': the same changes are made
-- in every later version that still has those entries, in the same step and
-- the same preview, as for filling a vacancy". docs/spec/06-timetable.md, How
-- surprises are prevented: "Withdraw. A published version can be withdrawn
-- only before its start date."
--
-- The plan approved on pull request #145: decisions 2 and 3 (Look first, a
-- trigger and two guards widened by a requirement) with review correction 1.
-- No constraint, index or trigger is removed; inserts and deletes of a
-- published version stay refused, and so does every other column and table.

-- A published version whose start is after the branch's today, read from
-- the moment of the transaction (`app.now`) as the load rows read it; without
-- a moment, false. Runs as the invoker.
create function timetable_version_not_started(version_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select v.status = 'published'
        and v.starts_on > (public.class_tutors_moment() at time zone b.time_zone)::date
      from public.timetable_versions v
      join public.branches b on b.id = v.branch_id
      where v.id = version_ref
    ),
    false
  )
$$;

-- Decision 2: besides draft to published, published to archived for a version
-- that has not started ("replace the versions that follow" now, withdraw in
-- 5.5c), in a year that is not closed. The year row is locked FOR SHARE
-- whatever its state and read afterwards, as 0073 does.
create or replace function timetable_versions_status() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_state text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft' and new.status = 'published')
    or (old.status = 'published' and new.status = 'archived')
  ) then
    raise exception 'timetable_versions_status'
      using errcode = 'check_violation', constraint = 'timetable_versions_status';
  end if;
  perform 1 from academic_years y where y.id = new.academic_year_id for share;
  select y.status into year_state from academic_years y where y.id = new.academic_year_id;
  if year_state = 'closed' then
    raise exception 'version_year_closed'
      using errcode = 'check_violation', constraint = 'version_year_closed';
  end if;
  if old.status = 'published' and not timetable_version_not_started(old.id) then
    raise exception 'version_archive_started'
      using errcode = 'check_violation', constraint = 'version_archive_started';
  end if;
  return new;
end;
$$;

-- Decision 3: the row trigger of 0067, unchanged but for the state check.
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
  carried boolean;
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
    -- Task 5.5a-3a, decision 3: a carry changes the teacher and the room of a
    -- row of a published version that has not started, nothing else.
    carried := false;
    if tg_op = 'UPDATE' and version_state = 'published' then
      carried := timetable_version_not_started(row_ref.version_id)
        and to_jsonb(new) - array['teacher_id', 'room_id']
          = to_jsonb(old) - array['teacher_id', 'room_id'];
    end if;
    if version_state <> 'draft' and not carried then
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

-- Decision 3 with review correction 1: `pattern_rows_draft` guards five
-- tables (pattern_blocks, pattern_entries, timetable_pins, timetable_locks,
-- timetable_day_keeps). On a published version that has not started it lets
-- through only an update of a pattern entry that changes its room (with the
-- shared flag `pattern_entries_room` copies) or its teacher to its load row's
-- (the cascade of `pattern_entries_load_row_fkey`). The rest is as 0058.
create or replace function pattern_rows_draft() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  version_ref uuid;
  version_year uuid;
  version_state text;
  year_state text;
  carried boolean := false;
begin
  if tg_op = 'DELETE' then
    version_ref := old.version_id;
  else
    version_ref := new.version_id;
  end if;
  select v.academic_year_id into version_year from timetable_versions v where v.id = version_ref;
  if not found then
    return null;
  end if;
  perform 1 from academic_years y where y.id = version_year for share;
  perform 1 from timetable_versions v where v.id = version_ref for share;
  select v.status into version_state from timetable_versions v where v.id = version_ref;
  select y.status into year_state from academic_years y where y.id = version_year;
  -- Nested: a field of `new` is read only on pattern_entries.
  if tg_table_name = 'pattern_entries' and tg_op = 'UPDATE' and version_state = 'published'
    and timetable_version_not_started(version_ref) then
    if to_jsonb(new) - array['room_id', 'room_shared', 'teacher_id']
      = to_jsonb(old) - array['room_id', 'room_shared', 'teacher_id'] then
      carried := new.teacher_id is not distinct from old.teacher_id
        or new.teacher_id = (
          select r.teacher_id from teaching_load_rows r where r.id = new.load_row_id
        );
    end if;
  end if;
  if version_state <> 'draft' and not carried then
    raise exception 'pattern_version_draft'
      using errcode = 'check_violation', constraint = 'pattern_version_draft';
  end if;
  if year_state = 'closed' then
    raise exception 'pattern_year_closed'
      using errcode = 'check_violation', constraint = 'pattern_year_closed';
  end if;
  return null;
end;
$$;
