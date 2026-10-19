-- 0085 The record of a one-day room change and move (task 5.6a-2, pull
-- request #161).
--
-- docs/spec/06-timetable.md, Changes after publishing: "One-day change. …
-- change the room, move to another slot or day … Every one-day change needs a
-- reason, applies to that date only and passes the same rules."
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "One-day changes,
-- absences, room closures and exams are stored on their own and applied again
-- after a publish." The plan approved on pull request #161: decision 8.
--
-- The change itself is written on the lesson (its room, 0058) or on its
-- block (its date and times, 0058, cascading to the lessons and their
-- claims), so the exclusion constraints and the commit checks of 0058 guard
-- it. This table keeps what the lesson was and what it became, so that 5.6a-5
-- can apply it again after a publish, also once the publish removed the
-- lesson (`lesson_id` set to null).
--
-- The rows are data in force, not a history table: a second change of one
-- lesson is a new row, and the one in force is the newest by `changed_at`,
-- then `id` (spec review should-fix 6). Insert only.

create table lesson_day_changes (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- Null once a publish removed the lesson.
  lesson_id uuid,
  kind text not null constraint lesson_day_changes_kind_check check (kind in ('room', 'move')),
  -- What the lesson was, so it can be found again after a publish.
  class_id uuid,
  group_id uuid,
  subject_id uuid not null references subjects (id),
  load_row_id uuid,
  from_date date not null,
  from_starts_at timestamptz not null,
  from_ends_at timestamptz not null,
  from_room_id uuid,
  to_date date not null,
  to_starts_at timestamptz not null,
  to_ends_at timestamptz not null,
  to_room_id uuid,
  reason text not null constraint lesson_day_changes_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  -- The moment of the change, from the transaction's moment (the injected clock).
  changed_at timestamptz not null,
  changed_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_day_changes_unit_check check ((class_id is null) <> (group_id is null)),
  constraint lesson_day_changes_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete set null (lesson_id),
  constraint lesson_day_changes_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id),
  constraint lesson_day_changes_group_fkey foreign key (group_id, branch_id)
    references groups (id, branch_id),
  constraint lesson_day_changes_from_room_fkey foreign key (from_room_id, branch_id)
    references rooms (id, branch_id),
  constraint lesson_day_changes_to_room_fkey foreign key (to_room_id, branch_id)
    references rooms (id, branch_id)
);

create index lesson_day_changes_lesson_idx on lesson_day_changes (lesson_id)
  where lesson_id is not null;
create index lesson_day_changes_from_idx on lesson_day_changes (branch_id, from_date);
create index lesson_day_changes_to_idx on lesson_day_changes (branch_id, to_date);

alter table lesson_day_changes enable row level security;
create policy branch_filter on lesson_day_changes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_day_changes to sodiq_app;
grant insert (
  branch_id, lesson_id, kind, class_id, group_id, subject_id, load_row_id, from_date,
  from_starts_at, from_ends_at, from_room_id, to_date, to_starts_at, to_ends_at, to_room_id,
  reason, changed_at, changed_by
) on lesson_day_changes to sodiq_app;
