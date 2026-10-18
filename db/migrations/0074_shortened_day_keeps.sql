-- 0074 The lessons kept on a shortened day (task 5.5a-2b-2, pull request #143).
--
-- docs/spec/edge-cases/time-dates-calendar.md, "A shortened day has 5 lesson
-- slots and a class has 7 lessons that weekday": "Lessons are matched by their
-- order in the day. Those beyond the day's slots are created as cancelled with
-- the reason 'not in the day's template' and listed per class in the preview.
-- The Academic Vice Principal can choose which lessons are kept."
--
-- The plan approved on pull request #143: decision 2. A choice is stored per
-- version, date and class, one row per lesson kept, named by its slot
-- position in the template of the weekday the date follows, as a pin names a
-- slot (0070). The rule engine applies it (packages/timetable-rules,
-- dated.ts). No constraint, index or trigger is removed or weakened.

create table timetable_day_keeps (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  class_id uuid not null,
  -- The school date of the shortened day.
  kept_on date not null,
  -- The position of the kept lesson's slot in the day template, breaks
  -- included, as pattern_blocks.slot_position (0058).
  slot_position smallint not null constraint timetable_day_keeps_slot_check check (
    slot_position between 1 and 20
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  -- Spec review of the plan: a version removed takes its choices, as pins go
  -- with their load rows.
  constraint timetable_day_keeps_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id) on delete cascade,
  constraint timetable_day_keeps_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint timetable_day_keeps_slot_key unique (version_id, class_id, kept_on, slot_position)
);

create index timetable_day_keeps_class_idx on timetable_day_keeps (class_id);

alter table timetable_day_keeps enable row level security;
create policy branch_filter on timetable_day_keeps for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A choice is replaced by a delete and inserts; no update.
grant select, delete on timetable_day_keeps to sodiq_app;
grant insert (branch_id, version_id, class_id, kept_on, slot_position)
  on timetable_day_keeps to sodiq_app;

-- As the pattern (0058) and the pins (0070): choices change only in a draft
-- of a year that is not closed, checked at the commit.
create constraint trigger timetable_day_keeps_draft
  after insert or delete on timetable_day_keeps
  deferrable initially deferred
  for each row execute function pattern_rows_draft();
