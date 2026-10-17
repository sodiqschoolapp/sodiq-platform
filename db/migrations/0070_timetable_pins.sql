-- 0070 Pinned lessons of step 5 of the draft builder (task 5.3b-2, pull
-- request #129).
--
-- docs/spec/06-timetable.md, Building a timetable, step 5: "pins lessons that
-- must stay at a fixed time (for example the Homework slot at the end of the
-- day)". docs/spec/edge-cases/timetable.md, Generator and editing: "Before
-- generating, the locked and pinned lessons are checked on their own."
--
-- Decision 2: a pin is a load row, a weekday and a slot position, with no
-- room and no time of its own; its time is read from the template in force on
-- each check, so a template change is seen with no write. The rule engine
-- checks the pins (packages/timetable-rules, pins.ts); a clash is listed by
-- readiness, not refused here (decision 3).

-- Review decision 11: one step, the table holds only load rows.
alter table teaching_load_rows
  add constraint teaching_load_rows_version_key unique (id, version_id, branch_id);

create table timetable_pins (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  load_row_id uuid not null,
  -- ISO weekday, 1 Monday to 7 Sunday.
  weekday smallint not null constraint timetable_pins_weekday_check check (weekday between 1 and 7),
  -- The position of the slot in the day template, breaks included, as
  -- pattern_blocks.slot_position (0058).
  slot_position smallint not null constraint timetable_pins_slot_check check (
    slot_position between 1 and 20
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  -- The row's own key to its version covers the version (0055).
  constraint timetable_pins_load_row_fkey foreign key (load_row_id, version_id, branch_id)
    references teaching_load_rows (id, version_id, branch_id) on delete cascade,
  constraint timetable_pins_slot_key unique (branch_id, load_row_id, weekday, slot_position)
);

create index timetable_pins_version_idx on timetable_pins (version_id);

alter table timetable_pins enable row level security;
create policy branch_filter on timetable_pins for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A pin is moved by a delete and an add; no update.
grant select, delete on timetable_pins to sodiq_app;
grant insert (branch_id, version_id, load_row_id, weekday, slot_position)
  on timetable_pins to sodiq_app;

-- As the pattern (0058): pins change only in a draft of a year that is not
-- closed, checked at the commit.
create constraint trigger timetable_pins_draft
  after insert or delete on timetable_pins
  deferrable initially deferred
  for each row execute function pattern_rows_draft();
