-- 0058 Lessons, pattern and time claims (task 5.1a, pull request #107).
--
-- docs/spec/06-timetable.md, Model: "Pattern entry: weekday, slot, class or
-- group, subject, teacher, room. Repeats every week." "Dated lesson: a real
-- lesson on a real date, generated from the published pattern". Rules: "A
-- teacher cannot be in two lessons at the same time." "A room cannot hold two
-- lessons at the same time, unless the room is marked as shared". "A class
-- cannot have two lessons at the same time. No student can be in two lessons
-- at once". docs/spec/edge-cases/timetable.md, Structure: "Every clash check
-- uses real clock time, never slot numbers: in the grid, on the server, in the
-- generator and in the database." "The unit that occupies a class is the
-- lesson block." "A room has a 'shared' switch and a maximum number of lessons
-- at the same time. Capacity is checked against the students of all of them
-- together." docs/spec/edge-cases/developer-rules.md: Lesson times, Teacher in
-- one place, Room in one use, Class in one block, Exams (the one table of time
-- claims), Pattern entries.
--
-- The plan approved on pull request #107 with corrections 1 to 6: decisions
-- 2 to 19. Exams on the claims and the re-check of the claims when group
-- classes, memberships or a room's switch change come with 5.1b (decision 1).
-- No route writes these tables yet (decision 15); every refusal raised here
-- names a constraint for the routes of 5.4a, 5.5b and 5.6a, which pass on the
-- name only, never the detail of an exclusion error (it names another
-- branch's teacher and time).

-- Decision 3: the application cannot create a temporary table, so it cannot
-- reach a trigger of its own that would write claims from inside a trigger.
-- Each test database copied from the template gets the same revoke
-- (apps/api/src/testing/test-database.ts): a database's rights are not copied.
do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
  execute format('revoke temporary on database %I from sodiq_app', current_database());
end;
$$;

-- Decision 19: a pattern entry's load row and teacher (the entry's teacher is
-- always the row's), and a lesson's load row with its subject.
alter table teaching_load_rows
  add constraint teaching_load_rows_entry_key unique (id, version_id, branch_id, teacher_id),
  add constraint teaching_load_rows_lesson_key unique (id, branch_id, subject_id);

-- A write the database's own triggers make, refused when the application
-- makes it directly (decision 3): a direct statement runs its triggers at
-- depth 1, a write from a trigger or a cascade at depth 2 or more.
create function timetable_trigger_only() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() <= 1 then
    raise exception '%', tg_argv[0]
      using errcode = 'check_violation', constraint = tg_argv[0];
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The weekly pattern of a version.

create table pattern_blocks (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  -- ISO weekday, 1 Monday to 7 Sunday.
  weekday smallint not null constraint pattern_blocks_weekday_check check (weekday between 1 and 7),
  -- The position of the lesson slot in the day template (day_template_slots).
  slot_position smallint not null constraint pattern_blocks_slot_check check (
    slot_position between 1 and 20
  ),
  -- Decision 7: the clock time of that slot in the template in force on the
  -- version's start date for the block's grades, computed by the API.
  start_minutes smallint not null constraint pattern_blocks_start_check check (
    start_minutes between 0 and 1439
  ),
  end_minutes smallint not null constraint pattern_blocks_end_check check (
    end_minutes between 1 and 1440
  ),
  -- Decision 17: the two blocks of a double lesson share it.
  double_pair_id uuid,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint pattern_blocks_order_check check (end_minutes > start_minutes),
  constraint pattern_blocks_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id),
  constraint pattern_blocks_id_branch_key unique (id, branch_id),
  constraint pattern_blocks_version_key unique (id, version_id, branch_id),
  constraint pattern_blocks_time_key
    unique (id, version_id, branch_id, weekday, start_minutes, end_minutes)
);

create index pattern_blocks_version_idx on pattern_blocks (version_id);
create index pattern_blocks_pair_idx on pattern_blocks (double_pair_id)
  where double_pair_id is not null;

alter table pattern_blocks enable row level security;
create policy branch_filter on pattern_blocks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on pattern_blocks to sodiq_app;
grant insert (
  branch_id, version_id, weekday, slot_position, start_minutes, end_minutes, double_pair_id
) on pattern_blocks to sodiq_app;
grant update (weekday, slot_position, start_minutes, end_minutes, double_pair_id)
  on pattern_blocks to sodiq_app;

create table pattern_entries (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  block_id uuid not null,
  -- The block's weekday and minutes, kept equal by the key.
  weekday smallint not null,
  start_minutes smallint not null,
  end_minutes smallint not null,
  -- The class or group and the subject come from the load row.
  load_row_id uuid not null,
  -- Decision 19: the load row's teacher or vacancy, kept equal by the key.
  teacher_id uuid not null references staff (id),
  room_id uuid,
  -- Copied from rooms.shared by pattern_entries_room; no grant.
  room_shared boolean not null default false,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint pattern_entries_block_fkey
    foreign key (block_id, version_id, branch_id, weekday, start_minutes, end_minutes)
    references pattern_blocks (id, version_id, branch_id, weekday, start_minutes, end_minutes)
    on update cascade on delete cascade,
  constraint pattern_entries_load_row_fkey
    foreign key (load_row_id, version_id, branch_id, teacher_id)
    references teaching_load_rows (id, version_id, branch_id, teacher_id)
    on update cascade on delete cascade,
  constraint pattern_entries_room_fkey foreign key (room_id, branch_id)
    references rooms (id, branch_id),
  constraint pattern_entries_id_branch_key unique (id, branch_id),
  constraint pattern_entries_block_row_key unique (block_id, load_row_id),
  -- edge/developer-rules, Pattern entries: "The same teacher, room and class
  -- rules per version" (decision 6: immediate, deferrable for a swap).
  constraint pattern_entries_teacher_excl exclude using gist (
    version_id with =,
    weekday with =,
    teacher_id with =,
    int4range(start_minutes, end_minutes) with &&
  ) deferrable initially immediate,
  constraint pattern_entries_room_excl exclude using gist (
    version_id with =,
    weekday with =,
    room_id with =,
    int4range(start_minutes, end_minutes) with &&
  ) where (room_id is not null and not room_shared) deferrable initially immediate
);

create index pattern_entries_block_idx on pattern_entries (block_id);
create index pattern_entries_load_row_idx on pattern_entries (load_row_id, version_id, branch_id, teacher_id);
create index pattern_entries_room_idx on pattern_entries (room_id) where room_id is not null;

alter table pattern_entries enable row level security;
create policy branch_filter on pattern_entries for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on pattern_entries to sodiq_app;
grant insert (
  branch_id, version_id, block_id, weekday, start_minutes, end_minutes, load_row_id, teacher_id,
  room_id
) on pattern_entries to sodiq_app;
grant update (room_id) on pattern_entries to sodiq_app;

-- The classes a pattern block occupies, written only by the trigger of
-- pattern_entries (decision 3).
create table pattern_block_classes (
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  block_id uuid not null,
  weekday smallint not null,
  start_minutes smallint not null,
  end_minutes smallint not null,
  class_id uuid not null,
  constraint pattern_block_classes_pkey primary key (block_id, class_id),
  constraint pattern_block_classes_block_fkey
    foreign key (block_id, version_id, branch_id, weekday, start_minutes, end_minutes)
    references pattern_blocks (id, version_id, branch_id, weekday, start_minutes, end_minutes)
    on update cascade on delete cascade,
  constraint pattern_block_classes_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  -- Two lessons of one block share a class by design; two blocks never do.
  constraint pattern_block_classes_excl exclude using gist (
    version_id with =,
    weekday with =,
    class_id with =,
    block_id with <>,
    int4range(start_minutes, end_minutes) with &&
  ) deferrable initially immediate
);

create index pattern_block_classes_class_idx on pattern_block_classes (class_id);

alter table pattern_block_classes enable row level security;
create policy branch_filter on pattern_block_classes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The rights the trigger needs; the guard refuses them to a direct statement.
grant select, insert, update, delete on pattern_block_classes to sodiq_app;

create trigger pattern_block_classes_guard
  before insert or update or delete on pattern_block_classes
  for each row execute function timetable_trigger_only('pattern_block_classes_direct');

-- The pattern changes only in a draft of a year that is not closed (the 0055
-- rule for load rows). At the commit, not in a before-row trigger
-- (.claude/rules/database.md: a lock of a shared parent there deadlocks two
-- updaters): the year and then the version are locked FOR SHARE whatever
-- their state and read afterwards. Runs as the invoker.
create function pattern_rows_draft() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  version_ref uuid;
  version_year uuid;
  version_state text;
  year_state text;
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
  if version_state <> 'draft' then
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

create constraint trigger pattern_blocks_draft
  after insert or update or delete on pattern_blocks
  deferrable initially deferred
  for each row execute function pattern_rows_draft();

create constraint trigger pattern_entries_draft
  after insert or update or delete on pattern_entries
  deferrable initially deferred
  for each row execute function pattern_rows_draft();

-- The shared flag of the room, copied onto the entry so the constraint can
-- read it (edge/developer-rules, Room in one use).
create function pattern_entries_room() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.room_shared := coalesce(
    (select r.shared from rooms r where r.id = new.room_id and r.branch_id = new.branch_id),
    false
  );
  return new;
end;
$$;

create trigger pattern_entries_room
  before insert or update of room_id on pattern_entries
  for each row execute function pattern_entries_room();

-- A shared room holds at most its number of lessons at once in a version's
-- weekday (decision 2; the pattern has no date, so lessons only, decision 8).
-- The most at once is reached at a start: the entry's own, or that of an
-- entry starting inside it (correction 3). Re-reads the entry first: a later
-- statement of the transaction may have removed it. Runs as the invoker.
create function pattern_entries_shared_room() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  entry pattern_entries%rowtype;
  most integer;
  busiest integer;
begin
  select * into entry from pattern_entries e where e.id = new.id;
  if not found or entry.room_id is null or not entry.room_shared then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_room:' || entry.room_id::text, 0));
  select r.max_simultaneous_lessons into most from rooms r where r.id = entry.room_id;
  select max(at_once) into busiest from (
    select (
      select count(*) from pattern_entries o
      where o.version_id = entry.version_id
        and o.weekday = entry.weekday
        and o.room_id = entry.room_id
        and o.start_minutes <= moments.minute
        and o.end_minutes > moments.minute
    ) as at_once
    from (
      select entry.start_minutes as minute
      union
      select o.start_minutes from pattern_entries o
      where o.version_id = entry.version_id
        and o.weekday = entry.weekday
        and o.room_id = entry.room_id
        and o.start_minutes > entry.start_minutes
        and o.start_minutes < entry.end_minutes
    ) moments
  ) counted;
  if most is not null and busiest > most then
    raise exception 'pattern_room_shared_full'
      using errcode = 'check_violation', constraint = 'pattern_room_shared_full';
  end if;
  return null;
end;
$$;

create constraint trigger pattern_entries_shared_room
  after insert or update of room_id, weekday, start_minutes, end_minutes on pattern_entries
  deferrable initially deferred
  for each row execute function pattern_entries_shared_room();

-- The classes of a pattern block: the class of a class row, the classes of a
-- group row's group as they are now (decision 9). Runs as the invoker.
create function pattern_block_classes_sync(block_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block pattern_blocks%rowtype;
begin
  select * into block from pattern_blocks b where b.id = block_ref;
  if not found then
    return;
  end if;
  with wanted as (
    select r.class_id from pattern_entries e
      join teaching_load_rows r on r.id = e.load_row_id
      where e.block_id = block_ref and r.class_id is not null
    union
    select gc.class_id from pattern_entries e
      join teaching_load_rows r on r.id = e.load_row_id
      join group_classes gc on gc.group_id = r.group_id
      where e.block_id = block_ref
  )
  delete from pattern_block_classes c
    where c.block_id = block_ref and c.class_id not in (select w.class_id from wanted w);
  insert into pattern_block_classes (
    branch_id, version_id, block_id, weekday, start_minutes, end_minutes, class_id
  )
  select block.branch_id, block.version_id, block.id, block.weekday, block.start_minutes,
    block.end_minutes, w.class_id
  from (
    select r.class_id from pattern_entries e
      join teaching_load_rows r on r.id = e.load_row_id
      where e.block_id = block_ref and r.class_id is not null
    union
    select gc.class_id from pattern_entries e
      join teaching_load_rows r on r.id = e.load_row_id
      join group_classes gc on gc.group_id = r.group_id
      where e.block_id = block_ref
  ) w
  order by w.class_id
  on conflict (block_id, class_id) do nothing;
end;
$$;

create function pattern_entries_classes() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform pattern_block_classes_sync(old.block_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform pattern_block_classes_sync(new.block_id);
  end if;
  return null;
end;
$$;

create trigger pattern_entries_classes
  after insert or delete or update of block_id, load_row_id on pattern_entries
  for each row execute function pattern_entries_classes();

-- Decision 17: at most two blocks share a double pair, on one weekday.
create function pattern_blocks_double() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  pair uuid;
begin
  select b.double_pair_id into pair from pattern_blocks b where b.id = new.id;
  if pair is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_pair:' || pair::text, 0));
  if (select count(*) from pattern_blocks b where b.double_pair_id = pair) > 2
    or (select count(distinct (b.version_id, b.weekday)) from pattern_blocks b
      where b.double_pair_id = pair) > 1 then
    raise exception 'pattern_double_pair'
      using errcode = 'check_violation', constraint = 'pattern_double_pair';
  end if;
  return null;
end;
$$;

create constraint trigger pattern_blocks_double
  after insert or update of double_pair_id, weekday on pattern_blocks
  deferrable initially deferred
  for each row execute function pattern_blocks_double();

-- ---------------------------------------------------------------------------
-- Dated lessons.

create table lesson_blocks (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  academic_year_id uuid not null,
  -- edge/00-definitions, Quarter of a lesson: "It is stored on the lesson".
  quarter_id uuid not null,
  -- The school date in the branch's time zone.
  lesson_date date not null,
  -- edge/developer-rules, Lesson times: "Every dated lesson stores its own
  -- start and end with time zone, copied when it is created."
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- A regular block comes from a version's pattern; an extra lesson has
  -- neither (decision 13, correction 2).
  version_id uuid,
  pattern_block_id uuid,
  kind text not null constraint lesson_blocks_kind_check check (kind in ('regular', 'extra')),
  -- Decision 17.
  double_pair_id uuid,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_blocks_order_check check (ends_at > starts_at),
  constraint lesson_blocks_source_check check (
    (kind = 'regular') = (version_id is not null)
    and (kind = 'regular') = (pattern_block_id is not null)
  ),
  constraint lesson_blocks_year_fkey foreign key (academic_year_id, branch_id)
    references academic_years (id, branch_id),
  constraint lesson_blocks_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint lesson_blocks_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id),
  constraint lesson_blocks_pattern_fkey foreign key (pattern_block_id, version_id, branch_id)
    references pattern_blocks (id, version_id, branch_id),
  constraint lesson_blocks_id_branch_key unique (id, branch_id),
  constraint lesson_blocks_time_key unique (id, branch_id, lesson_date, starts_at, ends_at)
);

create index lesson_blocks_date_idx on lesson_blocks (branch_id, lesson_date);
create index lesson_blocks_version_idx on lesson_blocks (version_id) where version_id is not null;
create index lesson_blocks_pattern_idx on lesson_blocks (pattern_block_id)
  where pattern_block_id is not null;
create index lesson_blocks_pair_idx on lesson_blocks (double_pair_id)
  where double_pair_id is not null;

alter table lesson_blocks enable row level security;
create policy branch_filter on lesson_blocks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Decision 12: no delete yet (5.5b, 5.5c, 5.6b and 5.8 add it, each in a
-- migration of its own); the version and pattern block have no update grant
-- (5.5b decides).
grant select on lesson_blocks to sodiq_app;
grant insert (
  branch_id, academic_year_id, quarter_id, lesson_date, starts_at, ends_at, version_id,
  pattern_block_id, kind, double_pair_id
) on lesson_blocks to sodiq_app;
grant update (quarter_id, lesson_date, starts_at, ends_at, double_pair_id)
  on lesson_blocks to sodiq_app;

-- The date, the quarter and the version of a block. Runs as the invoker.
create function lesson_blocks_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  zone text;
  quarter_year uuid;
  quarter_start date;
  quarter_end date;
  version_year uuid;
  version_state text;
  moment timestamptz;
begin
  select b.time_zone into zone from branches b where b.id = new.branch_id;
  if zone is null then
    -- The foreign key answers it.
    return new;
  end if;
  if (new.starts_at at time zone zone)::date <> new.lesson_date
    or (new.ends_at at time zone zone)::date <> new.lesson_date then
    raise exception 'lesson_block_date'
      using errcode = 'check_violation', constraint = 'lesson_block_date';
  end if;

  select q.academic_year_id, q.start_date, q.end_date
    into quarter_year, quarter_start, quarter_end
    from quarters q where q.id = new.quarter_id and q.branch_id = new.branch_id;
  if found and (
    quarter_year is distinct from new.academic_year_id
    or quarter_start is null
    or new.lesson_date not between quarter_start and quarter_end
  ) then
    raise exception 'lesson_block_quarter'
      using errcode = 'check_violation', constraint = 'lesson_block_quarter';
  end if;

  if tg_op = 'INSERT' and new.version_id is not null then
    perform 1 from timetable_versions v where v.id = new.version_id for share;
    select v.academic_year_id, v.status into version_year, version_state
      from timetable_versions v where v.id = new.version_id and v.branch_id = new.branch_id;
    if found and (version_year is distinct from new.academic_year_id or version_state = 'draft') then
      raise exception 'lesson_block_version'
        using errcode = 'check_violation', constraint = 'lesson_block_version';
    end if;
  end if;

  -- A move stays in its quarter, and a held lesson never changes quarter
  -- (edge/time-dates-calendar); without a moment of the transaction, no
  -- quarter changes (correction 4).
  if tg_op = 'UPDATE' and new.quarter_id is distinct from old.quarter_id then
    moment := class_tutors_moment();
    if new.lesson_date is distinct from old.lesson_date
      or moment is null
      or old.starts_at <= moment then
      raise exception 'lesson_block_quarter_fixed'
        using errcode = 'check_violation', constraint = 'lesson_block_quarter_fixed';
    end if;
  end if;
  return new;
end;
$$;

create trigger lesson_blocks_check
  before insert or update on lesson_blocks
  for each row execute function lesson_blocks_check();

-- Decision 17: at most two blocks share a double pair, on one date.
create function lesson_blocks_double() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  pair uuid;
begin
  select b.double_pair_id into pair from lesson_blocks b where b.id = new.id;
  if pair is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_pair:' || pair::text, 0));
  if (select count(*) from lesson_blocks b where b.double_pair_id = pair) > 2
    or (select count(distinct b.lesson_date) from lesson_blocks b
      where b.double_pair_id = pair) > 1 then
    raise exception 'lesson_double_pair'
      using errcode = 'check_violation', constraint = 'lesson_double_pair';
  end if;
  return null;
end;
$$;

create constraint trigger lesson_blocks_double
  after insert or update of double_pair_id, lesson_date on lesson_blocks
  deferrable initially deferred
  for each row execute function lesson_blocks_double();

create table lessons (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  block_id uuid not null,
  -- The block's date, start and end, kept equal by the key (decision 5).
  lesson_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  class_id uuid,
  group_id uuid,
  subject_id uuid not null references subjects (id),
  -- Both for a lesson of a regular block, neither for an extra lesson
  -- (correction 2).
  load_row_id uuid,
  pattern_entry_id uuid,
  -- Decision 16: nobody recorded is null; a vacancy stays in the column
  -- (edge/developer-rules, Teacher in one place).
  teacher_id uuid references staff (id),
  -- Null: "needs a room".
  room_id uuid,
  -- Decision 11: not cancelled while null.
  cancel_cause text constraint lessons_cancel_cause_check check (
    cancel_cause in ('not_in_template', 'exam', 'exam_week', 'day_off', 'reason')
  ),
  cancel_reason text constraint lessons_cancel_reason_check check (
    length(btrim(cancel_reason)) between 1 and 500
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lessons_unit_check check ((class_id is null) <> (group_id is null)),
  constraint lessons_reason_check check ((cancel_cause = 'reason') = (cancel_reason is not null)
    and (cancel_cause is not null or cancel_reason is null)),
  constraint lessons_source_check check ((load_row_id is null) = (pattern_entry_id is null)),
  constraint lessons_block_fkey foreign key (block_id, branch_id, lesson_date, starts_at, ends_at)
    references lesson_blocks (id, branch_id, lesson_date, starts_at, ends_at)
    on update cascade,
  constraint lessons_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint lessons_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id),
  constraint lessons_load_row_fkey foreign key (load_row_id, branch_id, subject_id)
    references teaching_load_rows (id, branch_id, subject_id),
  constraint lessons_pattern_entry_fkey foreign key (pattern_entry_id, branch_id)
    references pattern_entries (id, branch_id),
  constraint lessons_room_fkey foreign key (room_id, branch_id)
    references rooms (id, branch_id),
  constraint lessons_id_branch_key unique (id, branch_id)
);

create unique index lessons_block_class_key on lessons (block_id, class_id)
  where class_id is not null;
create unique index lessons_block_group_key on lessons (block_id, group_id)
  where group_id is not null;
create index lessons_block_fkey_idx on lessons (block_id, branch_id, lesson_date, starts_at, ends_at);
create index lessons_class_idx on lessons (class_id, lesson_date) where class_id is not null;
create index lessons_group_idx on lessons (group_id, lesson_date) where group_id is not null;
create index lessons_teacher_idx on lessons (teacher_id, lesson_date) where teacher_id is not null;
create index lessons_room_idx on lessons (room_id, lesson_date) where room_id is not null;
create index lessons_load_row_idx on lessons (load_row_id) where load_row_id is not null;
create index lessons_pattern_entry_idx on lessons (pattern_entry_id)
  where pattern_entry_id is not null;

alter table lessons enable row level security;
create policy branch_filter on lessons for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- 06, Protection: "Its teacher, room and time can change"; the class, group
-- and subject never change. Decision 12: no delete yet.
grant select on lessons to sodiq_app;
grant insert (
  branch_id, block_id, lesson_date, starts_at, ends_at, class_id, group_id, subject_id,
  load_row_id, pattern_entry_id, teacher_id, room_id, cancel_cause, cancel_reason
) on lessons to sodiq_app;
grant update (teacher_id, room_id, cancel_cause, cancel_reason) on lessons to sodiq_app;

-- The unit, the load row and the pattern entry of a new lesson, against its
-- block. Runs as the invoker.
create function lessons_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block lesson_blocks%rowtype;
  unit_year uuid;
  group_subject uuid;
  row_version uuid;
  row_class uuid;
  row_group uuid;
  entry_block uuid;
  entry_row uuid;
begin
  select * into block from lesson_blocks b
    where b.id = new.block_id and b.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;

  if new.class_id is not null then
    select c.academic_year_id into unit_year from classes c
      where c.id = new.class_id and c.branch_id = new.branch_id;
  elsif new.group_id is not null then
    select g.academic_year_id, g.subject_id into unit_year, group_subject from groups g
      where g.id = new.group_id and g.branch_id = new.branch_id;
  end if;
  if unit_year is not null and unit_year <> block.academic_year_id then
    raise exception 'lesson_unit_year'
      using errcode = 'check_violation', constraint = 'lesson_unit_year';
  end if;
  if new.group_id is not null and group_subject is distinct from new.subject_id then
    raise exception 'lesson_group_subject'
      using errcode = 'check_violation', constraint = 'lesson_group_subject';
  end if;

  -- Correction 2: a lesson of a regular block names its load row and pattern
  -- entry, an extra lesson neither.
  if (block.kind = 'regular') <> (new.load_row_id is not null)
    or (block.kind = 'regular') <> (new.pattern_entry_id is not null) then
    raise exception 'lesson_load_row'
      using errcode = 'check_violation', constraint = 'lesson_load_row';
  end if;
  if new.load_row_id is not null then
    select r.version_id, r.class_id, r.group_id into row_version, row_class, row_group
      from teaching_load_rows r where r.id = new.load_row_id;
    if row_version is distinct from block.version_id
      or row_class is distinct from new.class_id
      or row_group is distinct from new.group_id then
      raise exception 'lesson_load_row'
        using errcode = 'check_violation', constraint = 'lesson_load_row';
    end if;
  end if;
  if new.pattern_entry_id is not null then
    select e.block_id, e.load_row_id into entry_block, entry_row
      from pattern_entries e where e.id = new.pattern_entry_id;
    if entry_block is distinct from block.pattern_block_id
      or entry_row is distinct from new.load_row_id then
      raise exception 'lesson_pattern_entry'
        using errcode = 'check_violation', constraint = 'lesson_pattern_entry';
    end if;
  end if;
  return new;
end;
$$;

create trigger lessons_check
  before insert on lessons
  for each row execute function lessons_check();

-- ---------------------------------------------------------------------------
-- Time claims: one table the three clash rules run over (edge/developer-rules,
-- Exams). The exam kinds are written from 5.1b on.

create table time_claims (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  kind text not null constraint time_claims_kind_check check (
    kind in ('lesson', 'block_class', 'exam_room', 'exam_invigilator', 'exam_class')
  ),
  lesson_id uuid references lessons (id) on delete cascade,
  block_id uuid references lesson_blocks (id) on delete cascade,
  -- Its key comes with the exams of 5.1b.
  exam_id uuid,
  -- The unit that occupies a class: the lesson block, or the exam.
  holder uuid not null,
  -- Half-open: a lesson ending at 09:45 does not overlap one starting at 09:45.
  during tstzrange not null,
  teacher_id uuid references staff (id),
  room_id uuid,
  -- Copied from rooms.shared, so the constraint can read it.
  room_shared boolean not null default false,
  class_id uuid,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint time_claims_during_check check (
    not isempty(during) and not lower_inf(during) and not upper_inf(during)
    and lower_inc(during) and not upper_inc(during)
  ),
  constraint time_claims_lesson_check check (
    kind <> 'lesson' or (
      lesson_id is not null and block_id is not null and exam_id is null and class_id is null
      and holder = block_id
    )
  ),
  constraint time_claims_block_class_check check (
    kind <> 'block_class' or (
      lesson_id is null and block_id is not null and exam_id is null and class_id is not null
      and teacher_id is null and room_id is null and holder = block_id
    )
  ),
  constraint time_claims_exam_check check (
    kind not in ('exam_room', 'exam_invigilator', 'exam_class') or (
      exam_id is not null and lesson_id is null and block_id is null and holder = exam_id
      and (kind <> 'exam_room' or (room_id is not null and teacher_id is null and class_id is null))
      and (kind <> 'exam_invigilator' or (teacher_id is not null and room_id is null and class_id is null))
      and (kind <> 'exam_class' or (class_id is not null and teacher_id is null and room_id is null))
    )
  ),
  constraint time_claims_room_fkey foreign key (room_id, branch_id)
    references rooms (id, branch_id),
  constraint time_claims_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  -- Across all branches: no branch_id in them (06, Teachers who work in
  -- several branches, "One clash check"). Decision 6.
  constraint time_claims_teacher_excl exclude using gist (
    teacher_id with =,
    during with &&
  ) where (teacher_id is not null) deferrable initially immediate,
  constraint time_claims_room_excl exclude using gist (
    room_id with =,
    during with &&
  ) where (room_id is not null and not room_shared) deferrable initially immediate,
  constraint time_claims_class_excl exclude using gist (
    class_id with =,
    holder with <>,
    during with &&
  ) where (class_id is not null) deferrable initially immediate
);

create unique index time_claims_lesson_key on time_claims (lesson_id) where kind = 'lesson';
create unique index time_claims_block_class_key on time_claims (block_id, class_id)
  where kind = 'block_class';
create index time_claims_block_idx on time_claims (block_id) where block_id is not null;
create index time_claims_room_idx on time_claims using gist (room_id, during)
  where room_id is not null;

alter table time_claims enable row level security;
create policy branch_filter on time_claims for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The rights the triggers need; the guard refuses them to a direct statement.
-- Never TRUNCATE.
grant select, insert, update, delete on time_claims to sodiq_app;

create trigger time_claims_guard
  before insert or update or delete on time_claims
  for each row execute function timetable_trigger_only('time_claims_direct');

-- The students of a lesson on its date: the class's members, or the group's.
-- Runs as the invoker.
create function lesson_students(lesson_ref uuid) returns setof uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select m.student_id
    from lessons l
    join class_memberships m on m.class_id = l.class_id
    where l.id = lesson_ref
      and daterange(m.valid_from, m.valid_until) @> l.lesson_date
  union
  select m.student_id
    from lessons l
    join group_memberships m on m.group_id = l.group_id
    where l.id = lesson_ref
      and daterange(m.valid_from, m.valid_until) @> l.lesson_date
$$;

grant execute on function lesson_students(uuid) to sodiq_app;

-- The class claims of a block: one per class of its lessons that are not
-- cancelled (the class of a class lesson, the classes of a group lesson's
-- group), over the block's time (decision 4). Runs as the invoker.
create function lesson_block_claims(block_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block lesson_blocks%rowtype;
begin
  select * into block from lesson_blocks b where b.id = block_ref;
  if not found then
    return;
  end if;
  delete from time_claims c
    where c.kind = 'block_class' and c.block_id = block_ref
      and c.class_id not in (
        select l.class_id from lessons l
          where l.block_id = block_ref and l.cancel_cause is null and l.class_id is not null
        union
        select gc.class_id from lessons l
          join group_classes gc on gc.group_id = l.group_id
          where l.block_id = block_ref and l.cancel_cause is null
      );
  update time_claims c set during = tstzrange(block.starts_at, block.ends_at)
    where c.kind = 'block_class' and c.block_id = block_ref
      and c.during <> tstzrange(block.starts_at, block.ends_at);
  insert into time_claims (branch_id, kind, block_id, holder, during, class_id)
  select block.branch_id, 'block_class', block.id, block.id,
    tstzrange(block.starts_at, block.ends_at), w.class_id
  from (
    select l.class_id from lessons l
      where l.block_id = block_ref and l.cancel_cause is null and l.class_id is not null
    union
    select gc.class_id from lessons l
      join group_classes gc on gc.group_id = l.group_id
      where l.block_id = block_ref and l.cancel_cause is null
  ) w
  order by w.class_id
  on conflict (block_id, class_id) where kind = 'block_class' do nothing;
end;
$$;

-- A lesson's own claim (teacher and room) while it is not cancelled, and its
-- block's class claims, rewritten in the same transaction as the lesson.
-- Runs as the invoker.
create function lessons_claims() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  shared boolean;
begin
  if tg_op = 'DELETE' then
    perform lesson_block_claims(old.block_id);
    return null;
  end if;
  if new.cancel_cause is not null then
    delete from time_claims c where c.kind = 'lesson' and c.lesson_id = new.id;
  else
    shared := coalesce(
      (select r.shared from rooms r where r.id = new.room_id and r.branch_id = new.branch_id),
      false
    );
    if exists (select 1 from time_claims c where c.kind = 'lesson' and c.lesson_id = new.id) then
      update time_claims c set
          during = tstzrange(new.starts_at, new.ends_at),
          teacher_id = new.teacher_id,
          room_id = new.room_id,
          room_shared = shared
        where c.kind = 'lesson' and c.lesson_id = new.id
          and (c.during, c.teacher_id, c.room_id, c.room_shared)
            is distinct from (tstzrange(new.starts_at, new.ends_at), new.teacher_id, new.room_id, shared);
    else
      insert into time_claims (
        branch_id, kind, lesson_id, block_id, holder, during, teacher_id, room_id, room_shared
      ) values (
        new.branch_id, 'lesson', new.id, new.block_id, new.block_id,
        tstzrange(new.starts_at, new.ends_at), new.teacher_id, new.room_id, shared
      );
    end if;
  end if;
  perform lesson_block_claims(new.block_id);
  return null;
end;
$$;

create trigger lessons_claims
  after insert or update or delete on lessons
  for each row execute function lessons_claims();

-- A shared room holds at most its number of lessons at once, and the
-- students of those lessons together at most its capacity (decision 2). The
-- most at once is reached at a start: the claim's own, or that of a claim
-- starting inside it (correction 3). Re-reads the claim first: a later
-- statement of the transaction may have removed it. Runs as the invoker.
create function time_claims_shared_room() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  claim time_claims%rowtype;
  most integer;
  room_capacity integer;
  busiest integer;
  fullest integer;
begin
  select * into claim from time_claims c where c.id = new.id;
  if not found or claim.room_id is null or not claim.room_shared then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_room:' || claim.room_id::text, 0));
  select r.max_simultaneous_lessons, r.capacity into most, room_capacity
    from rooms r where r.id = claim.room_id;
  select max(at_once.lessons), max(at_once.students) into busiest, fullest
  from (
    select lower(claim.during) as moment
    union
    select lower(o.during) from time_claims o
      where o.room_id = claim.room_id
        and lower(o.during) > lower(claim.during)
        and lower(o.during) < upper(claim.during)
  ) moments
  cross join lateral (
    select
      count(*)::integer as lessons,
      (
        select count(distinct s.student)::integer
        from time_claims o2
        cross join lateral lesson_students(o2.lesson_id) as s(student)
        where o2.room_id = claim.room_id
          and o2.lesson_id is not null
          and o2.during @> moments.moment
      ) as students
    from time_claims o
    where o.room_id = claim.room_id and o.during @> moments.moment
  ) at_once;
  if most is not null and busiest > most then
    raise exception 'room_shared_full'
      using errcode = 'check_violation', constraint = 'room_shared_full';
  end if;
  if fullest > room_capacity then
    raise exception 'room_shared_capacity'
      using errcode = 'check_violation', constraint = 'room_shared_capacity';
  end if;
  return null;
end;
$$;

create constraint trigger time_claims_shared_room
  after insert or update on time_claims
  deferrable initially deferred
  for each row execute function time_claims_shared_room();

-- edge/developer-rules, Class in one block: "A constraint trigger checks that
-- each student of a block's classes is in at most one of its lessons, using
-- membership on the lesson date." A block moved to another date sets
-- lesson_date through the cascade, so the trigger runs then too. Two writers
-- of one block are checked one after the other: an advisory lock of the
-- block, then the count in a statement of its own. Runs as the invoker.
create function lessons_block_students() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lesson lessons%rowtype;
begin
  select * into lesson from lessons l where l.id = new.id;
  if not found then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_block:' || lesson.block_id::text, 0));
  if exists (
    select 1
    from lessons l
    cross join lateral lesson_students(l.id) as s(student)
    where l.block_id = lesson.block_id and l.cancel_cause is null
    group by s.student
    having count(*) > 1
  ) then
    raise exception 'lesson_block_student_twice'
      using errcode = 'check_violation', constraint = 'lesson_block_student_twice';
  end if;
  return null;
end;
$$;

create constraint trigger lessons_block_students
  after insert or update of class_id, group_id, cancel_cause, lesson_date on lessons
  deferrable initially deferred
  for each row execute function lessons_block_students();
