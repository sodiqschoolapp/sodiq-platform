-- 0018 Academic calendar (task 1.4).
--
-- docs/spec/03-school-setup.md, Academic calendar: "Days off (holidays,
-- vacations) and special days: shortened day, exam week, open-doors day, a
-- working Saturday. Each date resolves to 'no lessons' or to one day
-- template." Owner: the Academic Vice Principal.
-- docs/spec/edge-cases/time-dates-calendar.md: "Every calendar entry applies
-- to the whole branch or to a range of grades"; "A special working date has a
-- day template and a 'follows weekday' setting"; an exam week says "either
-- 'regular lessons on this template' or 'no regular lessons'".
--
-- The owner's answers 15 to 18 (docs/decisions.md, "Decided ahead for tasks
-- 1.3 to 1.6") and the plan approved on pull request #47. Answer 17: "Same
-- date and overlapping grades: a day off beats a special day; two entries of
-- the same kind are refused (database constraint)."
--
-- "Only dates from tomorrow on can be created or changed" (answer 16), the
-- years, the working weekdays and the go-live date are checked by the API
-- from the injected clock (CLAUDE.md, Time is injected), under the branch row
-- taken for update. Here the database keeps the shape of an entry, the keys of
-- one branch, no two active entries of one kind on a date for overlapping
-- grades, and nothing deleted.

create table calendar_entries (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- Fixed at creation (decision 4): not granted for update. Its values are
  -- kept by calendar_entries_kind_check.
  kind text not null,
  -- CALENDAR_ENTRY_NAME_MAX_LENGTH of packages/shared. One typed name, not
  -- unique: "Navruz" comes back every year (decision 10).
  name text not null constraint calendar_entries_name_check check (
    length(btrim(name)) between 1 and 60
  ),
  -- School dates; both count (decision 1).
  first_date date not null,
  last_date date not null,
  -- Both empty for the whole branch, or a range of grades 1 to 11 upwards.
  grade_from smallint,
  grade_to smallint,
  day_template_id uuid,
  -- ISO weekday, Monday 1 to Sunday 7, followed on the dates that are not
  -- working weekdays (answer 15).
  follows_weekday smallint,
  exam_week text,
  -- From the injected clock; empty while active.
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint calendar_entries_dates_check check (last_date >= first_date),
  constraint calendar_entries_grades_check check (
    (grade_from is null and grade_to is null)
    or (grade_from is not null and grade_to is not null
      and grade_from between 1 and 11 and grade_to between 1 and 11 and grade_from <= grade_to)
  ),
  -- A special day names a template, and may name a weekday and an exam week;
  -- a day off names none of the three.
  constraint calendar_entries_kind_check check (
    (kind = 'special_day' and day_template_id is not null
      and (follows_weekday is null or follows_weekday between 1 and 7)
      and (exam_week is null or exam_week in ('regular_lessons', 'no_regular_lessons')))
    or (kind = 'day_off' and day_template_id is null
      and follows_weekday is null and exam_week is null)
  ),
  constraint calendar_entries_template_fkey foreign key (day_template_id, branch_id)
    references day_templates (id, branch_id),
  -- Answer 17 and decision 2: two active entries of one kind never share a
  -- date for overlapping grades; a whole-branch entry holds grades 1 to 11.
  constraint calendar_entries_no_overlap exclude using gist (
    branch_id with =,
    kind with =,
    int4range(coalesce(grade_from, 1), coalesce(grade_to, 11), '[]') with &&,
    daterange(first_date, last_date, '[]') with &&
  ) where (archived_at is null)
);

create index calendar_entries_template_idx on calendar_entries (day_template_id);

alter table calendar_entries enable row level security;
create policy branch_filter on calendar_entries for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on calendar_entries to sodiq_app;
grant insert (
  branch_id, kind, name, first_date, last_date, grade_from, grade_to,
  day_template_id, follows_weekday, exam_week
) on calendar_entries to sodiq_app;
grant update (
  name, first_date, last_date, grade_from, grade_to, day_template_id,
  follows_weekday, exam_week, archived_at
) on calendar_entries to sodiq_app;
