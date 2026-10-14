-- 0045 Class membership (task 3.1b, pull request #89).
--
-- docs/spec/05-classes-groups-subjects.md, Class: "A student is in exactly
-- one class at a time"; "maximum size".
-- docs/spec/edge-cases/developer-rules.md, Membership: "One class per student
-- per date ... by date ranges that cannot overlap."
-- docs/spec/edge-cases/students-classes-groups.md: "An active student with no
-- class is allowed only before their start date." "The maximum size is a hard
-- limit on the effective date, counting scheduled joins and leaves, on every
-- path. The Academic Vice Principal can raise the maximum; this is logged."
-- "A transfer or a leaving is set for a future date ... It can be changed or
-- cancelled until the date." "Two people move the same student at the same
-- moment. The second one gets \"student changed, reload\"."
-- docs/spec/04-people.md, Movements: "Leaving the school ... taken out of
-- classes and groups from that date."
--
-- The plan approved on pull request #89 with the corrections of its review:
-- decisions 1, 3, 4, 7, 8, 11, 12, 16 and 17; corrections 1 and 4.
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/classes/class-membership-rows.ts).

-- The classes of a student over dates, half-open `[valid_from, valid_until)`.
-- A row belongs to its class's branch (decision 16): the student key has no
-- branch, so the move of a student to another branch (task 3.3) leaves the
-- past rows with their classes, and the overlap constraint holds across
-- branches. Rows only shrink and are never deleted by the application; they
-- go with a student deleted as created twice (decision 12, the cascade kept in
-- the audit entry of the delete).
create table class_memberships (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  student_id uuid not null references students (id) on delete cascade,
  class_id uuid not null,
  valid_from date not null,
  -- The end in force: `own_until`, or earlier once a leaving cut the row or
  -- the row was withdrawn before its date (an empty range).
  valid_until date not null,
  -- Correction 1: the row's own end, written at the insert and never changed,
  -- so that a leaving taken back gives the row its own end again. At most the
  -- day after the end of the class's year (decision 7).
  own_until date not null,
  -- What wrote the row (decision 8): a placement, the create of a student, a
  -- leaving taken back by a cancel or an undo (task 3.3 adds its causes).
  cause text not null constraint class_memberships_cause_check check (
    cause in ('placement', 'create', 'cancel', 'undo')
  ),
  -- Who ended it before its own end: a leaving (`leaving_id` names its
  -- inactive status row), or a withdraw of a planned row.
  ended_by text constraint class_memberships_ended_by_check check (
    ended_by in ('leaving', 'withdrawn')
  ),
  leaving_id uuid references student_statuses (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint class_memberships_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint class_memberships_range_check check (
    valid_from <= valid_until and valid_until <= own_until and valid_from < own_until
  ),
  -- A row ended before its own end says who ended it, and only then.
  constraint class_memberships_ended_check check (
    (ended_by is null) = (valid_until = own_until)
  ),
  constraint class_memberships_leaving_check check (
    (ended_by = 'leaving') = (leaving_id is not null)
  ),
  constraint class_memberships_withdrawn_check check (
    ended_by is distinct from 'withdrawn' or valid_until = valid_from
  ),
  -- Developer rules, Membership: one class per student per date, in any
  -- branch. An empty range (a withdrawn row) meets nothing; half-open ends
  -- touch.
  constraint class_memberships_no_overlap exclude using gist (
    student_id with =,
    daterange(valid_from, valid_until) with &&
  )
);

create index class_memberships_class_idx on class_memberships (class_id, valid_from);
create index class_memberships_student_idx on class_memberships (student_id, valid_from);
create index class_memberships_branch_idx on class_memberships (branch_id);
create index class_memberships_leaving_idx on class_memberships (leaving_id);

alter table class_memberships enable row level security;
create policy branch_filter on class_memberships for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on class_memberships to sodiq_app;
grant insert (
  branch_id, student_id, class_id, valid_from, valid_until, own_until, cause, ended_by, leaving_id
) on class_memberships to sodiq_app;
grant update (valid_until, ended_by, leaving_id) on class_memberships to sodiq_app;

-- Today in the time zone of a branch at the moment of the transaction
-- (`app.now`, set by Transactions.run from the injected clock); null without
-- one.
create function branch_today(branch uuid) returns date
language sql
stable
set search_path = pg_catalog, public
as $$
  select (nullif(current_setting('app.now', true), '')::timestamptz at time zone b.time_zone)::date
  from branches b
  where b.id = branch
$$;

-- The largest number of members a class holds on any date of `[from_day,
-- until_day)`, counting every row that is not empty: a scheduled join counts
-- from its date and a scheduled leaving ends the count at its date. The count
-- only rises at the start of a row, so it is read on `from_day` and on each
-- start inside the range. Runs as the invoker: the rows of the class's branch.
create function class_members_peak(class uuid, from_day date, until_day date) returns integer
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(max((
    select count(*)
    from class_memberships m
    where m.class_id = class
      and m.valid_from < m.valid_until
      and m.valid_from <= days.day
      and days.day < m.valid_until
  )), 0)::integer
  from (
    select from_day as day
    union
    select m.valid_from
    from class_memberships m
    where m.class_id = class
      and m.valid_from < m.valid_until
      and m.valid_from > from_day
      and (until_day is null or m.valid_from < until_day)
  ) days
$$;

-- The leaving that ended a row is an inactive status row of a leaving of the
-- same student.
create function class_membership_leaving_valid(student uuid, leaving uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from student_statuses s
    where s.id = leaving
      and s.student_id = student
      and s.status = 'inactive'
      and s.cause = 'leaving'
  )
$$;

-- A new row (decisions 4, 7 and 11). One trigger, the locks first: the
-- student FOR SHARE, so that a status change or a grade edit of the student
-- (which lock it FOR UPDATE) waits or is waited for, whatever route writes;
-- then the class FOR UPDATE, so that two placements into its last seat, an
-- archive, a grade edit or a lower maximum pass one after another. Then each
-- rule is read in a statement of its own (.claude/rules/database.md, the
-- lock-then-read rule): the class is active, its year open, the row inside
-- the year, the grades equal, and the size, at most `max_size` on every date
-- of the row. A row inserted empty (a planned row a scheduled leaving
-- withdraws, written back by a change of that leaving) holds no seat and is
-- not counted. For every user. Runs as the invoker.
create function class_memberships_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  pupil record;
  held record;
  year record;
begin
  perform 1 from students s where s.id = new.student_id for share;
  perform 1 from classes c where c.id = new.class_id and c.branch_id = new.branch_id for update;
  select s.grade, s.branch_id into pupil from students s where s.id = new.student_id;
  if not found or pupil.branch_id is distinct from new.branch_id then
    raise exception 'class_memberships_student_branch'
      using errcode = 'check_violation', constraint = 'class_memberships_student_branch';
  end if;
  select c.archived_at, c.academic_year_id, c.grade, c.max_size into held
    from classes c where c.id = new.class_id and c.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if held.archived_at is not null then
    raise exception 'class_memberships_class_archived'
      using errcode = 'check_violation', constraint = 'class_memberships_class_archived';
  end if;
  perform class_year_open(held.academic_year_id);
  select y.start_date, y.end_date into year
    from academic_years y where y.id = held.academic_year_id;
  if new.valid_from < year.start_date or new.own_until > year.end_date + 1 then
    raise exception 'class_memberships_outside_year'
      using errcode = 'check_violation', constraint = 'class_memberships_outside_year';
  end if;
  if pupil.grade <> held.grade then
    raise exception 'class_memberships_grade'
      using errcode = 'check_violation', constraint = 'class_memberships_grade';
  end if;
  if new.ended_by = 'withdrawn'
    or (new.valid_until = new.valid_from and new.ended_by is distinct from 'leaving') then
    raise exception 'class_memberships_insert_ended'
      using errcode = 'check_violation', constraint = 'class_memberships_insert_ended';
  end if;
  if new.leaving_id is not null
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'class_memberships_leaving'
      using errcode = 'check_violation', constraint = 'class_memberships_leaving';
  end if;
  if new.valid_from < new.valid_until
    and class_members_peak(new.class_id, new.valid_from, new.valid_until) + 1 > held.max_size then
    raise exception 'class_memberships_full'
      using errcode = 'check_violation', constraint = 'class_memberships_full';
  end if;
  return new;
end;
$$;

create trigger class_memberships_guard
  before insert on class_memberships
  for each row execute function class_memberships_guard();

-- Rows only shrink (decision 8): the end in force moves earlier or stays, and
-- the cause of an end is written once. A leaving cuts a row that no one ended
-- or that an earlier leaving cut (the replace of a scheduled leaving by an
-- earlier date names the new one); a withdrawn row is final. Every other
-- column stays. A change of the end in a closed year is refused. For every
-- user. Runs as the invoker.
create function class_memberships_only_shrink() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_id uuid;
begin
  if (to_jsonb(new) - 'valid_until' - 'ended_by' - 'leaving_id')
      is distinct from (to_jsonb(old) - 'valid_until' - 'ended_by' - 'leaving_id')
    or new.valid_until > old.valid_until
    or old.ended_by = 'withdrawn'
    or (old.ended_by = 'leaving' and new.ended_by is null) then
    raise exception 'class_memberships_only_shrink'
      using errcode = 'check_violation', constraint = 'class_memberships_only_shrink';
  end if;
  -- Decision 10: a placement is withdrawn only before its first day in the
  -- branch's time zone; without a moment, never.
  if new.ended_by = 'withdrawn' and old.ended_by is distinct from 'withdrawn'
    and old.valid_from <= coalesce(branch_today(new.branch_id), 'infinity'::date) then
    raise exception 'class_memberships_withdraw_planned'
      using errcode = 'check_violation', constraint = 'class_memberships_withdraw_planned';
  end if;
  if new.leaving_id is not null
    and new.leaving_id is distinct from old.leaving_id
    and not class_membership_leaving_valid(new.student_id, new.leaving_id) then
    raise exception 'class_memberships_leaving'
      using errcode = 'check_violation', constraint = 'class_memberships_leaving';
  end if;
  if new.valid_until <> old.valid_until then
    perform 1 from classes c where c.id = new.class_id for share;
    select c.academic_year_id into year_id from classes c where c.id = new.class_id;
    perform class_year_open(year_id);
  end if;
  return new;
end;
$$;

create trigger class_memberships_only_shrink
  before update on class_memberships
  for each row execute function class_memberships_only_shrink();

-- "An active student with no class is allowed only before their start date",
-- and no class outside the active time: every row of a student that is not
-- empty lies inside the union of the student's active status rows. Checked
-- at the commit, from both tables, so that a leaving that cuts the status and
-- the classes in one transaction passes, and a status change that would
-- leave a class outside the active time fails whatever the application does.
create function class_memberships_active() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  active datemultirange;
begin
  select coalesce(range_agg(daterange(s.valid_from, s.valid_until)), '{}'::datemultirange)
    into active
    from student_statuses s
    where s.student_id = new.student_id
      and s.status = 'active'
      and s.valid_from < coalesce(s.valid_until, 'infinity'::date);
  if exists (
    select 1 from class_memberships m
    where m.student_id = new.student_id
      and m.valid_from < m.valid_until
      and not active @> daterange(m.valid_from, m.valid_until)
  ) then
    raise exception 'class_memberships_active'
      using errcode = 'check_violation', constraint = 'class_memberships_active';
  end if;
  return null;
end;
$$;

create constraint trigger class_memberships_active
  after insert or update on class_memberships
  deferrable initially deferred
  for each row execute function class_memberships_active();

create constraint trigger student_statuses_class_memberships_active
  after insert or update on student_statuses
  deferrable initially deferred
  for each row execute function class_memberships_active();

-- The class's side (decisions 4 and 11), under the lock of the update:
-- - an archive is refused while rows end after the day of the archive in the
--   branch's time zone (members in force or planned);
-- - a grade change is refused while the class has any row that is not empty;
-- - a lower maximum is refused when a date from today on holds more members.
-- Runs as the invoker.
create function classes_members_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  today date := branch_today(new.branch_id);
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from class_memberships m
    where m.class_id = new.id
      and m.valid_from < m.valid_until
      and m.valid_until > (new.archived_at at time zone (
        select b.time_zone from branches b where b.id = new.branch_id
      ))::date
  ) then
    raise exception 'classes_has_members'
      using errcode = 'check_violation', constraint = 'classes_has_members';
  end if;
  if new.grade <> old.grade and exists (
    select 1 from class_memberships m
    where m.class_id = new.id and m.valid_from < m.valid_until
  ) then
    raise exception 'classes_grade_members'
      using errcode = 'check_violation', constraint = 'classes_grade_members';
  end if;
  -- Without a moment every date counts, so a fault never escapes the rule.
  if new.max_size < old.max_size
    and class_members_peak(new.id, coalesce(today, '-infinity'::date), null) > new.max_size then
    raise exception 'classes_size_below_members'
      using errcode = 'check_violation', constraint = 'classes_size_below_members';
  end if;
  return new;
end;
$$;

create trigger classes_members_guard
  before update of archived_at, grade, max_size on classes
  for each row execute function classes_members_guard();

-- The student's side of the grade rule (decision 4), on every route that
-- writes the grade (the edit and the return): refused while a row ending
-- after today is of a class of another grade. Runs as the invoker.
create function students_grade_class() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  today date := coalesce(branch_today(new.branch_id), '-infinity'::date);
begin
  if exists (
    select 1 from class_memberships m
    join classes c on c.id = m.class_id
    where m.student_id = new.id
      and m.valid_from < m.valid_until
      and m.valid_until > today
      and c.grade <> new.grade
  ) then
    raise exception 'students_grade_class'
      using errcode = 'check_violation', constraint = 'students_grade_class';
  end if;
  return new;
end;
$$;

create trigger students_grade_class
  before update of grade on students
  for each row
  when (new.grade is distinct from old.grade)
  execute function students_grade_class();

-- Decision 3 with correction 4: the dates of a year frame every row of its
-- classes, past rows included, so they cannot change while a class of the
-- year holds a row that is not empty. Runs as the invoker.
create function academic_years_has_members() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from class_memberships m
    join classes c on c.id = m.class_id
    where c.academic_year_id = new.id and m.valid_from < m.valid_until
  ) then
    raise exception 'academic_years_has_members'
      using errcode = 'check_violation', constraint = 'academic_years_has_members';
  end if;
  return new;
end;
$$;

create trigger academic_years_has_members
  before update of start_date, end_date on academic_years
  for each row
  when (new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date)
  execute function academic_years_has_members();
