-- 0020 Subjects and their grading weights (task 2.1).
--
-- docs/spec/05-classes-groups-subjects.md, Subject: "Name in three languages,
-- colour, department, grades, rating exam switch, group subject switch,
-- active switch, journal type (graded or attendance only), daily
-- distribution, quarterly distribution, language rule switch (on by
-- default)." "Inactive subjects do not appear in pickers. Subjects with data
-- are archived, not deleted." Grading weights on a subject: "Each
-- distribution must total 100. The form will not save otherwise." "The
-- quarterly distribution is set for each quarter separately." "A subject
-- without a rating exam has no rating part." docs/spec/edge-cases/timetable.md:
-- "a subject's 'demanding' switch". docs/spec/03-school-setup.md, Department:
-- "Inside Academic ... A department groups subjects and teachers."
--
-- The owner's answers 3 to 8 (docs/decisions.md, "Decided ahead for tasks 2.1
-- to 2.6") and the plan approved on pull request #52: one subject list for
-- the whole school, the weights per branch (answer 3); the journal type chosen
-- at creation, no built-in subjects (answer 5); 12 fixed colours (answer 7);
-- grades 1 to 11 (answer 8); every present part of a distribution weighs at
-- least 1 (decision 8: a part of 0 could leave the scaling of `07` rules 3 and
-- 8 with nothing to scale); subjects only in departments of Academic
-- (decision 6); quarterly distributions of a closed year are frozen
-- (decision 12).

-- Subjects. A school-wide table (answer 3): no branch, no policy; named in
-- SCHOOL_WIDE_TABLES of apps/api/src/database/catalog.test.ts.

-- The grades of a subject (answer 8): one dimension, at least one, no null,
-- each 1 to 11, strictly ascending, so each grade once and two lists of the
-- same grades are equal. The same rule as subjectRecordSchema of
-- packages/shared. Immutable: it reads nothing but its argument.
create function subject_grades_valid(grades smallint[]) returns boolean
language sql
immutable
as $$
  select array_ndims(grades) = 1
    and cardinality(grades) >= 1
    and array_position(grades, null) is null
    and grades[1] >= 1
    and grades[cardinality(grades)] <= 11
    and not exists (
      select 1 from generate_subscripts(grades, 1) as i
      where i > 1 and grades[i] <= grades[i - 1]
    )
$$;

create table subjects (
  id uuid primary key default uuidv7(),
  name_uz text not null constraint subjects_name_uz_check check (
    length(btrim(name_uz)) between 1 and 100
  ),
  name_ru text not null constraint subjects_name_ru_check check (
    length(btrim(name_ru)) between 1 and 100
  ),
  name_en text not null constraint subjects_name_en_check check (
    length(btrim(name_en)) between 1 and 100
  ),
  department_id uuid not null references departments (id),
  -- "is true" is said: a check that comes out null would pass.
  grades smallint[] not null constraint subjects_grades_check check (
    subject_grades_valid(grades) is true
  ),
  -- The 12 colours of SUBJECT_COLOURS in packages/shared (answer 7).
  colour text not null constraint subjects_colour_check check (
    colour in (
      'red', 'orange', 'amber', 'lime', 'green', 'teal',
      'cyan', 'blue', 'indigo', 'violet', 'pink', 'brown'
    )
  ),
  journal_type text not null constraint subjects_journal_type_check check (
    journal_type in ('graded', 'attendance_only')
  ),
  rating_exam boolean not null default false,
  group_subject boolean not null default false,
  language_rule boolean not null default true,
  demanding boolean not null default false,
  -- From the injected clock; empty while active. Archived, never deleted.
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  -- `edge/calculation`: attendance-only subjects have no weights and no
  -- result, so no rating exam.
  constraint subjects_rating_needs_graded_check check (
    not rating_exam or journal_type = 'graded'
  )
);

-- Two active subjects of one name in any language would be indistinguishable
-- in that language's pickers (decision 11).
create unique index subjects_active_name_uz_idx
  on subjects (lower(btrim(name_uz))) where archived_at is null;
create unique index subjects_active_name_ru_idx
  on subjects (lower(btrim(name_ru))) where archived_at is null;
create unique index subjects_active_name_en_idx
  on subjects (lower(btrim(name_en))) where archived_at is null;
create index subjects_department_idx on subjects (department_id);

-- An active subject is in an active department of the built-in Academic
-- division (`03`; decisions 6 and 9), for every user, the migrator included.
-- Only a row that ends up active is checked: archiving a subject is never
-- refused because of its department. The department is read FOR SHARE, so an
-- archive of the department that runs at the same moment waits for this
-- transaction and then sees the subject. Not SECURITY DEFINER.
create function subjects_department_guard() returns trigger
language plpgsql
as $$
declare
  department record;
begin
  if new.archived_at is not null then
    return new;
  end if;
  select departments.archived_at, divisions.built_in
    into department
    from departments
    join divisions on divisions.id = departments.division_id
    where departments.id = new.department_id
    for share of departments;
  if not found or not department.built_in then
    raise exception 'subjects_department_academic'
      using errcode = 'check_violation', constraint = 'subjects_department_academic';
  end if;
  if department.archived_at is not null then
    raise exception 'subjects_department_archived'
      using errcode = 'check_violation', constraint = 'subjects_department_archived';
  end if;
  return new;
end
$$;

create trigger subjects_department_guard
  before insert or update of department_id, archived_at on subjects
  for each row execute function subjects_department_guard();

-- The application creates, edits, archives and restores; nothing removes a
-- subject, and the application never writes id or created_at.
grant select on subjects to sodiq_app;
grant insert (
  name_uz, name_ru, name_en, department_id, grades, colour, journal_type,
  rating_exam, group_subject, language_rule, demanding
) on subjects to sodiq_app;
grant update (
  name_uz, name_ru, name_en, department_id, grades, colour, journal_type,
  rating_exam, group_subject, language_rule, demanding, archived_at
) on subjects to sodiq_app;

-- The daily distribution of a subject in a branch (answer 3): attendance,
-- classwork, homework. A branch table: branch_id and the one policy of 0002.
create table subject_daily_weights (
  branch_id uuid not null references branches (id),
  subject_id uuid not null references subjects (id),
  attendance smallint not null constraint subject_daily_weights_attendance_check check (
    attendance between 1 and 100
  ),
  classwork smallint not null constraint subject_daily_weights_classwork_check check (
    classwork between 1 and 100
  ),
  homework smallint not null constraint subject_daily_weights_homework_check check (
    homework between 1 and 100
  ),
  -- `05`: "Each distribution must total 100." The build plan's "done when".
  constraint subject_daily_weights_total_check check (
    attendance + classwork + homework = 100
  ),
  primary key (branch_id, subject_id)
);

alter table subject_daily_weights enable row level security;
create policy branch_filter on subject_daily_weights for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create index subject_daily_weights_subject_idx on subject_daily_weights (subject_id);

-- Set and changed, never removed; a subject that becomes attendance only keeps
-- its rows, which nothing reads while it is (decision 14).
grant select on subject_daily_weights to sodiq_app;
grant insert (branch_id, subject_id, attendance, classwork, homework)
  on subject_daily_weights to sodiq_app;
grant update (attendance, classwork, homework) on subject_daily_weights to sodiq_app;

-- So that a quarterly distribution can reference the quarter together with
-- its branch. A small table; the key adds an index only.
alter table quarters add constraint quarters_id_branch_key unique (id, branch_id);

-- The quarterly distribution of a subject in a quarter of a branch (`05`:
-- "set for each quarter separately"): attendance, classwork, homework and,
-- for a subject with a rating exam, the rating exam. Whether its shape fits
-- the subject's rating switch is read by the application (decision 3): the
-- switch is school-wide and the rows are per branch.
create table subject_quarter_weights (
  branch_id uuid not null references branches (id),
  subject_id uuid not null references subjects (id),
  quarter_id uuid not null,
  attendance smallint not null constraint subject_quarter_weights_attendance_check check (
    attendance between 1 and 100
  ),
  classwork smallint not null constraint subject_quarter_weights_classwork_check check (
    classwork between 1 and 100
  ),
  homework smallint not null constraint subject_quarter_weights_homework_check check (
    homework between 1 and 100
  ),
  -- Empty for a subject without a rating exam ("no rating part").
  rating_exam smallint constraint subject_quarter_weights_rating_exam_check check (
    rating_exam between 1 and 100
  ),
  constraint subject_quarter_weights_total_check check (
    attendance + classwork + homework + coalesce(rating_exam, 0) = 100
  ),
  -- A quarter of the row's own branch, whatever the application does.
  constraint subject_quarter_weights_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  primary key (branch_id, subject_id, quarter_id)
);

alter table subject_quarter_weights enable row level security;
create policy branch_filter on subject_quarter_weights for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create index subject_quarter_weights_subject_idx on subject_quarter_weights (subject_id);
create index subject_quarter_weights_quarter_idx on subject_quarter_weights (quarter_id);

-- No distribution of a quarter of a closed year changes (decision 12): the
-- year is frozen with its quarters. The year row is read FOR SHARE, so a
-- close of the year that runs at the same moment waits for this write. The
-- closed-quarter refusal comes with task 9.2b. Not SECURITY DEFINER: the
-- branch filter applies to what it reads.
create function subject_quarter_weights_closed_year_guard() returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from quarters
    join academic_years on academic_years.id = quarters.academic_year_id
    where quarters.id = new.quarter_id and academic_years.status = 'closed'
    for share of academic_years
  ) then
    raise exception 'academic_years_closed'
      using errcode = 'check_violation', constraint = 'academic_years_closed';
  end if;
  return new;
end
$$;

create trigger subject_quarter_weights_closed_year_guard
  before insert or update on subject_quarter_weights
  for each row execute function subject_quarter_weights_closed_year_guard();

grant select on subject_quarter_weights to sodiq_app;
grant insert (branch_id, subject_id, quarter_id, attendance, classwork, homework, rating_exam)
  on subject_quarter_weights to sodiq_app;
grant update (attendance, classwork, homework, rating_exam)
  on subject_quarter_weights to sodiq_app;
