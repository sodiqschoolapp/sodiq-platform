-- 0032 Student records, UIDs and readers (task 2.4a, pull request #67).
--
-- docs/spec/04-people.md, Student record: "UID from the school's unified UID
-- system: seven digits ... In Release 1 it is typed by hand when the student
-- is created; the system checks that it is filled, has seven digits and is
-- not already used." "Contract number and contract date, both required."
-- "Scholarship type and amount." "Status: Active ... Inactive (archived) ...
-- Graduated." UID sets: "A UID stays with the student for good ... and it is
-- never given to another student."
-- docs/spec/edge-cases/students-classes-groups.md: "Saving is refused if the
-- UID is empty, does not fit the school's format, or already belongs to any
-- student of any branch, including inactive and graduated ones"; "A mistyped
-- UID can be corrected by the Academic Vice Principal with a reason; the old
-- value stays in history"; "A matching JSHSHIR or document number blocks the
-- save"; "Contracts are kept as a dated list, and a return adds a new one".
-- docs/spec/edge-cases/developer-rules.md, Identifiers: "a unique constraint
-- across the school guarantees it is never used twice".
--
-- The owner's answers 17 to 23 (docs/decisions.md, "Decided ahead for tasks
-- 2.1 to 2.6"). Decisions of pull request #67: the UIDs a student ever held
-- are reserved for good in `student_uids` (decision 7); the unique indexes on
-- the UID, the JSHSHIR, the document number and the contract number have no
-- branch: they hold across the school (decision 17, an exception to "A unique
-- constraint on a branch table includes branch_id"); they answer "taken"
-- only, and the holder is read through the branch filter. Every table here is
-- an ordinary branch table; the children reference the student with its
-- branch `on update cascade`, so the move to another branch of task 3.3 is one
-- update of `students.branch_id` (decision 15; `branch_id` is in no grant).

-- A name as typed on the student's document (answer 18): Latin with the
-- Uzbek ʻ (U+02BB) and the sign ʼ (U+02BC), or Cyrillic with the Uzbek letters
-- ў қ ғ ҳ; one script per name; words joined by one space or hyphen.
-- STUDENT_NAME_MAX_LENGTH of packages/shared.
create function student_name_valid(name text) returns boolean
language sql
immutable
as $$
  select (
    name ~ '^[A-Za-zʻʼ]+([ -][A-Za-zʻʼ]+)*$'
    or name ~ '^[А-Яа-яЁёЎўҚқҒғҲҳ]+([ -][А-Яа-яЁёЎўҚқҒғҲҳ]+)*$'
  ) and length(name) <= 60
$$;

create table students (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The current UID; a row of `student_uids` of the same student (the key
  -- below), and unique across the school.
  uid text not null constraint students_uid_check check (uid ~ '^[0-9]{7}$'),
  first_name text not null constraint students_first_name_check check (
    student_name_valid(first_name)
  ),
  last_name text not null constraint students_last_name_check check (
    student_name_valid(last_name)
  ),
  paternal_name text constraint students_paternal_name_check check (
    student_name_valid(paternal_name)
  ),
  -- The surname and first name folded by `spellingKey` of packages/shared
  -- (answer 18), written by the application with the names; the duplicate
  -- check compares it.
  name_key text not null constraint students_name_key_check check (
    length(name_key) between 1 and 121
  ),
  sex text not null constraint students_sex_check check (sex in ('male', 'female')),
  birth_date date not null,
  -- Answer 17: the grade the student joins; the class comes with task 3.1.
  grade smallint not null constraint students_grade_check check (grade between 1 and 11),
  starts_on date not null,
  -- Passport, ID card or birth certificate with its number, both or neither.
  document_type text constraint students_document_type_check check (
    document_type in ('passport', 'id_card', 'birth_certificate')
  ),
  document_number text constraint students_document_number_check check (
    document_number ~ '^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$'
  ),
  -- JSHSHIR, the personal number of 14 digits; unique when filled.
  jshshir text constraint students_jshshir_check check (jshshir ~ '^[0-9]{14}$'),
  -- With its country code (+998 by default in the form), digits only.
  phone text constraint students_phone_check check (phone ~ '^\+[0-9]{7,15}$'),
  email text constraint students_email_check check (
    email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  address text constraint students_address_check check (
    address = btrim(address) and length(address) between 1 and 200
  ),
  -- Answer 19: the 14 regions of Uzbekistan and "other"; REGIONS of packages/shared.
  region text constraint students_region_check check (
    region in (
      'andijan', 'bukhara', 'fergana', 'jizzakh', 'kashkadarya', 'khorezm', 'namangan',
      'navoi', 'samarkand', 'surkhandarya', 'syrdarya', 'tashkent_region', 'karakalpakstan',
      'tashkent_city', 'other'
    )
  ),
  previous_school text constraint students_previous_school_check check (
    previous_school = btrim(previous_school) and length(previous_school) between 1 and 120
  ),
  -- Answer 20.
  diagnostic_score smallint constraint students_diagnostic_score_check check (
    diagnostic_score between 0 and 100
  ),
  -- Answer 21: a partial scholarship has an amount in so'm, a whole number.
  scholarship_type text not null default 'none' constraint students_scholarship_type_check check (
    scholarship_type in ('none', 'merit', 'financial_aid', 'gift')
  ),
  scholarship_coverage text constraint students_scholarship_coverage_check check (
    scholarship_coverage in ('full', 'partial')
  ),
  scholarship_amount integer constraint students_scholarship_amount_check check (
    scholarship_amount between 1 and 1000000000
  ),
  -- Answer 23: "consent signed" with its date.
  consent_signed_on date,
  created_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint students_id_branch_key unique (id, branch_id),
  constraint students_document_check check (
    (document_type is null) = (document_number is null)
  ),
  constraint students_scholarship_check check (
    (scholarship_type = 'none') = (scholarship_coverage is null)
    and (scholarship_coverage = 'partial') = (scholarship_amount is not null)
  )
);

create unique index students_uid_idx on students (uid);
create unique index students_jshshir_idx on students (jshshir) where jshshir is not null;
create unique index students_document_idx on students (document_number)
  where document_number is not null;
create index students_branch_idx on students (branch_id);
create index students_name_key_idx on students (name_key, birth_date);

alter table students enable row level security;
create policy branch_filter on students for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on students to sodiq_app;
grant insert (
  id, branch_id, uid, first_name, last_name, paternal_name, name_key, sex, birth_date, grade,
  starts_on, document_type, document_number, jshshir, phone, email, address, region,
  previous_school, diagnostic_score, scholarship_type, scholarship_coverage, scholarship_amount,
  consent_signed_on, created_by
) on students to sodiq_app;
-- No starts_on and no branch_id: the start date is fixed at the create, where
-- the first status row starts (decisions, 2.4a); the move to another branch
-- comes with 3.3.
grant update (
  uid, first_name, last_name, paternal_name, name_key, sex, birth_date, grade,
  document_type, document_number, jshshir, phone, email, address, region, previous_school,
  diagnostic_score, scholarship_type, scholarship_coverage, scholarship_amount,
  consent_signed_on
) on students to sodiq_app;

-- Every UID a student ever held (decision 7): the one given at creation and
-- each one a correction gave. Insert only, so a UID once held is never
-- used by another student, inactive, graduated and corrected-away ones
-- included.
create table student_uids (
  uid text primary key constraint student_uids_uid_check check (uid ~ '^[0-9]{7}$'),
  student_id uuid not null,
  branch_id uuid not null references branches (id),
  -- The moment of the transaction that reserved it (the injected clock).
  held_from timestamptz not null,
  constraint student_uids_student_uid_key unique (student_id, uid),
  constraint student_uids_student_fkey foreign key (student_id, branch_id)
    references students (id, branch_id) on update cascade
);

create index student_uids_branch_idx on student_uids (branch_id);

alter table student_uids enable row level security;
create policy branch_filter on student_uids for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on student_uids to sodiq_app;

-- The current UID is one the student holds: written in the same transaction
-- as its `student_uids` row, checked at the commit.
alter table students add constraint students_uid_held_fkey foreign key (id, uid)
  references student_uids (student_id, uid) deferrable initially deferred;

-- Contracts as a dated list (edge: "Contracts are kept as a dated list, and a
-- return adds a new one"); the number is unique across the school, archived
-- students included (answer 22), compared without case and outer spaces.
create table student_contracts (
  id uuid primary key default uuidv7(),
  student_id uuid not null,
  branch_id uuid not null references branches (id),
  number text not null constraint student_contracts_number_check check (
    number = btrim(number) and length(number) between 1 and 30
  ),
  signed_on date not null,
  -- Bookkeeping only (the newest contract is the one with the latest row).
  created_at timestamptz not null default now(),
  constraint student_contracts_student_fkey foreign key (student_id, branch_id)
    references students (id, branch_id) on update cascade
);

create unique index student_contracts_number_idx on student_contracts (upper(number));
create index student_contracts_student_idx on student_contracts (student_id);
create index student_contracts_branch_idx on student_contracts (branch_id);

alter table student_contracts enable row level security;
create policy branch_filter on student_contracts for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (id, student_id, branch_id, number, signed_on) on student_contracts
  to sodiq_app;
grant update (number, signed_on) on student_contracts to sodiq_app;

-- Status as dated rows over [valid_from, valid_until), as `staff_statuses`:
-- they never overlap, only shrink and are never deleted. Task 2.4a writes the
-- first `active` row from the start date; the changes come with task 2.4b.
create table student_statuses (
  id uuid primary key default uuidv7(),
  student_id uuid not null,
  branch_id uuid not null references branches (id),
  status text not null constraint student_statuses_status_check check (
    status in ('active', 'inactive', 'graduated')
  ),
  valid_from date not null,
  valid_until date,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint student_statuses_student_fkey foreign key (student_id, branch_id)
    references students (id, branch_id) on update cascade,
  constraint student_statuses_range_check check (
    valid_until is null or valid_until >= valid_from
  ),
  constraint student_statuses_no_overlap exclude using gist (
    student_id with =,
    daterange(valid_from, valid_until) with &&
  )
);

create index student_statuses_student_idx on student_statuses (student_id, valid_from);
create index student_statuses_branch_idx on student_statuses (branch_id);

-- `dated_rows_only_shrink` of 0017, but the branch may change with the
-- student (the cascade of the move of task 3.3). Not SECURITY DEFINER.
create function student_statuses_only_shrink() returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'valid_until' - 'branch_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'branch_id')
    or (old.valid_until is not null
      and (new.valid_until is null or new.valid_until > old.valid_until)) then
    raise exception 'dated_rows_only_shrink'
      using errcode = 'check_violation', constraint = 'dated_rows_only_shrink';
  end if;
  return new;
end
$$;

create trigger student_statuses_only_shrink
  before update on student_statuses
  for each row execute function student_statuses_only_shrink();

alter table student_statuses enable row level security;
create policy branch_filter on student_statuses for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (student_id, branch_id, status, valid_from, valid_until)
  on student_statuses to sodiq_app;
grant update (valid_until) on student_statuses to sodiq_app;

-- The student account, created with the record and switched off until
-- Release 2 (02, build order: "Student and parent access switched on" in
-- Release 2; decision 9). No login and no password: students sign in by
-- phone and SMS code from Release 2. Release 2 drops the check.
create table student_accounts (
  student_id uuid primary key,
  branch_id uuid not null references branches (id),
  -- From the injected clock.
  created_at timestamptz not null,
  switched_on_at timestamptz constraint student_accounts_switched_off_check check (
    switched_on_at is null
  ),
  constraint student_accounts_student_fkey foreign key (student_id, branch_id)
    references students (id, branch_id) on update cascade
);

create index student_accounts_branch_idx on student_accounts (branch_id);

alter table student_accounts enable row level security;
create policy branch_filter on student_accounts for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (student_id, branch_id, created_at) on student_accounts to sodiq_app;

-- The duplicate warning across branches (edge: "The duplicate check runs on
-- every way of creating a student, across all branches, including inactive
-- and graduated students ... A matching name and date of birth, compared
-- after removing spelling differences, gives a warning that must be
-- confirmed"): whether a student of a branch outside the transaction's has
-- the same folded name and birth date. A boolean, never row data (decision
-- 16, as `staff_duplicate_elsewhere` of 0024).
create function student_duplicate_elsewhere(name_key text, birth_date date) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.students s
    where s.name_key = student_duplicate_elsewhere.name_key
      and s.birth_date = student_duplicate_elsewhere.birth_date
      and not (s.branch_id = any (public.app_branch_ids()))
  )
$$;

revoke execute on function student_duplicate_elsewhere(text, date) from public;
grant execute on function student_duplicate_elsewhere(text, date) to sodiq_app;
