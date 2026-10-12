-- 0025 Availability and vacancies (task 2.2b, pull request #57).
--
-- docs/spec/04-people.md, Teacher and staff record: "Availability: Days and
-- hours the teacher is at school, entered for each branch where they work as
-- entries that each apply from a date." Vacancy: "a staff record that stands
-- for a teacher not yet hired: a name such as "English vacancy 2", one
-- branch, the Academic division and one department, subjects with the grades
-- taught, languages of instruction, availability and contract load, and
-- nothing personal ... One that never held a load can be deleted."
-- docs/spec/06-timetable.md, Teachers who work in several branches: "For each
-- branch: the days and hours the teacher is there, as entries that each apply
-- from a date. Hours in two branches cannot overlap on any date. Each
-- branch's Academic Vice Principal edits the hours of own branch and sees the
-- others read only."
--
-- The owner's answer 10 (docs/decisions.md, "Decided ahead for tasks 2.1 to
-- 2.6") and the plan approved on pull request #57 with its corrections.
--
-- An entry is the whole week of one branch from a date (decision 2), a dated
-- row as in 0017: in force over [valid_from, valid_until), never deleted, its
-- end only ever moves earlier. Its end is 'infinity' while open, not empty,
-- so that the foreign key of its ranges covers the end too: a cut of the
-- entry cuts its ranges in the same statement and the copies never differ.

create table staff_availability (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  staff_id uuid not null references staff (id),
  valid_from date not null,
  valid_until date not null default 'infinity',
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint staff_availability_range_check check (valid_until >= valid_from),
  constraint staff_availability_key unique (id, branch_id, staff_id, valid_from, valid_until),
  -- One entry in force per person, branch and date.
  constraint staff_availability_no_overlap exclude using gist (
    staff_id with =,
    branch_id with =,
    daterange(valid_from, valid_until, '[)') with &&
  )
);

create index staff_availability_staff_idx on staff_availability (staff_id, branch_id, valid_from);

alter table staff_availability enable row level security;
create policy branch_filter on staff_availability for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create trigger staff_availability_only_shrink
  before update on staff_availability
  for each row execute function dated_rows_only_shrink();

grant select, insert (branch_id, staff_id, valid_from, valid_until) on staff_availability
  to sodiq_app;
grant update (valid_until) on staff_availability to sodiq_app;

-- The time ranges of an entry: a weekday (ISO, Monday 1 to Sunday 7) and
-- minutes after midnight, half-open, so 08:00-13:00 and 13:00-17:00 touch and
-- do not overlap. Written with the entry, never changed by the application.
create table staff_availability_ranges (
  entry_id uuid not null,
  branch_id uuid not null references branches (id),
  staff_id uuid not null references staff (id),
  weekday smallint not null constraint staff_availability_ranges_weekday_check check (
    weekday between 1 and 7
  ),
  start_minutes smallint not null constraint staff_availability_ranges_start_check check (
    start_minutes between 0 and 1439
  ),
  end_minutes smallint not null constraint staff_availability_ranges_end_check check (
    end_minutes between 1 and 1440
  ),
  valid_from date not null,
  valid_until date not null,
  primary key (entry_id, weekday, start_minutes),
  constraint staff_availability_ranges_order_check check (end_minutes > start_minutes),
  constraint staff_availability_ranges_range_check check (valid_until >= valid_from),
  constraint staff_availability_ranges_entry_fkey
    foreign key (entry_id, branch_id, staff_id, valid_from, valid_until)
    references staff_availability (id, branch_id, staff_id, valid_from, valid_until)
    on update cascade,
  -- 06: "Hours in two branches cannot overlap on any date." Not filtered by
  -- branch (constraints never are), so every branch of the person is
  -- compared; two overlapping ranges of one entry are refused too.
  -- Wall-clock minutes are compared as they are because every branch is in
  -- one time zone (00-definitions, Branch time) and sodiq_app cannot change a
  -- branch's time zone (0014): the task that makes branches.time_zone
  -- writable converts to real clock time here first (decision 3).
  constraint staff_availability_ranges_no_overlap exclude using gist (
    staff_id with =,
    weekday with =,
    int4range(start_minutes, end_minutes, '[)') with &&,
    daterange(valid_from, valid_until, '[)') with &&
  )
);

create index staff_availability_ranges_staff_idx on staff_availability_ranges (staff_id);

alter table staff_availability_ranges enable row level security;
create policy branch_filter on staff_availability_ranges for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create trigger staff_availability_ranges_only_shrink
  before update on staff_availability_ranges
  for each row execute function dated_rows_only_shrink();

grant select, insert on staff_availability_ranges to sodiq_app;

-- A vacancy's name is written by the application (0024 granted the person's
-- columns only).
grant insert (vacancy_name), update (vacancy_name) on staff to sodiq_app;

-- The kind of one record by id, or null when no such row exists, whatever the
-- membership filter lets the transaction see (.claude/rules/database.md: a
-- check must not depend on what the filter shows). No row data.
create function staff_record_kind(record_id uuid) returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.kind from public.staff s where s.id = staff_record_kind.record_id
$$;

-- 0024's check with one added line: a record deleted in this transaction (a
-- vacancy, vacancy_delete below) has no main branch to keep. Its existence is
-- read through staff_record_kind, so a person only invisible to the
-- transaction is still checked (decision 9 of pull request #57).
create or replace function staff_main_branch_check() returns trigger
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
  if staff_record_kind(record_id) is null then
    return null;
  end if;
  if not exists (select 1 from staff_branches where staff_id = record_id and is_main) then
    raise exception 'staff_main_branch'
      using errcode = 'check_violation', constraint = 'staff_main_branch';
  end if;
  return null;
end
$$;

-- 04: a vacancy has "one branch". Its one link is its main link; any further
-- link is refused. With staff_branches_one_main_idx (not filtered) this gives
-- exactly one link without counting the links a transaction can see. Deferred,
-- and the kind read through staff_record_kind.
create function staff_vacancy_one_branch() returns trigger
language plpgsql
as $$
begin
  if staff_record_kind(new.staff_id) = 'vacancy' then
    raise exception 'staff_vacancy_one_branch'
      using errcode = 'check_violation', constraint = 'staff_vacancy_one_branch';
  end if;
  return null;
end
$$;

create constraint trigger staff_vacancy_one_branch
  after insert or update of is_main on staff_branches
  deferrable initially deferred
  for each row when (not new.is_main)
  execute function staff_vacancy_one_branch();

-- The other branches' hours of a record, read only (06: "sees the others
-- read only"): the entries, each with its ranges (none for an empty entry),
-- of the branches not in the transaction, and nothing unless the record is
-- linked to a branch of the transaction. Working hours only.
create function staff_availability_elsewhere(record_id uuid)
returns table (
  entry_id uuid,
  branch_id uuid,
  valid_from date,
  valid_until date,
  weekday smallint,
  start_minutes smallint,
  end_minutes smallint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.id, a.branch_id, a.valid_from, a.valid_until, r.weekday, r.start_minutes,
    r.end_minutes
  from public.staff_availability a
  left join public.staff_availability_ranges r on r.entry_id = a.id
  where a.staff_id = staff_availability_elsewhere.record_id
    and not (a.branch_id = any (public.app_branch_ids()))
    and exists (
      select 1 from public.staff_branches b
      where b.staff_id = staff_availability_elsewhere.record_id
        and b.branch_id = any (public.app_branch_ids())
    )
$$;

-- 04, Vacancy: "One that never held a load can be deleted." The membership
-- policy hides a record once its branch link is gone and the link cannot go
-- first (foreign key), and sodiq_app has no delete right on staff or on the
-- history of statuses and availability: this function deletes a vacancy of a
-- branch of the transaction with every row of it. The service writes the
-- whole record into the audit entry first (review of pull request #57,
-- correction 1). The task of the teaching load adds "never held a load".
create function vacancy_delete(record_id uuid) returns void
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

revoke execute on function staff_record_kind(uuid) from public;
revoke execute on function staff_availability_elsewhere(uuid) from public;
revoke execute on function vacancy_delete(uuid) from public;
grant execute on function staff_record_kind(uuid) to sodiq_app;
grant execute on function staff_availability_elsewhere(uuid) to sodiq_app;
grant execute on function vacancy_delete(uuid) to sodiq_app;
