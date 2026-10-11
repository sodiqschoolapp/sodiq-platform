-- 0024 Staff records and status (task 2.2a, pull request #53).
--
-- docs/spec/04-people.md, Teacher and staff record: "Staff ID given
-- automatically when the record is first saved, in the form S-YYNNNN";
-- "Branches: one main branch and any further branches where the person works.
-- Division: one main division and any further divisions. Department: required
-- in Academic, optional in other divisions; a teacher's subjects come from one
-- department. Subjects, each with the grades taught (multiple). Languages of
-- instruction: Uzbek, Russian or both." "Status: Active, inactive, left."
-- docs/spec/edge-cases/people-roles-accounts.md, Staff over time: "Each status
-- change has a date, which can be in the future"; "The staff record has a
-- JSHSHIR field, unique when filled"; "Re-hiring restores the same record,
-- staff ID and login with a new employment period"; "There is one counter per
-- year for the whole school ... A 10,000th hire in one year is refused."
-- docs/spec/edge-cases/developer-rules.md, Identifiers: "Staff IDs come from
-- one school-wide counter per year of first hire, taken in the same
-- transaction as the record, and a unique constraint across the school,
-- archived records included, guarantees one is never used twice."
--
-- The owner's answers 9, 11, 12 and 13 (docs/decisions.md, "Decided ahead for
-- tasks 2.1 to 2.6") and answer 2 on pull request #53: staff personal data
-- stays behind the branch filter, through membership. `staff_branches` is an
-- ordinary branch table; `staff` and the tables of a person are visible only
-- when the person is linked to a branch of the transaction (policy
-- `staff_membership`, named in MEMBERSHIP_FILTERED_TABLES of
-- apps/api/src/database/catalog.test.ts). Facts that rows of other branches
-- decide are answered by SECURITY DEFINER functions that return a boolean or
-- a count and never row data; each reads the branches of the transaction, not
-- an argument (review of pull request #53, correction 2).

-- Departments are named with their division by the staff record.
create unique index departments_id_division_idx on departments (id, division_id);

-- One counter per year of first hire for the whole school. A year and a
-- number, nothing personal: school-wide, named in SCHOOL_WIDE_TABLES. The row
-- lock of the upsert orders two saves of one moment; the check refuses the
-- 10,000th hire of a year.
create table staff_id_counters (
  year smallint primary key constraint staff_id_counters_year_check check (
    year between 1950 and 2099
  ),
  last_number smallint not null constraint staff_id_counters_last_number_check check (
    last_number between 1 and 9999
  )
);

grant select, insert, update (last_number) on staff_id_counters to sodiq_app;

-- Names (answer 13): Latin letters as the main spelling, with the Uzbek
-- letters oʻ and gʻ (U+02BB) and the sign ʼ (U+02BC) in one stored form each
-- (correction 9; the shared schema turns the typed variants into these),
-- words joined by one space or hyphen. STAFF_NAME_MAX_LENGTH of packages/shared.
create function staff_name_valid(name text) returns boolean
language sql
immutable
as $$
  select name ~ '^[A-Za-zʻʼ]+([ -][A-Za-zʻʼ]+)*$' and length(name) <= 60
$$;

-- The record. A vacancy (task 2.2b) is a row of its own kind: no staff ID,
-- no account and nothing personal (04, Vacancy); its checks are here already
-- so that 2.2b changes nothing of this table.
create table staff (
  id uuid primary key default uuidv7(),
  kind text not null constraint staff_kind_check check (kind in ('person', 'vacancy')),
  -- Given at the first save, never changed (no update grant), never reused:
  -- rows of a person are never deleted.
  staff_id text constraint staff_staff_id_key unique constraint staff_staff_id_check check (
    staff_id ~ '^S-[0-9]{6}$'
  ),
  -- The account of the person (task 2.3 writes it once).
  account_id uuid constraint staff_account_id_key unique references accounts (id),
  first_name text constraint staff_first_name_check check (staff_name_valid(first_name)),
  last_name text constraint staff_last_name_check check (staff_name_valid(last_name)),
  father_name text constraint staff_father_name_check check (staff_name_valid(father_name)),
  -- VACANCY_NAME_MAX_LENGTH of packages/shared.
  vacancy_name text constraint staff_vacancy_name_check check (
    length(btrim(vacancy_name)) between 1 and 100
  ),
  sex text constraint staff_sex_check check (sex in ('male', 'female')),
  birth_date date,
  -- Answer 12.
  education_level text constraint staff_education_level_check check (
    education_level in (
      'secondary', 'specialised_secondary', 'bachelor', 'master', 'phd', 'other'
    )
  ),
  -- With its country code (+998 by default in the form), digits only.
  phone text constraint staff_phone_check check (phone ~ '^\+[0-9]{7,15}$'),
  email text constraint staff_email_check check (
    email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  -- JSHSHIR, the personal number of 14 digits; unique when filled.
  jshshir text constraint staff_jshshir_check check (jshshir ~ '^[0-9]{14}$'),
  -- The first admission; a later correction keeps the staff ID.
  admission_date date,
  contract_type text constraint staff_contract_type_check check (
    contract_type in ('full_time', 'part_time')
  ),
  contract_date date,
  -- Answer 11: lessons per week by contract and most lessons per day.
  weekly_lessons smallint constraint staff_weekly_lessons_check check (
    weekly_lessons between 1 and 60
  ),
  daily_lessons smallint constraint staff_daily_lessons_check check (
    daily_lessons between 1 and 12
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint staff_person_check check (
    kind <> 'person' or (
      staff_id is not null and first_name is not null and last_name is not null
      and sex is not null and birth_date is not null and phone is not null
      and admission_date is not null and vacancy_name is null
    )
  ),
  constraint staff_vacancy_check check (
    kind <> 'vacancy' or (
      staff_id is null and account_id is null and first_name is null and last_name is null
      and father_name is null and sex is null and birth_date is null
      and education_level is null and phone is null and email is null and jshshir is null
      and admission_date is null and contract_type is null and contract_date is null
      and vacancy_name is not null
    )
  )
);

create unique index staff_jshshir_idx on staff (jshshir) where jshshir is not null;

-- A link to an account, once written, stays (task 2.3 writes it).
create function staff_account_link_guard() returns trigger
language plpgsql
as $$
begin
  if old.account_id is not null and new.account_id is distinct from old.account_id then
    raise exception 'staff_account_link_fixed'
      using errcode = 'check_violation', constraint = 'staff_account_link_fixed';
  end if;
  return new;
end
$$;

create trigger staff_account_link_guard
  before update of account_id on staff
  for each row execute function staff_account_link_guard();

-- The branches of a person: an ordinary branch table. One row per branch, at
-- most one main branch per person (the index sees every branch's rows).
create table staff_branches (
  staff_id uuid not null references staff (id),
  branch_id uuid not null references branches (id),
  is_main boolean not null,
  primary key (staff_id, branch_id)
);

create unique index staff_branches_one_main_idx on staff_branches (staff_id) where is_main;
create index staff_branches_branch_idx on staff_branches (branch_id);

alter table staff_branches enable row level security;
create policy branch_filter on staff_branches for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, delete on staff_branches to sodiq_app;
grant update (is_main) on staff_branches to sodiq_app;

-- The record and the tables of a person are visible when the person is linked
-- to a branch of the transaction. The insert of a record passes (the create
-- inserts the record, then its main branch link in the branch of the request,
-- then reads it back; `staff_main_branch_check` refuses a commit without it).
alter table staff enable row level security;
create policy staff_membership on staff for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = staff.id))
  with check (true);

grant select on staff to sodiq_app;
grant insert (
  id, kind, staff_id, first_name, last_name, father_name, sex, birth_date, education_level,
  phone, email, jshshir, admission_date, contract_type, contract_date, weekly_lessons,
  daily_lessons
) on staff to sodiq_app;
grant update (
  first_name, last_name, father_name, sex, birth_date, education_level, phone, email, jshshir,
  admission_date, contract_type, contract_date, weekly_lessons, daily_lessons
) on staff to sodiq_app;

-- The divisions of a person, each with its department when it has one (03,
-- Divisions: "each with its own department if needed").
create table staff_divisions (
  staff_id uuid not null references staff (id),
  division_id uuid not null references divisions (id),
  department_id uuid,
  is_main boolean not null,
  primary key (staff_id, division_id),
  constraint staff_divisions_department_fkey foreign key (department_id, division_id)
    references departments (id, division_id)
);

create unique index staff_divisions_one_main_idx on staff_divisions (staff_id) where is_main;
create index staff_divisions_division_idx on staff_divisions (division_id);
create index staff_divisions_department_idx on staff_divisions (department_id);

alter table staff_divisions enable row level security;
create policy staff_membership on staff_divisions for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = staff_divisions.staff_id))
  with check (exists (select 1 from staff_branches b where b.staff_id = staff_divisions.staff_id));

grant select, insert, delete on staff_divisions to sodiq_app;
grant update (department_id, is_main) on staff_divisions to sodiq_app;

-- The subjects of a person with the grades taught (04).
create table staff_subjects (
  staff_id uuid not null references staff (id),
  subject_id uuid not null references subjects (id),
  grades smallint[] not null constraint staff_subjects_grades_check check (
    subject_grades_valid(grades) is true
  ),
  primary key (staff_id, subject_id)
);

create index staff_subjects_subject_idx on staff_subjects (subject_id);

alter table staff_subjects enable row level security;
create policy staff_membership on staff_subjects for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = staff_subjects.staff_id))
  with check (exists (select 1 from staff_branches b where b.staff_id = staff_subjects.staff_id));

grant select, insert, delete on staff_subjects to sodiq_app;
grant update (grades) on staff_subjects to sodiq_app;

-- Languages of instruction (04): Uzbek, Russian or both; INSTRUCTION_LANGUAGES
-- of packages/shared.
create table staff_languages (
  staff_id uuid not null references staff (id),
  language text not null constraint staff_languages_language_check check (
    language in ('uz', 'ru')
  ),
  primary key (staff_id, language)
);

alter table staff_languages enable row level security;
create policy staff_membership on staff_languages for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = staff_languages.staff_id))
  with check (exists (select 1 from staff_branches b where b.staff_id = staff_languages.staff_id));

grant select, insert, delete on staff_languages to sodiq_app;

-- Status as dated rows, in force over [valid_from, valid_until). A withdrawn
-- planned change keeps its row with an empty range. Rows never overlap, only
-- shrink, and are never deleted.
create table staff_statuses (
  id uuid primary key default uuidv7(),
  staff_id uuid not null references staff (id),
  status text not null constraint staff_statuses_status_check check (
    status in ('active', 'inactive', 'left', 'open', 'closed')
  ),
  valid_from date not null,
  valid_until date,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint staff_statuses_range_check check (valid_until is null or valid_until >= valid_from),
  constraint staff_statuses_no_overlap exclude using gist (
    staff_id with =,
    daterange(valid_from, valid_until) with &&
  )
);

create index staff_statuses_staff_idx on staff_statuses (staff_id, valid_from);

create trigger staff_statuses_only_shrink
  before update on staff_statuses
  for each row execute function dated_rows_only_shrink();

-- The statuses of a person are active, inactive and left; those of a vacancy
-- open and closed (04, Vacancy).
create function staff_statuses_kind_guard() returns trigger
language plpgsql
as $$
declare
  record_kind text;
begin
  select kind into record_kind from staff where id = new.staff_id;
  if (record_kind = 'person') <> (new.status in ('active', 'inactive', 'left')) then
    raise exception 'staff_statuses_kind'
      using errcode = 'check_violation', constraint = 'staff_statuses_kind';
  end if;
  return new;
end
$$;

create trigger staff_statuses_kind_guard
  before insert on staff_statuses
  for each row execute function staff_statuses_kind_guard();

alter table staff_statuses enable row level security;
create policy staff_membership on staff_statuses for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = staff_statuses.staff_id))
  with check (exists (select 1 from staff_branches b where b.staff_id = staff_statuses.staff_id));

grant select, insert (staff_id, status, valid_from, valid_until) on staff_statuses to sodiq_app;
grant update (valid_until) on staff_statuses to sodiq_app;

-- The ends that a "left" row wrote on the assignments of the person's account,
-- with the end each had before, so that taking the planned change back puts
-- them back (review of pull request #53, decision 15). History: insert only.
create table staff_status_role_ends (
  status_id uuid not null references staff_statuses (id),
  staff_id uuid not null references staff (id),
  assignment_id uuid not null references assignments (id),
  previous_valid_until timestamptz,
  previous_ended_by uuid references accounts (id),
  primary key (status_id, assignment_id)
);

alter table staff_status_role_ends enable row level security;
create policy staff_membership on staff_status_role_ends for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = staff_status_role_ends.staff_id))
  with check (exists (select 1 from staff_branches b where b.staff_id = staff_status_role_ends.staff_id));

grant select, insert on staff_status_role_ends to sodiq_app;

-- At least one main branch per record, at the commit. Checked when a record
-- is inserted and when a main link is removed or demoted; the transaction
-- that does either sees the links it touches (the branches route runs with
-- the branches it changes). Not SECURITY DEFINER.
create function staff_main_branch_check() returns trigger
language plpgsql
as $$
declare
  record_id uuid;
begin
  if tg_table_name = 'staff' then
    record_id := new.id;
  else
    record_id := old.staff_id;
  end if;
  if not exists (select 1 from staff_branches where staff_id = record_id and is_main) then
    raise exception 'staff_main_branch'
      using errcode = 'check_violation', constraint = 'staff_main_branch';
  end if;
  return null;
end
$$;

create constraint trigger staff_main_branch_check
  after insert on staff
  deferrable initially deferred
  for each row execute function staff_main_branch_check();

create constraint trigger staff_main_branch_check
  after delete or update of is_main on staff_branches
  deferrable initially deferred
  for each row when (old.is_main)
  execute function staff_main_branch_check();

-- The profile of a record, at the commit (04; 03, Divisions): exactly one
-- main division; a department in the built-in Academic division; every
-- subject in the person's Academic department with grades among the
-- subject's; a language once there is a subject; a vacancy in Academic only.
-- Not SECURITY DEFINER: the rows of a person are visible to the transaction
-- that writes them.
create function staff_profile_check() returns trigger
language plpgsql
as $$
declare
  record_id uuid;
  record_kind text;
  academic_department uuid;
begin
  if tg_table_name = 'staff' then
    record_id := new.id;
  elsif tg_op = 'DELETE' then
    record_id := old.staff_id;
  else
    record_id := new.staff_id;
  end if;
  select kind into record_kind from staff where id = record_id;
  if not found then
    return null;
  end if;
  if (select count(*) from staff_divisions where staff_id = record_id and is_main) <> 1 then
    raise exception 'staff_main_division'
      using errcode = 'check_violation', constraint = 'staff_main_division';
  end if;
  if exists (
    select 1 from staff_divisions sd
    join divisions d on d.id = sd.division_id
    where sd.staff_id = record_id and d.built_in and sd.department_id is null
  ) then
    raise exception 'staff_department_required'
      using errcode = 'check_violation', constraint = 'staff_department_required';
  end if;
  if record_kind = 'vacancy' and exists (
    select 1 from staff_divisions sd
    join divisions d on d.id = sd.division_id
    where sd.staff_id = record_id and not d.built_in
  ) then
    raise exception 'staff_vacancy_division'
      using errcode = 'check_violation', constraint = 'staff_vacancy_division';
  end if;
  select sd.department_id into academic_department
    from staff_divisions sd
    join divisions d on d.id = sd.division_id
    where sd.staff_id = record_id and d.built_in;
  if exists (
    select 1 from staff_subjects ss
    join subjects s on s.id = ss.subject_id
    where ss.staff_id = record_id
      and s.department_id is distinct from academic_department
  ) then
    raise exception 'staff_subject_department'
      using errcode = 'check_violation', constraint = 'staff_subject_department';
  end if;
  if exists (
    select 1 from staff_subjects ss
    join subjects s on s.id = ss.subject_id
    where ss.staff_id = record_id and not (ss.grades <@ s.grades)
  ) then
    raise exception 'staff_subject_grades'
      using errcode = 'check_violation', constraint = 'staff_subject_grades';
  end if;
  if exists (select 1 from staff_subjects where staff_id = record_id)
    and not exists (select 1 from staff_languages where staff_id = record_id) then
    raise exception 'staff_languages_required'
      using errcode = 'check_violation', constraint = 'staff_languages_required';
  end if;
  return null;
end
$$;

create constraint trigger staff_profile_check
  after insert on staff
  deferrable initially deferred
  for each row execute function staff_profile_check();

create constraint trigger staff_profile_check
  after insert or update or delete on staff_divisions
  deferrable initially deferred
  for each row execute function staff_profile_check();

create constraint trigger staff_profile_check
  after insert or update on staff_subjects
  deferrable initially deferred
  for each row execute function staff_profile_check();

create constraint trigger staff_profile_check
  after delete on staff_languages
  deferrable initially deferred
  for each row execute function staff_profile_check();

-- Whether a record counts as out of the school on the date of a moment in its
-- main branch's time zone: a person who has left, a closed vacancy. Before its
-- first status row a record counts as in. Not SECURITY DEFINER: called by the
-- application it reads only what the transaction may see; called inside the
-- functions below it runs with their rights.
create function staff_out_on(record_id uuid, at timestamptz) returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from staff_statuses st
    join staff_branches b on b.staff_id = st.staff_id and b.is_main
    join branches br on br.id = b.branch_id
    where st.staff_id = record_id
      and st.status in ('left', 'closed')
      and st.valid_from <= (at at time zone br.time_zone)::date
      and (st.valid_until is null or st.valid_until > (at at time zone br.time_zone)::date)
  )
$$;

grant execute on function staff_out_on(uuid, timestamptz) to sodiq_app;

-- The functions below answer a fact that rows of other branches decide and
-- return a boolean or a count, never row data. Each reads the branches of the
-- transaction with app_branch_ids(), never from an argument, and is named in
-- SECURITY_DEFINER_FUNCTIONS of apps/api/src/database/catalog.test.ts.

-- The duplicate warning (edge, Staff over time: "The system also warns on the
-- same name and date of birth, and on the same phone"): whether a person not
-- linked to a branch of the transaction has the same name and birth date, or
-- the same phone. Names are compared in their stored form, without case.
create function staff_duplicate_elsewhere(
  first_name text, last_name text, birth_date date, phone text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.staff s
    where s.kind = 'person'
      and not exists (
        select 1 from public.staff_branches b
        where b.staff_id = s.id and b.branch_id = any (public.app_branch_ids())
      )
      and (
        (lower(s.first_name) = lower(staff_duplicate_elsewhere.first_name)
          and lower(s.last_name) = lower(staff_duplicate_elsewhere.last_name)
          and s.birth_date = staff_duplicate_elsewhere.birth_date)
        or s.phone = staff_duplicate_elsewhere.phone
      )
  )
$$;

-- Sign-in and every request run before a branch is known (edge, Staff over
-- time: "Inactive: ... cannot be scheduled or sign in"; "Left: all roles
-- ended"): whether the record linked to the account is inactive or left on
-- the date of the moment in its main branch's time zone.
create function staff_account_blocked(account_id uuid, at timestamptz) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.staff s
    join public.staff_branches b on b.staff_id = s.id and b.is_main
    join public.branches br on br.id = b.branch_id
    join public.staff_statuses st on st.staff_id = s.id
    where s.account_id = staff_account_blocked.account_id
      and st.status in ('inactive', 'left')
      and st.valid_from <= (staff_account_blocked.at at time zone br.time_zone)::date
      and (
        st.valid_until is null
        or st.valid_until > (staff_account_blocked.at at time zone br.time_zone)::date
      )
  )
$$;

-- The archives of a division or a department (school-wide routes; 03,
-- Divisions: "A division can be archived only when no active staff member is
-- in it"): whether a record that is not out of the school names it. Exactly
-- one of the two ids is given.
create function staff_in_division(division_id uuid, department_id uuid, at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.staff_divisions sd
    where (
        (staff_in_division.division_id is not null
          and sd.division_id = staff_in_division.division_id)
        or (staff_in_division.department_id is not null
          and sd.department_id = staff_in_division.department_id)
      )
      and not public.staff_out_on(sd.staff_id, staff_in_division.at)
  )
$$;

-- The staff counts of the Divisions page (03, Divisions: "counted once, under
-- the main division"): people not out of the school, by main division.
create function staff_count_by_division(at timestamptz)
returns table (division_id uuid, people integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select sd.division_id, count(*)::integer
  from public.staff_divisions sd
  join public.staff s on s.id = sd.staff_id
  where sd.is_main and s.kind = 'person'
    and not public.staff_out_on(s.id, staff_count_by_division.at)
  group by sd.division_id
$$;

-- A change of a subject's department or grades (the subject side, review of
-- pull request #53, correction 7): how many people not linked to a branch of
-- the transaction, and not out of the school, have the subject with a grade
-- outside the new grades or in another Academic department than the new one.
-- The people of the branch of the request are read normally and named.
create function staff_subject_in_use(
  subject_id uuid, grades smallint[], department_id uuid, at timestamptz
) returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(distinct ss.staff_id)::integer
  from public.staff_subjects ss
  left join public.staff_divisions sd on sd.staff_id = ss.staff_id
    and sd.division_id = (select d.id from public.divisions d where d.built_in)
  where ss.subject_id = staff_subject_in_use.subject_id
    and not exists (
      select 1 from public.staff_branches b
      where b.staff_id = ss.staff_id and b.branch_id = any (public.app_branch_ids())
    )
    and not public.staff_out_on(ss.staff_id, staff_subject_in_use.at)
    and (
      not (ss.grades <@ staff_subject_in_use.grades)
      or sd.department_id is distinct from staff_subject_in_use.department_id
    )
$$;

revoke execute on function staff_duplicate_elsewhere(text, text, date, text) from public;
revoke execute on function staff_account_blocked(uuid, timestamptz) from public;
revoke execute on function staff_in_division(uuid, uuid, timestamptz) from public;
revoke execute on function staff_count_by_division(timestamptz) from public;
revoke execute on function staff_subject_in_use(uuid, smallint[], uuid, timestamptz) from public;
grant execute on function staff_duplicate_elsewhere(text, text, date, text) to sodiq_app;
grant execute on function staff_account_blocked(uuid, timestamptz) to sodiq_app;
grant execute on function staff_in_division(uuid, uuid, timestamptz) to sodiq_app;
grant execute on function staff_count_by_division(timestamptz) to sodiq_app;
grant execute on function staff_subject_in_use(uuid, smallint[], uuid, timestamptz) to sodiq_app;
