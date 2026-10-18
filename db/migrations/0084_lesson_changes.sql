-- 0084 The "changed" mark of a dated lesson (task 5.5c-3a, pull request
-- #158).
--
-- docs/spec/06-timetable.md, How surprises are prevented, Everyone is told:
-- "Changed lessons carry a 'changed' mark on every timetable view for a
-- week." The plan approved on pull request #158: decisions 3, 4 and 8.
--
-- A publish (its replace and carries) and a withdraw mark every lesson that
-- has no equal among the lessons stored before them (decision 3). The mark is
-- the moment of the change, from the transaction's moment; a reader compares
-- it with the clock on each request (`isMarkedChanged` of packages/shared,
-- seven days), so no job ever clears it (CLAUDE.md, state from stored
-- moments).
--
-- A table of its own, not a column of `lessons` (decision 8): `lessons_claims`
-- (0058) runs after every update of `lessons`, so a mark written there would
-- rewrite the time claims of every lesson marked. The mark goes with its
-- lesson: the key names the lesson in its own branch (`lessons_id_branch_key`
-- of 0058), and a lesson removed takes its mark with it.

create table lesson_changes (
  lesson_id uuid primary key,
  branch_id uuid not null references branches (id),
  -- The moment of the publish or withdraw that last changed the lesson.
  changed_at timestamptz not null,
  constraint lesson_changes_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade
);

alter table lesson_changes enable row level security;
create policy branch_filter on lesson_changes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- A mark is written and moved to a later moment; it is removed only with its
-- lesson, by the cascade.
grant select, insert (lesson_id, branch_id, changed_at) on lesson_changes to sodiq_app;
grant update (changed_at) on lesson_changes to sodiq_app;
