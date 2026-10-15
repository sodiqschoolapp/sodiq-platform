-- 0055 Draft timetable versions and teaching load rows (task 3.4a, pull
-- request #99).
--
-- docs/spec/05-classes-groups-subjects.md, Teaching load: "For each class or
-- group and subject: one teacher or one vacancy, lessons per week, the room or
-- room type if a special one is needed, whether double lessons are allowed."
-- "Only teachers whose profile has the subject and every grade of the class or
-- group, and the language of the class or group where the language rule
-- applies, can be chosen. A vacancy can be chosen under the same conditions."
-- docs/spec/06-timetable.md, Rules: "Inactive teachers, subjects and rooms
-- cannot be used." docs/spec/edge-cases/timetable.md, Versions and drafts:
-- "The load belongs to a timetable version. The live load is read only; it
-- changes only in a draft." "Each draft remembers the version it started
-- from." docs/spec/04-people.md, Vacancy: "A vacancy cannot be closed while a
-- load row names it ... One that never held a load can be deleted".
-- docs/spec/edge-cases/people-roles-accounts.md, row 13: "Tutor subjects come
-- with the Tutor assignment of a class and are outside that rule."
--
-- The plan approved on pull request #99 with corrections 1 to 6: decisions 2,
-- 3, 6, 7, 9 to 13 and 15. A later change elsewhere (a profile, a status, a
-- room, an archive) is not refused because a draft's row needs it (decision
-- 3): the facts are read without locks and the row shows the problem. The
-- two-grade slot rule needs the templates and is the API's (decision 8).
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/timetable/load-refusals.ts).

-- Decision 2: the Tutors department carries a mark the application cannot
-- set (no grant), on at most one row. A subject of that department is a Tutor
-- subject. Correction 5: the seeded row must be found.
alter table departments add column tutors boolean not null default false;

create unique index departments_one_tutors_idx on departments ((true)) where tutors;

do $$
declare
  marked integer;
begin
  update departments d set tutors = true
    from divisions v
    where v.id = d.division_id and v.name_en = 'Academic' and d.name_en = 'Tutors';
  get diagnostics marked = row_count;
  if marked <> 1 then
    raise exception 'The Tutors department of the Academic division was not found (% rows).', marked;
  end if;
end;
$$;

-- The versions of a branch's timetable (06, Model; decision 15): 3.4a writes
-- only drafts; publish, withdraw and the rest of the life of a version come
-- with tasks 5.1 to 5.5, which extend this table.
create table timetable_versions (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  academic_year_id uuid not null,
  -- 1, 2, 3 ... per branch and year, taken under the year row's lock.
  number smallint not null constraint timetable_versions_number_check check (number >= 1),
  -- Only drafts are written before 5.5: no grant on the column.
  status text not null default 'draft' constraint timetable_versions_status_check check (
    status in ('draft', 'published', 'archived')
  ),
  -- The intended start of step 1 (06, Building a timetable).
  starts_on date not null,
  -- The version a copy started from, of the same branch and year.
  from_version_id uuid,
  -- Decision 10: the rows of a copy that did not pass, each with its source
  -- row and codes, until the person dismisses them.
  left_rows jsonb not null default '[]' constraint timetable_versions_left_rows_check check (
    jsonb_typeof(left_rows) = 'array'
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint timetable_versions_year_fkey foreign key (academic_year_id, branch_id)
    references academic_years (id, branch_id),
  constraint timetable_versions_id_branch_key unique (id, branch_id),
  constraint timetable_versions_id_year_key unique (id, academic_year_id, branch_id),
  constraint timetable_versions_number_key unique (branch_id, academic_year_id, number),
  constraint timetable_versions_from_fkey foreign key (from_version_id, academic_year_id, branch_id)
    references timetable_versions (id, academic_year_id, branch_id)
);

create index timetable_versions_year_idx on timetable_versions (academic_year_id);

alter table timetable_versions enable row level security;
create policy branch_filter on timetable_versions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on timetable_versions to sodiq_app;
grant insert (branch_id, academic_year_id, number, starts_on, from_version_id, left_rows)
  on timetable_versions to sodiq_app;
grant update (starts_on, left_rows) on timetable_versions to sodiq_app;

-- The year, the number, the branch and the source never change; the rows
-- left by a copy are only dismissed, never written again.
create function timetable_versions_fixed() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.branch_id is distinct from old.branch_id
    or new.academic_year_id is distinct from old.academic_year_id
    or new.number is distinct from old.number
    or new.from_version_id is distinct from old.from_version_id
    or (new.left_rows is distinct from old.left_rows and new.left_rows <> '[]'::jsonb) then
    raise exception 'timetable_versions_fixed'
      using errcode = 'check_violation', constraint = 'timetable_versions_fixed';
  end if;
  return new;
end;
$$;

create trigger timetable_versions_fixed
  before update on timetable_versions
  for each row execute function timetable_versions_fixed();

-- A version is written into a year that is not closed (correction 2), and a
-- version's start date and left rows change only while it is a draft. The
-- year row is locked FOR SHARE whatever its state and read afterwards, in a
-- statement of its own (.claude/rules/database.md). Runs as the invoker.
create function timetable_versions_draft() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_state text;
begin
  perform 1 from academic_years y where y.id = new.academic_year_id for share;
  select y.status into year_state from academic_years y where y.id = new.academic_year_id;
  if year_state = 'closed' then
    raise exception 'version_year_closed'
      using errcode = 'check_violation', constraint = 'version_year_closed';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    raise exception 'timetable_versions_draft'
      using errcode = 'check_violation', constraint = 'timetable_versions_draft';
  end if;
  return new;
end;
$$;

create trigger timetable_versions_draft_insert
  before insert on timetable_versions
  for each row execute function timetable_versions_draft();

create trigger timetable_versions_draft_update
  before update of starts_on, left_rows on timetable_versions
  for each row execute function timetable_versions_draft();

-- The rows of a version's teaching load (05, Teaching load).
create table teaching_load_rows (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  -- A class or a group: exactly one.
  class_id uuid,
  group_id uuid,
  subject_id uuid not null references subjects (id),
  -- One teacher or one vacancy (06, Model; correction 3: never empty).
  teacher_id uuid not null references staff (id),
  -- Decision 12: LOAD_LESSONS_MAX of packages/shared.
  lessons_per_week smallint not null constraint teaching_load_rows_lessons_check check (
    lessons_per_week between 1 and 40
  ),
  -- Decision 13: one room, one room type (ROOM_TYPES of packages/shared, the
  -- list of rooms_type_check), or neither.
  room_id uuid,
  room_type text constraint teaching_load_rows_room_type_check check (
    room_type in ('classroom', 'laboratory', 'sports_hall', 'hall', 'other')
  ),
  double_lessons boolean not null default false,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint teaching_load_rows_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id),
  constraint teaching_load_rows_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint teaching_load_rows_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id),
  constraint teaching_load_rows_room_fkey foreign key (room_id, branch_id)
    references rooms (id, branch_id),
  constraint teaching_load_rows_unit_check check ((class_id is null) <> (group_id is null)),
  constraint teaching_load_rows_room_check check (room_id is null or room_type is null)
);

-- One row per class and subject, and one per group (a group has one subject),
-- in a version.
create unique index teaching_load_rows_class_key
  on teaching_load_rows (branch_id, version_id, class_id, subject_id)
  where class_id is not null;
create unique index teaching_load_rows_group_key
  on teaching_load_rows (branch_id, version_id, group_id)
  where group_id is not null;

create index teaching_load_rows_version_idx on teaching_load_rows (version_id);
create index teaching_load_rows_teacher_idx on teaching_load_rows (teacher_id);
create index teaching_load_rows_class_idx on teaching_load_rows (class_id);
create index teaching_load_rows_group_idx on teaching_load_rows (group_id);

alter table teaching_load_rows enable row level security;
create policy branch_filter on teaching_load_rows for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Decision 6: a draft's row is deleted, not archived. The unit, the subject
-- and the version are fixed (no grant).
grant select, delete on teaching_load_rows to sodiq_app;
grant insert (
  branch_id, version_id, class_id, group_id, subject_id, teacher_id, lessons_per_week,
  room_id, room_type, double_lessons
) on teaching_load_rows to sodiq_app;
grant update (teacher_id, lessons_per_week, room_id, room_type, double_lessons)
  on teaching_load_rows to sodiq_app;

-- The database's copy of the blocked rules of one row (decisions 7, 9, 11 and
-- 13; correction 4). The version's year and then the version are locked FOR
-- SHARE whatever their state and read afterwards, so that a year close or a
-- publish at the same moment waits or is waited for. The teacher's record is
-- locked FOR KEY SHARE before its status is read, so that a vacancy close
-- (FOR UPDATE of the record) waits for the row or is waited for. The profile,
-- the status and the room are read without other locks (decision 3). Runs as
-- the invoker: the rows of the version's branch.
create function teaching_load_rows_check() returns trigger
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
  day_start timestamptz;
  teacher_state text;
  status_on date;
  teacher_kind text;
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
    if not exists (
      select 1 from staff_branches b
      where b.staff_id = new.teacher_id and b.branch_id = new.branch_id
    ) then
      raise exception 'load_teacher_branch'
        using errcode = 'check_violation', constraint = 'load_teacher_branch';
    end if;
    select s.kind into teacher_kind from staff s where s.id = new.teacher_id;

    -- Decision 11: the status row in force on the start date, or today in the
    -- branch's time zone when the start date has passed (spec review of the
    -- build, should-fix 3: a draft that started still takes writes, and may
    -- not name a teacher out today); none counts as in. Today is the moment
    -- of the transaction (`app.now`), the same as the API reads.
    select b.time_zone into zone from branches b where b.id = new.branch_id;
    status_on := greatest(
      version_start,
      coalesce((class_tutors_moment() at time zone zone)::date, version_start)
    );
    select st.status into teacher_state
      from staff_statuses st
      where st.staff_id = new.teacher_id
        and st.valid_from <= status_on
        and (st.valid_until is null or st.valid_until > status_on);
    if teacher_state in ('inactive', 'left', 'closed') then
      raise exception 'load_teacher_status'
        using errcode = 'check_violation', constraint = 'load_teacher_status';
    end if;

    -- Decision 2 and correction 4: a Tutor subject on a class row may be
    -- taken by a Tutor of that class whose row overlaps the start date (from
    -- 00:00 of that day to 00:00 of the next in the branch's time zone),
    -- found through the assignment's account; a vacancy has no account.
    day_start := version_start::timestamp at time zone zone;
    if not (
      subject_tutors and new.class_id is not null and teacher_kind = 'person'
      and exists (
        select 1
        from class_tutors ct
        join assignments a on a.id = ct.assignment_id
        join staff s on s.account_id = a.account_id
        where ct.class_id = new.class_id
          and s.id = new.teacher_id
          and tstzrange(ct.valid_from, ct.valid_until)
            && tstzrange(day_start, (version_start + 1)::timestamp at time zone zone)
      )
    ) and not exists (
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

create trigger teaching_load_rows_check
  before insert or update or delete on teaching_load_rows
  for each row execute function teaching_load_rows_check();

-- The number of load rows of any version and branch that name a record, past
-- the row filter; a count only (the backstop of the vacancy close).
create function vacancy_load_rows(record_id uuid) returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)::integer from public.teaching_load_rows r
  where r.teacher_id = vacancy_load_rows.record_id
$$;

revoke execute on function vacancy_load_rows(uuid) from public;
grant execute on function vacancy_load_rows(uuid) to sodiq_app;

-- 04, Vacancy: "A vacancy cannot be closed while a load row names it." A
-- closed row of a vacancy that is in force (not withdrawn) is refused while a
-- load row names it, at the commit (decision 6).
create function staff_statuses_vacancy_load() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (new.valid_until is null or new.valid_until > new.valid_from)
    and vacancy_load_rows(new.staff_id) > 0 then
    raise exception 'vacancy_has_load'
      using errcode = 'check_violation', constraint = 'vacancy_has_load';
  end if;
  return null;
end;
$$;

create constraint trigger staff_statuses_vacancy_load
  after insert on staff_statuses
  deferrable initially deferred
  for each row
  when (new.status = 'closed')
  execute function staff_statuses_vacancy_load();

-- 0025's delete with the load (04, Vacancy: "One that never held a load can
-- be deleted"; decision 6): refused while any load row of any branch names the
-- vacancy, read after the record's lock in a statement of its own.
create or replace function vacancy_delete(record_id uuid) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  record_kind text;
begin
  select s.kind into record_kind from public.staff s
    where s.id = vacancy_delete.record_id
    for update;
  if record_kind is distinct from 'vacancy' or not exists (
    select 1 from public.staff_branches b
    where b.staff_id = vacancy_delete.record_id
      and b.branch_id = any (public.app_branch_ids())
  ) then
    raise exception 'vacancy_not_deletable'
      using errcode = 'check_violation', constraint = 'vacancy_not_deletable';
  end if;
  if exists (
    select 1 from public.teaching_load_rows r where r.teacher_id = vacancy_delete.record_id
  ) then
    raise exception 'vacancy_has_load'
      using errcode = 'check_violation', constraint = 'vacancy_has_load';
  end if;
  delete from public.staff_availability_ranges where staff_id = vacancy_delete.record_id;
  delete from public.staff_availability where staff_id = vacancy_delete.record_id;
  delete from public.staff_statuses where staff_id = vacancy_delete.record_id;
  delete from public.staff_languages where staff_id = vacancy_delete.record_id;
  delete from public.staff_subjects where staff_id = vacancy_delete.record_id;
  delete from public.staff_divisions where staff_id = vacancy_delete.record_id;
  delete from public.staff_branches where staff_id = vacancy_delete.record_id;
  delete from public.staff where id = vacancy_delete.record_id;
end
$$;
