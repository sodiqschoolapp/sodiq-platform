-- 0098 Room closures (task 5.7a-2b, pull request #187, decisions 1, 3 and 4).
--
-- docs/spec/edge-cases/timetable.md, After publishing: "A laboratory is under
-- repair for three weeks. A room closure has a start, an end and a reason.
-- Lessons in the range go to 'needs a room', with 'move all to room R for the
-- period'. The pattern is unchanged and the lessons return afterwards."
-- docs/spec/06-timetable.md, How surprises are prevented: "No lesson without
-- a teacher or room."
--
-- A closure writes no lesson (decision 1): a lesson keeps its room, and
-- "needs a room" is read from the stored moments on every request. The days
-- typed are kept for the screen; the rule compares `applies_from` and
-- `applies_until`, written from the injected clock as for an absence (0096,
-- decision 4): a closure entered today starts at the save moment, and one
-- ended "yesterday" ends at the save moment.

-- A room and every lesson in it belong to one branch (`lessons_room_fkey`,
-- 0058), so the branch filter is enough (decision 11).
create table room_closures (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  room_id uuid not null,
  starts_on date not null,
  -- Required (decision 3): "A room closure has a start, an end and a reason".
  ends_on date not null,
  applies_from timestamptz not null,
  applies_until timestamptz not null,
  reason text not null constraint room_closures_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  withdrawn_at timestamptz,
  created_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint room_closures_room_fkey foreign key (room_id, branch_id)
    references rooms (id, branch_id),
  constraint room_closures_days_check check (ends_on >= starts_on),
  constraint room_closures_moments_check check (applies_until > applies_from),
  -- Two live closures of one room never overlap.
  constraint room_closures_no_overlap exclude using gist (
    room_id with =,
    tstzrange(applies_from, applies_until) with &&
  ) where (withdrawn_at is null)
);

create index room_closures_branch_idx on room_closures (branch_id, room_id);

alter table room_closures enable row level security;
create policy branch_filter on room_closures for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (
  branch_id, room_id, starts_on, ends_on, applies_from, applies_until, reason, created_by
) on room_closures to sodiq_app;
grant update (starts_on, ends_on, applies_from, applies_until, withdrawn_at) on room_closures
  to sodiq_app;
