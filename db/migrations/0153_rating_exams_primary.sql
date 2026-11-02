-- 0153 Rating exams in grades 0–4 (task 9.4f, pull request #276; the owner's
-- spec change of 1 November 2026, item 4).
--
-- docs/spec/05-classes-groups-subjects.md, Grading weights on a subject: a
-- rating subject has a second quarterly distribution "without the rating exam"
-- beside its usual one; Grades 0–4: "A school setting 'Rating exams in grades
-- 0–4', kept by the Super Admin, off by default ... acts on open quarters only
-- (a closed quarter keeps its results)"; turning it off is refused while a
-- journal of grades 0–4 of an open quarter holds a rating exam entry. Group:
-- a group of grades 4 and 5 of a rating subject is refused while it is off.
-- docs/spec/edge-cases/00-definitions.md, Rating journal: "a closed quarter
-- keeps the state it closed with".
--
-- The plan approved on pull request #276 (the owner chose reading A of the
-- permission question): decisions 1 to 12.
--
-- No existing row is changed or removed: the migration creates tables and
-- inserts rows into them only, and replaces three functions (the rule of a
-- rating journal and the group rules), each wider in what it reads, not in
-- what it lets through for a journal of grades 5 to 11.

-- ---------------------------------------------------------------------------
-- The school setting. A school-wide table of one row (named in
-- SCHOOL_WIDE_TABLES of apps/api/src/database/catalog.test.ts). When and by
-- whom it changed is read from the audit log (spec review of the plan).

create table school_settings (
  id boolean primary key default true constraint school_settings_one_row check (id),
  rating_exams_primary boolean not null
);

grant select on school_settings to sodiq_app;
grant update (rating_exams_primary) on school_settings to sodiq_app;

-- ---------------------------------------------------------------------------
-- The state of each quarter of each branch (decision 2): its own copy of the
-- setting, so a change acts on the open quarters only and a closed quarter
-- keeps the state it closed with.

create table quarter_rating_states (
  quarter_id uuid primary key,
  branch_id uuid not null references branches (id),
  rating_exams_primary boolean not null,
  constraint quarter_rating_states_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id)
);

create index quarter_rating_states_branch_idx on quarter_rating_states (branch_id);

alter table quarter_rating_states enable row level security;
create policy branch_filter on quarter_rating_states for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Written by the trigger on `quarters` (a new quarter) and by the change of the
-- setting; never removed.
grant select on quarter_rating_states to sodiq_app;
grant insert (quarter_id, branch_id) on quarter_rating_states to sodiq_app;
grant update (rating_exams_primary) on quarter_rating_states to sodiq_app;

-- The prepared report totals read the state (through the rating journal
-- rule): a change puts the branch's prepared units behind (0140). Created
-- before the rows below, so their insert is seen too (spec review of the plan).
create trigger quarter_rating_states_report_insert
  after insert on quarter_rating_states referencing new table as new_rows
  for each statement execute function report_changed_branch();
create trigger quarter_rating_states_report_update
  after update on quarter_rating_states referencing old table as old_rows new table as new_rows
  for each statement execute function report_changed_branch();
create trigger quarter_rating_states_report_delete
  after delete on quarter_rating_states referencing old table as old_rows
  for each statement execute function report_changed_branch();

-- ---------------------------------------------------------------------------
-- A journal "of grades 0–4" (decision 1, Look first): every grade of its
-- class, or of the classes its group draws from, is within 0 to 4. The one
-- definition: the API reads it from here (`journalRows`), so the grid and the
-- guards cannot disagree. Run as the invoker: the branch filter applies.

create function journal_primary(journal_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(bool_and(c.grade <= 4), false)
  from journals j
  left join group_classes gc on j.class_id is null and gc.group_id = j.group_id
  join classes c on c.id = coalesce(j.class_id, gc.class_id)
  where j.id = journal_ref
$$;

grant execute on function journal_primary(uuid) to sodiq_app;

-- The state of a quarter; on when the quarter has no row (none is missing:
-- every quarter gets one, below), which is the rule before this task.
create function quarter_rating_primary(quarter_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select r.rating_exams_primary from quarter_rating_states r where r.quarter_id = quarter_ref),
    true
  )
$$;

grant execute on function quarter_rating_primary(uuid) to sodiq_app;

-- Whether a journal has the rating exam in a quarter (`edge/00-definitions`,
-- Rating journal): its subject's switch of the quarter is graded and rating,
-- and the journal is not of grades 0–4 or the quarter's state is on. Every
-- write of 0120 and 0128 already asks this, insert and update, so a rating
-- exam or an entry of a grade 0–4 journal in a quarter whose state is off is
-- refused (`journal_rating_switch_off`).
create or replace function journal_rating_on(journal_ref uuid, quarter_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select s.journal_type = 'graded' and s.rating_exam
        and (quarter_rating_primary(quarter_ref) or not journal_primary(j.id))
      from journals j
      cross join lateral subject_quarter_switches(j.subject_id, quarter_ref) s
      where j.id = journal_ref
    ),
    false
  )
$$;

-- Whether the subject has the rating exam in a quarter of the year without a
-- closing in force (decision 5).
create function subject_rating_open_in_year(subject_ref uuid, year_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from quarters q
    cross join lateral subject_quarter_switches(subject_ref, q.id) s
    where q.academic_year_id = year_ref
      and s.journal_type = 'graded' and s.rating_exam
      and not quarter_is_closed(q.id)
  )
$$;

grant execute on function subject_rating_open_in_year(uuid, uuid) to sodiq_app;

-- Whether the active group draws from a class of grade 4 and a class of grade 5.
create function group_spans_primary(group_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from group_classes gc join classes c on c.id = gc.class_id
    where gc.group_id = group_ref and c.grade = 4
  ) and exists (
    select 1 from group_classes gc join classes c on c.id = gc.class_id
    where gc.group_id = group_ref and c.grade = 5
  )
$$;

grant execute on function group_spans_primary(uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The rows of the existing quarters (decision 3, Look first). A quarter with
-- a closing in force closed under the rule before this task, rating exams in
-- every grade: on. Every other quarter takes the setting's starting value:
-- off, the spec's default, unless an open quarter already has a journal of
-- grades 0–4 of a subject with the rating exam in that quarter; then on, so
-- no shown result changes without the preview, the reason and the audit entry
-- of the route.

insert into school_settings (id, rating_exams_primary)
select true, exists (
  select 1
  from quarters q
  join journals j on j.academic_year_id = q.academic_year_id and j.branch_id = q.branch_id
  cross join lateral subject_quarter_switches(j.subject_id, q.id) s
  where not quarter_is_closed(q.id)
    and s.journal_type = 'graded' and s.rating_exam
    and journal_primary(j.id)
);

insert into quarter_rating_states (quarter_id, branch_id, rating_exams_primary)
select q.id, q.branch_id,
  quarter_is_closed(q.id) or (select s.rating_exams_primary from school_settings s)
from quarters q;

-- ---------------------------------------------------------------------------
-- A new quarter takes the school's current value, read `for share` so that a
-- running change of the setting is waited for and its result read.

create function quarter_rating_states_insert() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform 1 from school_settings for share;
  new.rating_exams_primary := (select s.rating_exams_primary from school_settings s);
  return new;
end;
$$;

create trigger quarter_rating_states_insert
  before insert on quarter_rating_states
  for each row execute function quarter_rating_states_insert();

create function quarters_rating_state() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into quarter_rating_states (quarter_id, branch_id) values (new.id, new.branch_id);
  return null;
end;
$$;

create trigger quarters_rating_state
  after insert on quarters
  for each row execute function quarters_rating_state();

-- ---------------------------------------------------------------------------
-- A change of a quarter's state. The row lock of the update is held first;
-- then the setting row (the group writers hold it `for share`), then the
-- quarter `for key share` (a close holds it `for update`), and only then, in
-- statements of their own, the refusals read what is committed: a writer that
-- held one of those locks has finished, and one that comes after waits and
-- reads the new state.

create function quarter_rating_states_update() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.quarter_id is distinct from old.quarter_id or new.branch_id is distinct from old.branch_id then
    raise exception 'quarter_rating_state_fixed'
      using errcode = 'check_violation', constraint = 'quarter_rating_state_fixed';
  end if;
  if new.rating_exams_primary = old.rating_exams_primary then
    return new;
  end if;
  perform 1 from school_settings for no key update;
  perform 1 from quarters q where q.id = new.quarter_id for key share;
  if quarter_is_closed(new.quarter_id) then
    raise exception 'quarter_rating_state_closed'
      using errcode = 'check_violation', constraint = 'quarter_rating_state_closed';
  end if;
  if new.rating_exams_primary then
    return new;
  end if;
  -- (a) A journal of grades 0–4 of the quarter holds a rating exam entry: a
  -- score, "did not sit" or "exempt"; a cleared entry does not count.
  if exists (
    select 1
    from journal_rating_exams x
    join journal_rating_entries e on e.rating_exam_id = x.id
    where x.quarter_id = new.quarter_id
      and e.kind is not null
      and journal_primary(x.journal_id)
  ) then
    raise exception 'quarter_rating_state_entries'
      using errcode = 'check_violation', constraint = 'quarter_rating_state_entries';
  end if;
  -- (b) An active group of grades 4 and 5 of a subject with the rating exam
  -- in this quarter (decision 5).
  if exists (
    select 1
    from groups g
    join quarters q on q.id = new.quarter_id and q.academic_year_id = g.academic_year_id
    cross join lateral subject_quarter_switches(g.subject_id, q.id) s
    where g.archived_at is null
      and s.journal_type = 'graded' and s.rating_exam
      and group_spans_primary(g.id)
  ) then
    raise exception 'quarter_rating_state_groups'
      using errcode = 'check_violation', constraint = 'quarter_rating_state_groups';
  end if;
  return new;
end;
$$;

create trigger quarter_rating_states_update
  before update on quarter_rating_states
  for each row execute function quarter_rating_states_update();

-- ---------------------------------------------------------------------------
-- Every rating exam and entry write takes the quarter's state row `for share`
-- before the write trigger of 0120 / 0128 asks `journal_rating_on`, in a
-- statement of its own, so a turn-off and a concurrent entry never both
-- commit. The trigger's name sorts before the others of the table, so it runs
-- first.

create function journal_rating_state_lock() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  quarter_ref uuid;
begin
  if tg_table_name = 'journal_rating_exams' then
    quarter_ref := new.quarter_id;
  else
    select x.quarter_id into quarter_ref from journal_rating_exams x where x.id = new.rating_exam_id;
  end if;
  perform 1 from quarter_rating_states r where r.quarter_id = quarter_ref for share;
  return new;
end;
$$;

create trigger journal_rating_exams_a_state
  before insert or update on journal_rating_exams
  for each row execute function journal_rating_state_lock();

create trigger journal_rating_entries_a_state
  before insert or update on journal_rating_entries
  for each row execute function journal_rating_state_lock();

-- ---------------------------------------------------------------------------
-- The group rule (decision 5; `05`, Group): a group of a subject with the
-- rating exam in an open quarter of its year, whose classes include grade 4
-- and grade 5, is refused while the setting is off. Added to `group_rules`
-- (0046 as it stands), so it runs on create, on a class added and on restore.
-- The setting row is read `for share`: a change of the setting waits for the
-- group, or the group waits for the change and reads its result.

create or replace function group_rules(group_ref uuid)
 returns void
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  g record;
  year_state text;
  subject_archived timestamptz;
  subject_grades smallint[];
  class_count integer;
  grade_count integer;
  language_count integer;
  shared_language text;
begin
  perform 1 from groups where id = group_ref for share;
  select * into g from groups where id = group_ref;
  if not found then
    return;
  end if;

  perform 1 from academic_years y where y.id = g.academic_year_id for share;
  select y.status into year_state from academic_years y where y.id = g.academic_year_id;
  if year_state = 'closed' then
    raise exception 'group_year_closed'
      using errcode = 'check_violation', constraint = 'group_year_closed';
  end if;

  -- Decision 10: an archived group is not checked again; a restore is.
  if g.archived_at is not null then
    return;
  end if;

  perform 1 from subjects s where s.id = g.subject_id for share;
  select s.archived_at, s.grades into subject_archived, subject_grades
    from subjects s where s.id = g.subject_id;
  if subject_archived is not null then
    raise exception 'group_subject_archived'
      using errcode = 'check_violation', constraint = 'group_subject_archived';
  end if;

  perform 1 from classes c
    where c.id in (select gc.class_id from group_classes gc where gc.group_id = group_ref)
    order by c.id
    for share;

  select count(*) into class_count from group_classes gc where gc.group_id = group_ref;
  if class_count = 0 then
    raise exception 'group_needs_class'
      using errcode = 'check_violation', constraint = 'group_needs_class';
  end if;

  if exists (
    select 1 from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref
      and (c.archived_at is not null or c.academic_year_id <> g.academic_year_id)
  ) then
    raise exception 'group_class_year'
      using errcode = 'check_violation', constraint = 'group_class_year';
  end if;

  select count(distinct c.grade), count(distinct c.language),
      min(c.language)
    into grade_count, language_count, shared_language
    from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref;
  if grade_count > 2 then
    raise exception 'group_grades'
      using errcode = 'check_violation', constraint = 'group_grades';
  end if;

  -- Decision 16 (Look first): the subject is taught in every grade of the
  -- group.
  if exists (
    select 1 from group_classes gc
    join classes c on c.id = gc.class_id
    where gc.group_id = group_ref and not (c.grade = any (subject_grades))
  ) then
    raise exception 'group_subject_grade'
      using errcode = 'check_violation', constraint = 'group_subject_grade';
  end if;

  -- Decision 8: the classes' language when they share one.
  if language_count = 1 and g.language <> shared_language then
    raise exception 'group_language'
      using errcode = 'check_violation', constraint = 'group_language';
  end if;

  -- Task 9.4f, decision 5: grades 4 and 5 of a rating subject while the
  -- setting "Rating exams in grades 0–4" is off.
  if group_spans_primary(group_ref) then
    perform 1 from school_settings for share;
    if not (select s.rating_exams_primary from school_settings s)
      and subject_rating_open_in_year(g.subject_id, g.academic_year_id) then
      raise exception 'groups_rating_primary_span'
        using errcode = 'check_violation', constraint = 'groups_rating_primary_span';
    end if;
  end if;
end;
$function$;

-- The same refusal when a subject's rating switch is turned on (decision 5):
-- a new switch row with the rating exam, where the subject's row before it had
-- none, while the setting is off and an active group of grades 4 and 5 of the
-- subject exists in a year that is not closed.
create function subject_switches_rating_primary() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  was_on boolean;
begin
  if not (new.journal_type = 'graded' and new.rating_exam) then
    return null;
  end if;
  select s.journal_type = 'graded' and s.rating_exam into was_on
    from subject_switches s
    where s.subject_id = new.subject_id and s.id <> new.id
    order by s.changed_at desc, s.id desc
    limit 1;
  if coalesce(was_on, false) then
    return null;
  end if;
  perform 1 from school_settings for share;
  if (select s.rating_exams_primary from school_settings s) then
    return null;
  end if;
  if exists (
    select 1
    from groups g
    join academic_years y on y.id = g.academic_year_id
    where g.subject_id = new.subject_id
      and g.archived_at is null
      and y.status <> 'closed'
      and group_spans_primary(g.id)
  ) then
    raise exception 'groups_rating_primary_span'
      using errcode = 'check_violation', constraint = 'groups_rating_primary_span';
  end if;
  return null;
end;
$$;

create trigger subject_switches_rating_primary
  after insert on subject_switches
  for each row execute function subject_switches_rating_primary();

-- ---------------------------------------------------------------------------
-- A class moved from grades 5–11 into 0–4 (decision 6): refused where a
-- journal of the class of a rating subject holds a rating exam entry in an
-- open quarter whose state is off (the entries would be hidden), or where a
-- quarter with a closing in force has the state off (a closed quarter keeps
-- its rating column). The states of the class's year are read `for share`.

create function classes_grade_rating_primary() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not (old.grade >= 5 and new.grade <= 4) then
    return new;
  end if;
  perform 1 from quarter_rating_states r
    join quarters q on q.id = r.quarter_id
    where q.academic_year_id = new.academic_year_id
    order by r.quarter_id
    for share of r;
  if exists (
    select 1
    from journals j
    join quarters q on q.academic_year_id = j.academic_year_id
    cross join lateral subject_quarter_switches(j.subject_id, q.id) s
    where j.class_id = new.id
      and s.journal_type = 'graded' and s.rating_exam
      and not quarter_rating_primary(q.id)
      and (
        quarter_is_closed(q.id)
        or exists (
          select 1 from journal_rating_exams x
          join journal_rating_entries e on e.rating_exam_id = x.id
          where x.journal_id = j.id and x.quarter_id = q.id and e.kind is not null
        )
      )
  ) then
    raise exception 'classes_grade_rating_primary'
      using errcode = 'check_violation', constraint = 'classes_grade_rating_primary';
  end if;
  return new;
end;
$$;

create trigger classes_grade_rating_primary
  before update of grade on classes
  for each row execute function classes_grade_rating_primary();

-- ---------------------------------------------------------------------------
-- The quarterly distribution without the rating exam (decision 7): for a
-- rating subject, beside its usual one, per quarter and branch; attendance,
-- classwork and homework, total 100. It counts only in the subject's rounds
-- of the quarter, as the usual one does.

create table subject_quarter_primary_weights (
  branch_id uuid not null references branches (id),
  subject_id uuid not null references subjects (id),
  quarter_id uuid not null,
  attendance smallint not null constraint subject_quarter_primary_weights_attendance_check check (
    attendance between 1 and 100
  ),
  classwork smallint not null constraint subject_quarter_primary_weights_classwork_check check (
    classwork between 1 and 100
  ),
  homework smallint not null constraint subject_quarter_primary_weights_homework_check check (
    homework between 1 and 100
  ),
  constraint subject_quarter_primary_weights_total_check check (
    attendance + classwork + homework = 100
  ),
  weights_round integer not null constraint subject_quarter_primary_weights_round_check check (
    weights_round >= 1
  ),
  rating_round integer not null constraint subject_quarter_primary_weights_rating_round_check check (
    rating_round >= 1
  ),
  constraint subject_quarter_primary_weights_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  primary key (branch_id, subject_id, quarter_id)
);

alter table subject_quarter_primary_weights enable row level security;
create policy branch_filter on subject_quarter_primary_weights for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

create index subject_quarter_primary_weights_subject_idx
  on subject_quarter_primary_weights (subject_id);
create index subject_quarter_primary_weights_quarter_idx
  on subject_quarter_primary_weights (quarter_id);

grant select on subject_quarter_primary_weights to sodiq_app;
grant insert (
  branch_id, subject_id, quarter_id, attendance, classwork, homework, weights_round, rating_round
) on subject_quarter_primary_weights to sodiq_app;
grant update (attendance, classwork, homework, weights_round, rating_round)
  on subject_quarter_primary_weights to sodiq_app;

-- The guards of the usual distribution: no change in a closed quarter (0133),
-- none in a closed year (0020), and the rounds of the quarter's switches (0120),
-- which also refuses a subject without the rating exam in the quarter.
create trigger subject_quarter_primary_weights_closed_quarter
  before insert or update or delete on subject_quarter_primary_weights
  for each row execute function subject_quarter_weights_closed_quarter();

create trigger subject_quarter_primary_weights_closed_year_guard
  before insert or update on subject_quarter_primary_weights
  for each row execute function subject_quarter_weights_closed_year_guard();

create function subject_quarter_primary_weights_rounds() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  switches record;
begin
  perform 1 from subjects where id = new.subject_id for share;
  select * into switches from subject_quarter_switches(new.subject_id, new.quarter_id);
  if not coalesce(switches.journal_type = 'graded' and switches.rating_exam, false) then
    raise exception 'subject_quarter_primary_weights_rating'
      using errcode = 'check_violation', constraint = 'subject_quarter_primary_weights_rating';
  end if;
  if new.weights_round is distinct from switches.weights_round then
    raise exception 'subject_weights_current_round'
      using errcode = 'check_violation', constraint = 'subject_weights_current_round';
  end if;
  if new.rating_round is distinct from switches.rating_round then
    raise exception 'subject_quarter_weights_current_rating_round'
      using errcode = 'check_violation',
        constraint = 'subject_quarter_weights_current_rating_round';
  end if;
  return new;
end;
$$;

create trigger subject_quarter_primary_weights_rounds
  before insert or update on subject_quarter_primary_weights
  for each row execute function subject_quarter_primary_weights_rounds();

create trigger subject_quarter_primary_weights_report_insert
  after insert on subject_quarter_primary_weights referencing new table as new_rows
  for each statement execute function report_changed_branch();
create trigger subject_quarter_primary_weights_report_update
  after update on subject_quarter_primary_weights
  referencing old table as old_rows new table as new_rows
  for each statement execute function report_changed_branch();
create trigger subject_quarter_primary_weights_report_delete
  after delete on subject_quarter_primary_weights referencing old table as old_rows
  for each statement execute function report_changed_branch();
