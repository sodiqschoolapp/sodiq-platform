-- Task 9.2b, closing a quarter (pull request #230).
--
-- `07`, Editing rules and locks: "The Academic Vice Principal closes a
-- quarter, using the checklist described under Closing a quarter. Journals of
-- that quarter become read only and the results are stored as final."
-- `07`, Closing a quarter: "Warnings must be acknowledged; they are stored
-- with the closing record"; "The whole branch is closed in one step."
-- `edge/journal`, Closing and reopening: "Close is pressed while saves are
-- still arriving. The quarter first becomes 'closing' and refuses new entries
-- from that instant. Final results are calculated from the raw entries. Only
-- then is it 'closed'. If anything fails, it returns to open and nothing is
-- stored."
-- `edge/developer-rules`, Calculation: "Stored per final result: the inputs,
-- the exact result, the rounded result, the grade, the settings used and the
-- calculation module's version."
--
-- Plan decision 2 (Look first): "closing" is the close's FOR UPDATE lock of
-- the quarter row inside its one transaction; every writer of a row that
-- feeds the quarter's results takes the quarter FOR KEY SHARE through
-- `quarter_open_guard` / `quarter_days_open_guard` (the services in a
-- statement before their first row lock, `.claude/rules/database.md`; the
-- guards below again as the database's guarantee), so a writer that holds the
-- quarter finishes before the close reads, and one that comes after waits and
-- is refused `quarters_closed`. No "closing" state is stored: a failed close
-- rolls back with nothing stored.
--
-- A quarter is closed while it has a closing row with no `reopened_at`
-- (review should-fix 7: no second copy on `quarters`). 9.2c writes
-- `reopened_at` and adds the reopening of one journal.

-- ---------------------------------------------------------------------------
-- The closings: one row per close of a quarter, numbered per quarter.

create table quarter_closings (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  quarter_id uuid not null,
  -- 1 for the first close, one more for each close after a reopening (9.2c).
  version integer not null constraint quarter_closings_version_check check (version >= 1),
  -- The transaction's moment (the injected clock), by the trigger below.
  closed_at timestamptz not null,
  closed_by uuid not null references accounts (id),
  -- "Lock now and close" (`edge/journal`, Closing and reopening, first row).
  lock_now boolean not null,
  -- `edge/academic-year`, "Closing the start quarter": keep the platform's
  -- results, or "not official"; null for any other quarter (review correction 2).
  start_quarter text constraint quarter_closings_start_quarter_check check (
    start_quarter in ('keep', 'not_official')
  ),
  -- The warnings acknowledged, as the checklist listed them (`07`).
  warnings jsonb not null constraint quarter_closings_warnings_check check (
    jsonb_typeof(warnings) = 'array'
  ),
  -- Written by the reopening of 9.2c; null while the close is in force.
  reopened_at timestamptz,
  constraint quarter_closings_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint quarter_closings_version_key unique (branch_id, quarter_id, version),
  constraint quarter_closings_id_branch_key unique (id, branch_id)
);

-- One close in force per quarter.
create unique index quarter_closings_in_force_key on quarter_closings (quarter_id)
  where reopened_at is null;

alter table quarter_closings enable row level security;
create policy branch_filter on quarter_closings for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on quarter_closings to sodiq_app;
grant insert (branch_id, quarter_id, version, closed_at, closed_by, lock_now, start_quarter, warnings)
  on quarter_closings to sodiq_app;

-- The moment from the transaction, the quarter row locked FOR UPDATE first
-- (the close's "closing" instant), the next version, and no close in a closed
-- year.
create function quarter_closings_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  year_status text;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  perform 1 from quarters q where q.id = new.quarter_id for update;
  select y.status into year_status
    from quarters q join academic_years y on y.id = q.academic_year_id
    where q.id = new.quarter_id;
  if year_status = 'closed' then
    raise exception 'academic_years_closed'
      using errcode = 'check_violation', constraint = 'academic_years_closed';
  end if;
  if exists (
    select 1 from quarter_closings c where c.quarter_id = new.quarter_id and c.reopened_at is null
  ) then
    raise exception 'quarters_closed'
      using errcode = 'check_violation', constraint = 'quarters_closed';
  end if;
  new.version := coalesce(
    (select max(c.version) from quarter_closings c where c.quarter_id = new.quarter_id), 0
  ) + 1;
  new.closed_at := moment;
  new.reopened_at := null;
  return new;
end
$$;

create trigger quarter_closings_write
  before insert on quarter_closings
  for each row execute function quarter_closings_write();

-- The names as they were (`edge/academic-year`, "A class or subject is
-- renamed, and last year's results are printed afterwards": "Closed quarters
-- and years keep the names as they were, and prints of closed periods use
-- those"; review must-fix 4). One row per closing and journal.
create table quarter_closing_journals (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  closing_id uuid not null,
  journal_id uuid not null,
  -- The class or group name as shown.
  unit_name text not null,
  -- The subject's names in the three languages: { uz, ru, en }.
  subject_names jsonb not null constraint quarter_closing_journals_subject_names_check check (
    jsonb_typeof(subject_names) = 'object'
  ),
  -- The journal's teacher on the last day, as named; null for "no teacher".
  teacher_name text,
  constraint quarter_closing_journals_closing_fkey foreign key (closing_id, branch_id)
    references quarter_closings (id, branch_id),
  constraint quarter_closing_journals_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint quarter_closing_journals_key unique (branch_id, closing_id, journal_id)
);

create index quarter_closing_journals_journal_idx on quarter_closing_journals (journal_id);

alter table quarter_closing_journals enable row level security;
create policy branch_filter on quarter_closing_journals for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on quarter_closing_journals to sodiq_app;
grant insert (branch_id, closing_id, journal_id, unit_name, subject_names, teacher_name)
  on quarter_closing_journals to sodiq_app;

-- The final results: one per student, graded subject and closing, and the
-- results at leaving of the quarter (From 8.6, 9.2a). `record` is the
-- `FinalQuarterRecord` of `packages/calc` (format 1); no value of it is
-- copied into a column, so nothing can disagree with it and no SQL reads a
-- result (review should-fix 6; CLAUDE.md, Calculation in one place).
create table quarter_final_results (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  closing_id uuid not null,
  quarter_id uuid not null,
  subject_id uuid not null references subjects (id),
  -- With no action, as the tables of results (From 2.4b-1 on 6.1, 9.1 and 9.2b).
  student_id uuid not null references students (id),
  -- The journal the student is listed under (9.2a decision 7).
  journal_id uuid not null,
  kind text not null constraint quarter_final_results_kind_check check (
    kind in ('closing', 'at_leaving')
  ),
  record jsonb not null constraint quarter_final_results_record_check check (
    jsonb_typeof(record) = 'object' and record ->> 'kind' = kind
  ),
  constraint quarter_final_results_closing_fkey foreign key (closing_id, branch_id)
    references quarter_closings (id, branch_id),
  constraint quarter_final_results_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint quarter_final_results_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint quarter_final_results_key unique (branch_id, closing_id, subject_id, student_id)
);

create index quarter_final_results_student_idx on quarter_final_results (student_id);
create index quarter_final_results_quarter_idx on quarter_final_results (quarter_id, subject_id);
create index quarter_final_results_journal_idx on quarter_final_results (journal_id);

alter table quarter_final_results enable row level security;
create policy branch_filter on quarter_final_results for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on quarter_final_results to sodiq_app;
grant insert (branch_id, closing_id, quarter_id, subject_id, student_id, journal_id, kind, record)
  on quarter_final_results to sodiq_app;
-- Only the merge of two student records moves a record to the kept one
-- (0128's carry, as 0132 does for the decisions; plan decision 5).
grant update (student_id) on quarter_final_results to sodiq_app;

create trigger quarter_final_results_merge_carry
  before update on quarter_final_results
  for each row execute function journal_merge_carry();

-- ---------------------------------------------------------------------------
-- The closed state and the guards.

-- Whether the quarter has a close in force. No lock: a reader.
create function quarter_is_closed(quarter_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from quarter_closings c where c.quarter_id = quarter_ref and c.reopened_at is null
  )
$$;

-- The quarter row locked FOR KEY SHARE whatever its state, then its state
-- read (`.claude/rules/database.md`, a guard locks first): a close held open
-- makes the writer wait, and the writer is refused once it commits.
create function quarter_open_guard(quarter_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if quarter_ref is null then
    return;
  end if;
  perform 1 from quarters q where q.id = quarter_ref for key share;
  if quarter_is_closed(quarter_ref) then
    raise exception 'quarters_closed'
      using errcode = 'check_violation', constraint = 'quarters_closed';
  end if;
end
$$;

-- The same for every dated quarter of the branch that meets the days from
-- `from_day` to `until_day`, both included (`until_day` null: no end), in the
-- order of the id.
create function quarter_days_open_guard(branch_ref uuid, from_day date, until_day date)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found uuid;
begin
  if from_day is null or (until_day is not null and until_day < from_day) then
    return;
  end if;
  for found in
    select q.id from quarters q
    where q.branch_id = branch_ref
      and q.start_date is not null
      and q.end_date >= from_day
      and (until_day is null or q.start_date <= until_day)
    order by q.id
    for key share
  loop
    if quarter_is_closed(found) then
      raise exception 'quarters_closed'
        using errcode = 'check_violation', constraint = 'quarters_closed';
    end if;
  end loop;
end
$$;

-- The quarter of a dated lesson (`edge/00-definitions`, "Quarter of a lesson
-- ... It is stored on the lesson", through its block).
create function lesson_quarter(lesson_ref uuid) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select b.quarter_id from lessons l join lesson_blocks b on b.id = l.block_id
  where l.id = lesson_ref
$$;

grant execute on function quarter_is_closed(uuid) to sodiq_app;
grant execute on function quarter_open_guard(uuid) to sodiq_app;
grant execute on function quarter_days_open_guard(uuid, date, date) to sodiq_app;
grant execute on function lesson_quarter(uuid) to sodiq_app;

-- Quarters (From 1.6, From 5.6b-5a; plan decision 9): a quarter that has been
-- closed keeps its late and skipped values and its dates, also after a
-- reopening (`edge/calculation`: "A closed quarter keeps the values it was
-- closed with, also when reopened"; `edge/time-dates-calendar`: "A closed
-- quarter's dates are frozen"). The update holds the quarter row, so a close
-- at the same moment waits for it or it waits for the close.
create function quarters_closed_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (new.start_date, new.end_date, new.late_value, new.skipped_value)
    is not distinct from (old.start_date, old.end_date, old.late_value, old.skipped_value) then
    return new;
  end if;
  if exists (select 1 from quarter_closings c where c.quarter_id = old.id) then
    raise exception 'quarters_closed'
      using errcode = 'check_violation', constraint = 'quarters_closed';
  end if;
  return new;
end
$$;

create trigger quarters_closed_guard
  before update on quarters
  for each row execute function quarters_closed_guard();

-- Quarterly weights (From 2.1; `05`: "Weights of a quarter can change until
-- the quarter is closed").
create function subject_quarter_weights_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    perform quarter_open_guard(old.quarter_id);
    return old;
  end if;
  perform quarter_open_guard(new.quarter_id);
  if tg_op = 'UPDATE' and old.quarter_id is distinct from new.quarter_id then
    perform quarter_open_guard(old.quarter_id);
  end if;
  return new;
end
$$;

create trigger subject_quarter_weights_closed_quarter
  before insert or update or delete on subject_quarter_weights
  for each row execute function subject_quarter_weights_closed_quarter();

-- Student statuses (From 2.4b-1; `edge/students-classes-groups`: "A date in
-- a closed quarter is refused"): the start of a new row, and the days between
-- the old and the new end of a row whose end changes. An update of the branch
-- alone is not checked, as 0033.
create function student_statuses_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform quarter_days_open_guard(new.branch_id, new.valid_from, new.valid_from);
  elsif new.valid_until is distinct from old.valid_until then
    perform quarter_days_open_guard(
      new.branch_id,
      least(old.valid_until, new.valid_until),
      greatest(old.valid_until, new.valid_until)
    );
  end if;
  return new;
end
$$;

create trigger student_statuses_closed_quarter
  before insert or update on student_statuses
  for each row execute function student_statuses_closed_quarter();

-- Class and group memberships (From 3.3a, 3.3c; plan decision 12): a write
-- that changes membership on a day of a closed quarter: the days of a new row
-- (`valid_until` is the first day after it), and the days between the old and
-- the new end of a row. The carry of a merge (the student alone) is not
-- checked (plan decision 5).
create function memberships_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.valid_from < new.valid_until then
      perform quarter_days_open_guard(new.branch_id, new.valid_from, new.valid_until - 1);
    end if;
  elsif new.valid_until is distinct from old.valid_until then
    perform quarter_days_open_guard(
      new.branch_id,
      least(old.valid_until, new.valid_until),
      greatest(old.valid_until, new.valid_until) - 1
    );
  end if;
  return new;
end
$$;

create trigger class_memberships_closed_quarter
  before insert or update on class_memberships
  for each row execute function memberships_closed_quarter();
create trigger group_memberships_closed_quarter
  before insert or update on group_memberships
  for each row execute function memberships_closed_quarter();

-- Reasons of absence (From 6.3; `edge/journal`: "The class Tutor and the
-- Academic Vice Principal can edit it until the quarter closes"). The carry of
-- a merge (the student alone) is not checked.
create function student_absence_reasons_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    perform quarter_days_open_guard(old.branch_id, old.absence_date, old.absence_date);
    return old;
  end if;
  if tg_op = 'UPDATE'
    and (to_jsonb(new) - 'student_id') is not distinct from (to_jsonb(old) - 'student_id') then
    return new;
  end if;
  perform quarter_days_open_guard(new.branch_id, new.absence_date, new.absence_date);
  return new;
end
$$;

create trigger student_absence_reasons_closed_quarter
  before insert or update or delete on student_absence_reasons
  for each row execute function student_absence_reasons_closed_quarter();

-- Closing decisions (From 9.2a). The carry of a merge is not checked.
create function quarter_result_decisions_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.student_id is distinct from new.student_id then
    return new;
  end if;
  perform quarter_open_guard(new.quarter_id);
  return new;
end
$$;

create trigger quarter_result_decisions_closed_quarter
  before insert or update on quarter_result_decisions
  for each row execute function quarter_result_decisions_closed_quarter();

-- Exemptions (From 8.5; `07`, Problem cases, "The dates fall in a closed
-- quarter": "The part inside a closed quarter is refused until that quarter
-- is reopened"; plan decision 4). The days a write changes: the whole range
-- of a new one, of a void and of its give-back, and of a change of what it
-- covers; the days between the old and the new start or end. The service
-- clips a request to its open part first; this is the guarantee. The carry of
-- a merge is not checked.
create function exemptions_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.student_id is distinct from old.student_id then
    return new;
  end if;
  begin
    if tg_op = 'INSERT' then
      if new.voided_at is null then
        perform quarter_days_open_guard(new.branch_id, new.start_date, new.end_date);
      end if;
      return new;
    end if;
    if (new.voided_at is null) <> (old.voided_at is null)
      or (new.kind, new.all_subjects, new.start_time, new.end_time)
        is distinct from (old.kind, old.all_subjects, old.start_time, old.end_time) then
      perform quarter_days_open_guard(
        new.branch_id,
        least(old.start_date, new.start_date),
        greatest(old.end_date, new.end_date)
      );
      return new;
    end if;
    if new.start_date is distinct from old.start_date then
      perform quarter_days_open_guard(
        new.branch_id,
        least(old.start_date, new.start_date),
        greatest(old.start_date, new.start_date) - 1
      );
    end if;
    if new.end_date is distinct from old.end_date then
      perform quarter_days_open_guard(
        new.branch_id,
        least(old.end_date, new.end_date) + 1,
        greatest(old.end_date, new.end_date)
      );
    end if;
  exception
    when check_violation then
      if sqlerrm = 'quarters_closed' then
        raise exception 'exemption_closed_quarter'
          using errcode = 'check_violation', constraint = 'exemption_closed_quarter';
      end if;
      raise;
  end;
  return new;
end
$$;

create trigger exemptions_closed_quarter
  before insert or update on exemptions
  for each row execute function exemptions_closed_quarter();

-- The journal (From 8.4; `07`: "Journals of that quarter become read only").
-- Every person's write of a lesson or a rating exam of a closed quarter is
-- refused, a correction included; the system's writes (an exemption, a
-- transfer, a cancellation, a restore) are refused at their own writers or
-- carried (plan decision 5). One function for the journal's tables, before
-- their edit guards, so no early return of those guards passes it (review
-- must-fix 1: an exemption-reopened cell, an optional cell, a plan opening, a
-- corrector's "exempt" of a rating entry). A merge's carry and an
-- `on update cascade` move (the student or the lesson alone) are not checked.
create function journal_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  row_new jsonb;
  row_old jsonb;
  quarter_ref uuid;
begin
  if tg_op = 'DELETE' then
    -- A person's delete goes through the judge (`deleted`), which checks it.
    return old;
  end if;
  row_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    row_old := to_jsonb(old);
    if (row_new - array['student_id', 'lesson_id']) = (row_old - array['student_id', 'lesson_id']) then
      return new;
    end if;
  end if;
  if tg_table_name = 'journal_rating_exams' then
    if (row_new -> 'exam_date', row_new -> 'not_held')
      is not distinct from (row_old -> 'exam_date', row_old -> 'not_held') then
      return new;
    end if;
    quarter_ref := (row_new ->> 'quarter_id')::uuid;
  else
    if coalesce(row_new ->> 'changed_how', '') not in (
      'entry', 'offline_entry', 'not_held', 'carry', 'deleted', 'undo', 'late_entry', 'correction'
    ) then
      return new;
    end if;
    if row_new ->> 'rating_exam_id' is not null then
      select x.quarter_id into quarter_ref from journal_rating_exams x
        where x.id = (row_new ->> 'rating_exam_id')::uuid;
    else
      quarter_ref := lesson_quarter((row_new ->> 'lesson_id')::uuid);
    end if;
  end if;
  perform quarter_open_guard(quarter_ref);
  return new;
end
$$;

create trigger journal_cells_closed_quarter
  before insert or update on journal_cells
  for each row execute function journal_closed_quarter();
create trigger journal_works_closed_quarter
  before insert or update on journal_works
  for each row execute function journal_closed_quarter();
create trigger journal_comments_closed_quarter
  before insert or update on journal_comments
  for each row execute function journal_closed_quarter();
create trigger journal_rating_entries_closed_quarter
  before insert or update on journal_rating_entries
  for each row execute function journal_closed_quarter();
create trigger journal_rating_exams_closed_quarter
  before update on journal_rating_exams
  for each row execute function journal_closed_quarter();
create trigger journal_lesson_deliveries_closed_quarter
  before insert or update on journal_lesson_deliveries
  for each row execute function journal_closed_quarter();
create trigger journal_homework_not_given_closed_quarter
  before insert or update on journal_homework_not_given
  for each row execute function journal_closed_quarter();

-- 0129's judge, with the closed quarter of the lesson or of the rating exam
-- for every person's kind, the deletes of a work or a comment included (From
-- 8.4). Same name and signature; otherwise unchanged.
create or replace function journal_edit_judge(
  branch_ref uuid,
  lock_at timestamptz,
  how text,
  writer uuid,
  reason text,
  lesson_ref uuid,
  journal_ref uuid,
  quarter_ref uuid
) returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if how not in (
    'entry', 'offline_entry', 'not_held', 'carry', 'deleted', 'undo', 'late_entry', 'correction'
  ) then
    return how;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    if session_user = 'sodiq_app' then
      raise exception 'journal_cell_moment'
        using errcode = 'check_violation', constraint = 'journal_cell_moment';
    end if;
    return how;
  end if;
  perform quarter_open_guard(coalesce(quarter_ref, lesson_quarter(lesson_ref)));
  if how = 'correction' or coalesce(reason, '') <> '' then
    if length(btrim(coalesce(reason, ''))) = 0 then
      raise exception 'journal_correction_reason'
        using errcode = 'check_violation', constraint = 'journal_correction_reason';
    end if;
    if not journal_corrector(writer, branch_ref, moment) then
      raise exception 'journal_correction_role'
        using errcode = 'check_violation', constraint = 'journal_correction_role';
    end if;
    return case when how = 'deleted' then how else 'correction' end;
  end if;
  if lock_at is null or moment < lock_at then
    return how;
  end if;
  if not journal_unlock_covers(
    nullif(current_setting('app.unlock_id', true), '')::uuid,
    writer, lesson_ref, journal_ref, quarter_ref, moment
  ) and not journal_orphan_covers(
    nullif(current_setting('app.orphan_assignment_id', true), '')::uuid,
    writer, lesson_ref, moment
  ) then
    raise exception 'journal_locked'
      using errcode = 'check_violation', constraint = 'journal_locked';
  end if;
  return case when how in ('entry', 'offline_entry', 'not_held', 'carry') then 'late_entry' else how end;
end;
$$;

-- Unlock requests (From 8.4): no request and no approval for a lesson or a
-- rating exam of a closed quarter. A refusal or a withdraw stays possible.
create function journal_unlocks_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.status <> 'approved' then
    return new;
  end if;
  perform quarter_open_guard(
    case when new.target = 'rating' then new.quarter_id else lesson_quarter(new.lesson_id) end
  );
  return new;
end
$$;

create trigger journal_unlocks_closed_quarter
  before insert or update on journal_unlocks
  for each row execute function journal_unlocks_closed_quarter();

-- 0122's lock moment, no later than the first close of the quarter that holds
-- the day (plan decision 3, review correction 4): "lock now and close" locks
-- the lessons still inside their edit period from the stored moment of the
-- close, and they stay locked after a reopening (`edge/journal`: "Lessons
-- stay locked"). The first close is version 1, whatever closes came later.
-- Same name and signature; otherwise unchanged.
create or replace function journal_lock_moment(branch_ref uuid, day date) returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select least(
    greatest(
      ((day + d.edit_days + 1)::timestamp at time zone d.time_zone),
      (
        select max(x.open_until) from journal_edit_extensions x
        where x.branch_id = branch_ref and x.from_date <= day and day <= x.to_date
      )
    ),
    (
      select c.closed_at from quarters q
      join quarter_closings c on c.quarter_id = q.id and c.version = 1
      where q.branch_id = branch_ref and q.start_date <= day and day <= q.end_date
    )
  )
  from (
    select e.edit_days, e.time_zone from branch_edit_days e
    where e.branch_id = branch_ref and e.changed_on < day
    order by e.changed_on desc
    limit 1
  ) d
  where day is not null
$$;
