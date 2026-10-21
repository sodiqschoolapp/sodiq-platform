-- 0101 The substitution record (task 5.7b-1, pull request #191).
--
-- docs/spec/06-timetable.md, Changes after publishing: "Substitution. The one
-- way to put another teacher on a lesson. ... Either way one substitution
-- record is kept: who was replaced, by whom, for which lessons and why. The
-- substitute can enter and edit that lesson's column for the normal edit
-- period." docs/spec/edge-cases/timetable.md, After publishing: "The
-- substitute is the teacher of that lesson".
--
-- The plan approved on pull request #191: decisions 5 (the record keeps the
-- teacher first replaced; `relaxed` keeps the exception "no teacher of the
-- subject is free" for a later one-day change) and 6 (the substitute is
-- written into `lessons.teacher_id`, so `time_claims_teacher_excl` of 0058
-- guards them; a row is in force while it has no end and its lesson's
-- teacher is its substitute, and every writer that takes the substitute off
-- or removes the lesson ends the row in the same transaction, review
-- correction 1).

-- The record, insert only.
create table substitutions (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- `lesson`: from one lesson; `correction`: a past lesson's teacher recorded
  -- (5.6a-4). 5.7b-2 adds the absence and the journal.
  source text not null constraint substitutions_source_check check (
    source in ('lesson', 'correction')
  ),
  -- The teacher or vacancy replaced; null when the lesson had nobody recorded.
  replaced_id uuid references staff (id),
  substitute_id uuid not null references staff (id),
  -- Saved under the exception "no teacher of the subject is free".
  relaxed boolean not null,
  reason text not null constraint substitutions_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  -- The moment of the save, from the transaction's moment (the injected clock).
  made_at timestamptz not null,
  made_by uuid not null references accounts (id),
  constraint substitutions_id_branch_key unique (id, branch_id),
  constraint substitutions_people_check check (substitute_id <> replaced_id)
);

alter table substitutions enable row level security;
create policy branch_filter on substitutions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (
  branch_id, source, replaced_id, substitute_id, relaxed, reason, made_at, made_by
) on substitutions to sodiq_app;

-- One row per lesson of a record. What the lesson was is added by 5.7b-3,
-- which reads it.
create table substitution_lessons (
  id uuid primary key default uuidv7(),
  substitution_id uuid not null,
  branch_id uuid not null references branches (id),
  -- Null once the lesson was removed; its row was ended before (`dropped`).
  lesson_id uuid,
  -- For the substitutions taken in a month (5.7c, Fair load).
  lesson_date date not null,
  ended_at timestamptz,
  end_cause text constraint substitution_lessons_end_cause_check check (
    end_cause in ('withdrawn', 'replaced', 'corrected', 'dropped')
  ),
  ended_by uuid references accounts (id),
  constraint substitution_lessons_substitution_fkey foreign key (substitution_id, branch_id)
    references substitutions (id, branch_id),
  constraint substitution_lessons_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete set null (lesson_id),
  constraint substitution_lessons_end_check check (
    (ended_at is null) = (end_cause is null) and (ended_at is null) = (ended_by is null)
  )
);

-- One live row per lesson.
create unique index substitution_lessons_live on substitution_lessons (lesson_id)
  where ended_at is null and lesson_id is not null;
create index substitution_lessons_substitution_idx on substitution_lessons (substitution_id);
create index substitution_lessons_date_idx on substitution_lessons (branch_id, lesson_date);

alter table substitution_lessons enable row level security;
create policy branch_filter on substitution_lessons for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (substitution_id, branch_id, lesson_id, lesson_date)
  on substitution_lessons to sodiq_app;
grant update (ended_at, end_cause, ended_by) on substitution_lessons to sodiq_app;
