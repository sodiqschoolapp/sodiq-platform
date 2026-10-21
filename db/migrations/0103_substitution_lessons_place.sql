-- 0103 Substitutions kept after a publish (task 5.7b-3, pull request #193).
--
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "A substitution and
-- a one-day move are already recorded for a date after the new version
-- starts. One-day changes, absences, room closures and exams are stored on
-- their own and applied again after a publish. The preview sorts them into
-- kept, needs a decision and dropped."
--
-- The plan approved on pull request #193 (spec review must-fix 3): a row
-- records what its lesson was when the row was written (the From line of
-- 5.7b-1: class or group, subject, load row, pattern entry and the date of
-- its pattern block), so a dropped or removed lesson can still be named. The
-- columns are written once and never updated; the sorting matches lessons in
-- memory, never by them. No foreign keys: they record a past fact, as
-- `lesson_date` does (should-fix 7). `recorded_again`: the row ended because
-- the write created its lesson again and a new row of the same record names
-- the new lesson (decision 6).

alter table substitution_lessons
  add column class_id uuid,
  add column group_id uuid,
  add column subject_id uuid,
  add column load_row_id uuid,
  add column pattern_entry_id uuid,
  add column pattern_date date,
  add column starts_at timestamptz,
  add column ends_at timestamptz;

-- Every row with a lesson: its lesson now; the date of its pattern block is
-- its date, or the date the oldest move in force took it from.
update substitution_lessons r
  set class_id = l.class_id,
    group_id = l.group_id,
    subject_id = l.subject_id,
    load_row_id = l.load_row_id,
    pattern_entry_id = l.pattern_entry_id,
    pattern_date = coalesce(
      (
        select c.from_date
        from lesson_day_changes c
        where c.lesson_id = l.id
          and c.kind = 'move'
          and not exists (select 1 from lesson_day_change_ends e where e.change_id = c.id)
        order by c.changed_at, c.id
        limit 1
      ),
      l.lesson_date
    ),
    starts_at = l.starts_at,
    ends_at = l.ends_at
  from lessons l
  where l.id = r.lesson_id;

-- A live row always knows its lesson.
alter table substitution_lessons add constraint substitution_lessons_place_check check (
  ended_at is not null
  or (
    subject_id is not null
    and load_row_id is not null
    and pattern_entry_id is not null
    and pattern_date is not null
    and starts_at is not null
    and ends_at is not null
    and (class_id is null) <> (group_id is null)
  )
);

alter table substitution_lessons drop constraint substitution_lessons_end_cause_check;
alter table substitution_lessons add constraint substitution_lessons_end_cause_check check (
  end_cause in ('withdrawn', 'replaced', 'corrected', 'dropped', 'returned', 'recorded_again')
);

grant insert (
  class_id, group_id, subject_id, load_row_id, pattern_entry_id, pattern_date, starts_at, ends_at
) on substitution_lessons to sodiq_app;
