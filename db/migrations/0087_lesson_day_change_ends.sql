-- 0087 The end of a stored one-day change that a publish did not apply
-- again (task 5.6a-5a, pull request #164).
--
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "A substitution and
-- a one-day move are already recorded for a date after the new version
-- starts. One-day changes, absences, room closures and exams are stored on
-- their own and applied again after a publish. The preview sorts them into
-- kept, needs a decision and dropped. Publish waits until every 'needs a
-- decision' item is settled." The plan approved on pull request #164:
-- decisions 2 and 4.
--
-- A room change or move (0085) is in force while none of its rows has an end
-- here. A publish that drops it, or settles it with "drop the change" or
-- "cancel the lesson that day", writes an end for every row of the lesson's
-- chain, so that a later publish does not sort it again: 0085 is insert only,
-- and a dropped room change leaves its lesson in place. Insert only.

alter table lesson_day_changes
  add constraint lesson_day_changes_id_branch_key unique (id, branch_id);

create table lesson_day_change_ends (
  change_id uuid primary key,
  branch_id uuid not null references branches (id),
  -- The version whose publish ended it.
  version_id uuid not null,
  -- The moment of the publish, from the transaction's moment (the injected clock).
  ended_at timestamptz not null,
  ended_by uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_day_change_ends_change_fkey foreign key (change_id, branch_id)
    references lesson_day_changes (id, branch_id),
  constraint lesson_day_change_ends_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id)
);

create index lesson_day_change_ends_version_idx on lesson_day_change_ends (version_id);

alter table lesson_day_change_ends enable row level security;
create policy branch_filter on lesson_day_change_ends for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_day_change_ends to sodiq_app;
grant insert (change_id, branch_id, version_id, ended_at, ended_by)
  on lesson_day_change_ends to sodiq_app;
