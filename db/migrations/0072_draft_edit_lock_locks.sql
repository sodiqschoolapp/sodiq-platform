-- 0072 The edit lock of a draft and the locks of the grid (task 5.4c-1, pull
-- request #135).
--
-- docs/spec/06-timetable.md, Editing in the grid: "Several people can view a
-- draft; one edits at a time." docs/spec/edge-cases/timetable.md, Generator
-- and editing: "The edit lock is released after 5 minutes without activity.
-- Another Academic Vice Principal can take over; the earlier holder is told."
--
-- Decision 2: the edit lock is held by an account and covers every write of
-- the draft. It is a stored moment (CLAUDE.md, State from stored moments):
-- `edit_seen_at` is written from the transaction's moment and compared with
-- it on each write; no job releases it.
alter table timetable_versions
  add column edit_holder_id uuid references accounts (id),
  add column edit_seen_at timestamptz,
  add constraint timetable_versions_edit_lock_check check (
    (edit_holder_id is null) = (edit_seen_at is null)
  );

grant update (edit_holder_id, edit_seen_at) on timetable_versions to sodiq_app;

-- docs/spec/06-timetable.md, Auto-generation: "A lesson, a class, a teacher or
-- a day can be locked. 'Regenerate' changes only what is not locked." A lock
-- of a lesson names its block (blocks are placed and moved whole,
-- edge/timetable, Structure); a teacher lock names a teacher or a vacancy.
create table timetable_locks (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  kind text not null constraint timetable_locks_kind_check check (
    kind in ('block', 'class', 'teacher', 'day')
  ),
  block_id uuid,
  class_id uuid,
  teacher_id uuid references staff (id),
  -- ISO weekday, 1 Monday to 7 Sunday.
  weekday smallint constraint timetable_locks_weekday_check check (weekday between 1 and 7),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint timetable_locks_target_check check (
    (block_id is not null) = (kind = 'block')
    and (class_id is not null) = (kind = 'class')
    and (teacher_id is not null) = (kind = 'teacher')
    and (weekday is not null) = (kind = 'day')
  ),
  constraint timetable_locks_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id),
  -- Decision 7: a lock of a lesson goes with its block.
  constraint timetable_locks_block_fkey foreign key (block_id, version_id, branch_id)
    references pattern_blocks (id, version_id, branch_id) on delete cascade,
  constraint timetable_locks_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id)
);

-- One lock per target in a version.
create unique index timetable_locks_block_key on timetable_locks (branch_id, version_id, block_id)
  where kind = 'block';
create unique index timetable_locks_class_key on timetable_locks (branch_id, version_id, class_id)
  where kind = 'class';
create unique index timetable_locks_teacher_key on timetable_locks (branch_id, version_id, teacher_id)
  where kind = 'teacher';
create unique index timetable_locks_day_key on timetable_locks (branch_id, version_id, weekday)
  where kind = 'day';
create index timetable_locks_version_idx on timetable_locks (version_id);

alter table timetable_locks enable row level security;
create policy branch_filter on timetable_locks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A lock is added and removed; no update.
grant select, delete on timetable_locks to sodiq_app;
grant insert (branch_id, version_id, kind, block_id, class_id, teacher_id, weekday)
  on timetable_locks to sodiq_app;

-- As the pattern and the pins (0058, 0070): locks change only in a draft of a
-- year that is not closed, checked at the commit.
create constraint trigger timetable_locks_draft
  after insert or delete on timetable_locks
  deferrable initially deferred
  for each row execute function pattern_rows_draft();
