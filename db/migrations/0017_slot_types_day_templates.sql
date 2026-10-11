-- 0017 Slot types and day templates (task 1.5).
--
-- docs/spec/03-school-setup.md, Slot types and day templates: "Slot types and
-- day templates belong to a branch ... A slot type has a name, a kind (lesson
-- or break) and a length in minutes ... A day template is a start time and an
-- ordered list of slots chosen from these types ... every start and end time
-- is calculated from the order and the lengths. Times are never typed by hand
-- ... A branch has a default template; another template can be set for a range
-- of grades inside the branch, for a weekday, for a weekday and a range of
-- grades together, and for a special date in the calendar ... Grade ranges set
-- at one level may not overlap. A template set at any level takes effect from
-- a chosen date, tomorrow at the earliest, and its history is kept."
-- docs/spec/edge-cases/time-dates-calendar.md, "A slot type's length or a day
-- template is changed mid-year": "The change takes effect from a chosen date,
-- tomorrow at the earliest."
-- docs/spec/edge-cases/developer-rules.md, Lesson times: "Ranges are
-- half-open".
--
-- The owner's answers 9 to 14 (docs/decisions.md, "Decided ahead for tasks 1.3
-- to 1.6") and the plan approved on pull request #46 with its corrections.
--
-- Lengths, template versions and assignments are dated rows: in force over
-- [valid_from, valid_until), open while valid_until is empty. A change from a
-- date cuts the row in force, withdraws a planned row starting on or after
-- that date (valid_until = valid_from, an empty range kept as history) and
-- inserts the new row; the API writes valid_from from the injected clock and
-- decides "tomorrow at the earliest" (CLAUDE.md, Time is injected). Here the
-- database keeps: no two rows of one key on one date (exclusion constraints),
-- a row only ever shrinks (dated_rows_only_shrink), nothing else of a dated
-- row changes (the grants, and the same trigger for every user), nothing is
-- deleted (no delete grant).
--
-- Every refusal raised here names a constraint, which the API maps to an error
-- code (apps/api/src/modules/setup/setup-refusals.ts).

-- A dated row changes only by its end moving earlier: from open to a date, or
-- from a date to an earlier one, never later and never back to open. Every
-- other column stays as it was written. One function for the three tables of
-- dated rows; not SECURITY DEFINER.
create function dated_rows_only_shrink() returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'valid_until') is distinct from (to_jsonb(old) - 'valid_until')
    or (old.valid_until is not null
      and (new.valid_until is null or new.valid_until > old.valid_until)) then
    raise exception 'dated_rows_only_shrink'
      using errcode = 'check_violation', constraint = 'dated_rows_only_shrink';
  end if;
  return new;
end
$$;

-- Slot types (answer 9): name unique per branch among active rows, kind lesson
-- or break (lunch is a break named Lunch), archived when unused, never deleted.
create table slot_types (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- SLOT_TYPE_NAME_MAX_LENGTH of packages/shared.
  name text not null constraint slot_types_name_check check (
    length(btrim(name)) between 1 and 60
  ),
  -- Fixed at creation (decision 3): not granted for update, so a lesson slot
  -- never turns into a break under a template.
  kind text not null constraint slot_types_kind_check check (kind in ('lesson', 'break')),
  -- From the injected clock; empty while active.
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint slot_types_id_branch_key unique (id, branch_id)
);

create unique index slot_types_active_name_idx
  on slot_types (branch_id, lower(btrim(name))) where archived_at is null;

alter table slot_types enable row level security;
create policy branch_filter on slot_types for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on slot_types to sodiq_app;
grant insert (branch_id, name, kind) on slot_types to sodiq_app;
grant update (name, archived_at) on slot_types to sodiq_app;

-- The length of a slot type, 5 to 180 whole minutes (answer 9), dated
-- (answer 12, decision 2): the times of a date use the length in force on it.
create table slot_type_lengths (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  slot_type_id uuid not null,
  -- SLOT_LENGTH_MIN_MINUTES and SLOT_LENGTH_MAX_MINUTES of packages/shared.
  length_minutes smallint not null constraint slot_type_lengths_length_check check (
    length_minutes between 5 and 180
  ),
  valid_from date not null,
  valid_until date,
  created_at timestamptz not null default now(),
  constraint slot_type_lengths_range_check check (valid_until is null or valid_until >= valid_from),
  constraint slot_type_lengths_slot_type_fkey foreign key (slot_type_id, branch_id)
    references slot_types (id, branch_id),
  constraint slot_type_lengths_no_overlap exclude using gist (
    branch_id with =,
    slot_type_id with =,
    daterange(valid_from, valid_until, '[)') with &&
  )
);

alter table slot_type_lengths enable row level security;
create policy branch_filter on slot_type_lengths for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create trigger slot_type_lengths_only_shrink
  before update on slot_type_lengths
  for each row execute function dated_rows_only_shrink();

grant select on slot_type_lengths to sodiq_app;
grant insert (branch_id, slot_type_id, length_minutes, valid_from, valid_until)
  on slot_type_lengths to sodiq_app;
grant update (valid_until) on slot_type_lengths to sodiq_app;

-- Day templates: a name; the start time and the slots are in its versions.
create table day_templates (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- DAY_TEMPLATE_NAME_MAX_LENGTH of packages/shared.
  name text not null constraint day_templates_name_check check (
    length(btrim(name)) between 1 and 60
  ),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint day_templates_id_branch_key unique (id, branch_id)
);

create unique index day_templates_active_name_idx
  on day_templates (branch_id, lower(btrim(name))) where archived_at is null;

alter table day_templates enable row level security;
create policy branch_filter on day_templates for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on day_templates to sodiq_app;
grant insert (branch_id, name) on day_templates to sodiq_app;
grant update (name, archived_at) on day_templates to sodiq_app;

-- A version of a template: the one typed time, in minutes after midnight
-- (answer 10, decision 6), and its slots (below), dated (answer 12).
create table day_template_versions (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  day_template_id uuid not null,
  start_minutes smallint not null constraint day_template_versions_start_check check (
    start_minutes between 0 and 1439
  ),
  valid_from date not null,
  valid_until date,
  -- The transaction that wrote the version, set once at insert and granted to
  -- nobody: its slots can be written in that transaction only
  -- (day_template_slots_same_transaction). Not xmin, which an update of the
  -- row (a cut) changes.
  created_xact xid8 not null default pg_current_xact_id(),
  created_at timestamptz not null default now(),
  constraint day_template_versions_range_check check (
    valid_until is null or valid_until >= valid_from
  ),
  constraint day_template_versions_id_branch_key unique (id, branch_id),
  constraint day_template_versions_template_fkey foreign key (day_template_id, branch_id)
    references day_templates (id, branch_id),
  constraint day_template_versions_no_overlap exclude using gist (
    branch_id with =,
    day_template_id with =,
    daterange(valid_from, valid_until, '[)') with &&
  )
);

alter table day_template_versions enable row level security;
create policy branch_filter on day_template_versions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create trigger day_template_versions_only_shrink
  before update on day_template_versions
  for each row execute function dated_rows_only_shrink();

grant select on day_template_versions to sodiq_app;
grant insert (branch_id, day_template_id, start_minutes, valid_from, valid_until)
  on day_template_versions to sodiq_app;
grant update (valid_until) on day_template_versions to sodiq_app;

-- The slots of a version in their order: 1 to 20, at least one lesson slot
-- (answer 10). Written once, with the version; never changed.
create table day_template_slots (
  version_id uuid not null,
  branch_id uuid not null references branches (id),
  position smallint not null constraint day_template_slots_position_check check (
    position between 1 and 20
  ),
  slot_type_id uuid not null,
  constraint day_template_slots_pkey primary key (version_id, position),
  constraint day_template_slots_version_fkey foreign key (version_id, branch_id)
    references day_template_versions (id, branch_id),
  constraint day_template_slots_slot_type_fkey foreign key (slot_type_id, branch_id)
    references slot_types (id, branch_id)
);

create index day_template_slots_slot_type_idx on day_template_slots (slot_type_id);

alter table day_template_slots enable row level security;
create policy branch_filter on day_template_slots for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A saved version never gains a slot: a slot is written only in the
-- transaction that wrote its version. The version is read with the branch
-- filter of the caller; a version of another branch is refused by the key.
create function day_template_slots_same_transaction() returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from day_template_versions
    where id = new.version_id and created_xact = pg_current_xact_id()
  ) then
    raise exception 'day_template_slots_same_transaction'
      using errcode = 'check_violation', constraint = 'day_template_slots_same_transaction';
  end if;
  return new;
end
$$;

create trigger day_template_slots_same_transaction
  before insert on day_template_slots
  for each row execute function day_template_slots_same_transaction();

-- At the end of the transaction, for the version written: 1 to 20 slots at
-- positions 1 to n without a gap, and at least one lesson slot (answer 10).
-- The kind of a slot type never changes, so the check stays true.
create function day_template_version_slots_check() returns trigger
language plpgsql
as $$
declare
  checked_id uuid;
  slot_count integer;
  last_position integer;
  lesson_count integer;
begin
  if tg_table_name = 'day_template_slots' then
    checked_id := new.version_id;
  else
    checked_id := new.id;
  end if;

  select count(*), coalesce(max(slot.position), 0),
         count(*) filter (where slot_type.kind = 'lesson')
    into slot_count, last_position, lesson_count
    from day_template_slots slot
    join slot_types slot_type on slot_type.id = slot.slot_type_id
    where slot.version_id = checked_id;

  if slot_count < 1 or slot_count > 20 or last_position <> slot_count then
    raise exception 'day_template_version_slots_count'
      using errcode = 'check_violation', constraint = 'day_template_version_slots_count';
  end if;
  if lesson_count < 1 then
    raise exception 'day_template_version_lesson_slot'
      using errcode = 'check_violation', constraint = 'day_template_version_lesson_slot';
  end if;
  return null;
end
$$;

create constraint trigger day_template_version_slots_check
  after insert on day_template_versions
  deferrable initially deferred
  for each row execute function day_template_version_slots_check();

create constraint trigger day_template_version_slots_check
  after insert on day_template_slots
  deferrable initially deferred
  for each row execute function day_template_version_slots_check();

grant select on day_template_slots to sodiq_app;
grant insert (version_id, branch_id, position, slot_type_id) on day_template_slots to sodiq_app;

-- Where a template applies (answer 11): the default, a grade range, a weekday
-- (ISO, Monday 1 to Sunday 7), a weekday with a grade range, each from a date.
-- Special dates come with the calendar (task 1.4). Grades are 1 to 11
-- (answer 13). On any date: one default, one template per weekday, and grade
-- ranges at one level (and weekday) never overlap
-- (day_template_assignments_no_overlap; `03`, "Grade ranges set at one level
-- may not overlap").
create table day_template_assignments (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  level text not null constraint day_template_assignments_level_check check (
    level in ('default', 'grades', 'weekday', 'weekday_grades')
  ),
  weekday smallint constraint day_template_assignments_weekday_check check (
    weekday between 1 and 7
  ),
  grade_from smallint constraint day_template_assignments_grade_from_check check (
    grade_from between 1 and 11
  ),
  grade_to smallint constraint day_template_assignments_grade_to_check check (
    grade_to between 1 and 11
  ),
  day_template_id uuid not null,
  valid_from date not null,
  valid_until date,
  created_at timestamptz not null default now(),
  -- The weekday is given for the two weekday levels only, the grade range for
  -- the two grade levels only, and a range runs upwards.
  constraint day_template_assignments_key_check check (
    (weekday is not null) = (level in ('weekday', 'weekday_grades'))
    and (grade_from is not null) = (level in ('grades', 'weekday_grades'))
    and (grade_to is not null) = (level in ('grades', 'weekday_grades'))
    and (grade_from is null or grade_from <= grade_to)
  ),
  constraint day_template_assignments_range_check check (
    valid_until is null or valid_until >= valid_from
  ),
  constraint day_template_assignments_template_fkey foreign key (day_template_id, branch_id)
    references day_templates (id, branch_id),
  constraint day_template_assignments_no_overlap exclude using gist (
    branch_id with =,
    level with =,
    (coalesce(weekday, 0)) with =,
    int4range(coalesce(grade_from, 1), coalesce(grade_to, 11), '[]') with &&,
    daterange(valid_from, valid_until, '[)') with &&
  )
);

alter table day_template_assignments enable row level security;
create policy branch_filter on day_template_assignments for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create trigger day_template_assignments_only_shrink
  before update on day_template_assignments
  for each row execute function dated_rows_only_shrink();

grant select on day_template_assignments to sodiq_app;
grant insert (
  branch_id, level, weekday, grade_from, grade_to, day_template_id, valid_from, valid_until
) on day_template_assignments to sodiq_app;
grant update (valid_until) on day_template_assignments to sodiq_app;
