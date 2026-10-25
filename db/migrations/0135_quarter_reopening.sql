-- Task 9.2c, reopening and the nightly check (pull request #231).
--
-- `edge/journal`, Closing and reopening: "A closed quarter must be reopened to
-- fix one mark. Reopening is for one journal or the whole branch, for a set
-- number of days. Lessons stay locked; only corrections and explicit unlocks
-- apply. The earlier final results are kept as a version. Closing again lists
-- every result that changed. Quarters are closed in order."
-- `07`, Editing rules and locks: "Reopening needs a reason and is logged."
-- `edge/system-behaviour`, "The nightly check": "It recalculates open journals
-- and stored final results. A difference alerts the developer and blocks
-- closing that journal. A check that did not run also raises an alert."
-- `edge/exemptions`, "The range starts in a closed quarter and ends in an open
-- one": "The closed part is applied after the affected journals of that
-- quarter are reopened" (review correction 1).
-- `edge/people-roles-accounts`: a forced delete's data is removed after the
-- restore time "and a summary stays in the audit log" (From 5.8b).
--
-- Plan decisions 2 to 5 (Look first): a journal's re-close and an applied
-- recalculation are versions in force beside the branch close; a reopening
-- ends at a stored moment, after which its entries are refused again until
-- the re-close; a whole-branch reopening opens the quarter, a journal's opens
-- that journal's rows; in a reopened quarter or journal a person's write is a
-- correction or is made under an unlock decided after the close.

-- ---------------------------------------------------------------------------
-- The versions: a branch close, a journal's re-close, an applied recalculation.

alter table quarter_closings
  add column journal_id uuid,
  add column cause text not null default 'close'
    constraint quarter_closings_cause_check check (cause in ('close', 'journal_close', 'recalculation')),
  add column reason text constraint quarter_closings_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  -- The results that changed against the version in force before (plan decision 8).
  add column changes jsonb not null default '[]'
    constraint quarter_closings_changes_check check (jsonb_typeof(changes) = 'array'),
  -- "Written by this transaction" (`.claude/rules/database.md`, the savepoint line).
  add column created_xact xid8 not null default pg_current_xact_id(),
  add constraint quarter_closings_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  add constraint quarter_closings_cause_journal_check check (
    (cause = 'journal_close') = (journal_id is not null)
    and (cause = 'recalculation') = (reason is not null)
  );

-- One branch close in force per quarter, as before (plan decision 2).
drop index quarter_closings_in_force_key;
create unique index quarter_closings_in_force_key on quarter_closings (quarter_id)
  where reopened_at is null and cause = 'close';

grant insert (journal_id, cause, reason, changes) on quarter_closings to sodiq_app;
grant update (reopened_at) on quarter_closings to sodiq_app;

-- The branch close in force of a quarter, or null. No lock: a reader.
create function quarter_branch_close(quarter_ref uuid) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select c.id from quarter_closings c
  where c.quarter_id = quarter_ref and c.reopened_at is null and c.cause = 'close'
$$;

grant execute on function quarter_branch_close(uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The reopenings.

create table quarter_reopenings (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  quarter_id uuid not null,
  -- The branch close in force that is reopened.
  closing_id uuid not null,
  -- Null: the whole branch.
  journal_id uuid,
  reason text not null constraint quarter_reopenings_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  days smallint not null constraint quarter_reopenings_days_check check (days between 1 and 14),
  -- The transaction's moment (the injected clock), by the trigger below.
  reopened_at timestamptz not null,
  -- 00:00 branch time of the day after the reopening day plus the days, as an
  -- unlock's end (0122, decision 4); compared with the moment on each request.
  open_until timestamptz not null,
  reopened_by uuid not null references accounts (id),
  -- The close that ended it; null while it is unfinished.
  ended_by_closing_id uuid,
  created_xact xid8 not null default pg_current_xact_id(),
  constraint quarter_reopenings_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint quarter_reopenings_closing_fkey foreign key (closing_id, branch_id)
    references quarter_closings (id, branch_id),
  constraint quarter_reopenings_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint quarter_reopenings_ended_fkey foreign key (ended_by_closing_id, branch_id)
    references quarter_closings (id, branch_id),
  constraint quarter_reopenings_order_check check (open_until > reopened_at)
);

create index quarter_reopenings_quarter_idx on quarter_reopenings (quarter_id);
create index quarter_reopenings_journal_idx on quarter_reopenings (journal_id);
-- One unfinished reopening per quarter and journal, and per quarter for the whole branch.
create unique index quarter_reopenings_unfinished_journal_key on quarter_reopenings (quarter_id, journal_id)
  where ended_by_closing_id is null and journal_id is not null;
create unique index quarter_reopenings_unfinished_branch_key on quarter_reopenings (quarter_id)
  where ended_by_closing_id is null and journal_id is null;

alter table quarter_reopenings enable row level security;
create policy branch_filter on quarter_reopenings for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on quarter_reopenings to sodiq_app;
grant insert (branch_id, quarter_id, closing_id, journal_id, reason, days, reopened_at, open_until, reopened_by)
  on quarter_reopenings to sodiq_app;
grant update (ended_by_closing_id) on quarter_reopenings to sodiq_app;

-- The unfinished reopening of a quarter for a journal (null: the whole branch), or null.
create function quarter_unfinished_reopening(quarter_ref uuid, journal_ref uuid) returns quarter_reopenings
language sql
stable
set search_path = pg_catalog, public
as $$
  select r.* from quarter_reopenings r
  where r.quarter_id = quarter_ref
    and r.journal_id is not distinct from journal_ref
    and r.ended_by_closing_id is null
$$;

grant execute on function quarter_unfinished_reopening(uuid, uuid) to sodiq_app;

-- The moment from the transaction, the quarter row locked FOR UPDATE first
-- (as the close: a writer that holds the quarter finishes first), the close
-- reopened is the branch close in force, no reopening in a closed year, one
-- unfinished per journal, and none of a journal and of the whole branch at
-- once (plan, Database 2).
create function quarter_reopenings_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  year_status text;
  zone text;
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
  if quarter_branch_close(new.quarter_id) is distinct from new.closing_id then
    raise exception 'quarter_not_closed'
      using errcode = 'check_violation', constraint = 'quarter_not_closed';
  end if;
  if (quarter_unfinished_reopening(new.quarter_id, new.journal_id)).id is not null then
    raise exception 'quarter_reopened'
      using errcode = 'check_violation', constraint = 'quarter_reopened';
  end if;
  if new.journal_id is null then
    if exists (
      select 1 from quarter_reopenings r
      where r.quarter_id = new.quarter_id and r.journal_id is not null and r.ended_by_closing_id is null
    ) then
      raise exception 'quarter_journal_reopened'
        using errcode = 'check_violation', constraint = 'quarter_journal_reopened';
    end if;
  elsif not exists (
    -- A journal of the close reopened (its names were stored with it).
    select 1 from quarter_closing_journals j
    where j.closing_id = new.closing_id and j.journal_id = new.journal_id
  ) then
    raise exception 'quarter_journal_not_closed'
      using errcode = 'check_violation', constraint = 'quarter_journal_not_closed';
  end if;
  select b.time_zone into zone from branches b where b.id = new.branch_id;
  new.reopened_at := moment;
  new.open_until := (((moment at time zone zone)::date + new.days + 1)::timestamp at time zone zone);
  new.ended_by_closing_id := null;
  return new;
end
$$;

create trigger quarter_reopenings_write
  before insert on quarter_reopenings
  for each row execute function quarter_reopenings_write();

-- A whole-branch reopening takes every version in force of the quarter out of
-- force (`reopened_at`), in its transaction.
create function quarter_reopenings_reopen() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.journal_id is null then
    update quarter_closings set reopened_at = new.reopened_at
      where quarter_id = new.quarter_id and reopened_at is null;
  end if;
  return null;
end
$$;

create trigger quarter_reopenings_reopen
  after insert on quarter_reopenings
  for each row execute function quarter_reopenings_reopen();

-- `ended_by_closing_id` only from null, to a version of the same quarter
-- written by this transaction: a branch close ends every reopening of the
-- quarter, a journal's re-close the reopening of that journal (review
-- must-fix 8). Nothing else changes.
create function quarter_reopenings_end() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  ending quarter_closings;
begin
  -- The migrator's fixtures (tests) are not the application.
  if session_user <> 'sodiq_app' then
    return new;
  end if;
  if (to_jsonb(new) - 'ended_by_closing_id') is distinct from (to_jsonb(old) - 'ended_by_closing_id')
    or old.ended_by_closing_id is not null
    or new.ended_by_closing_id is null then
    raise exception 'quarter_reopenings_end'
      using errcode = 'check_violation', constraint = 'quarter_reopenings_end';
  end if;
  select * into ending from quarter_closings c where c.id = new.ended_by_closing_id;
  if ending.quarter_id is distinct from old.quarter_id
    or ending.created_xact <> pg_current_xact_id()
    or not (
      ending.cause = 'close'
      or (ending.cause = 'journal_close' and ending.journal_id = old.journal_id)
    ) then
    raise exception 'quarter_reopenings_end'
      using errcode = 'check_violation', constraint = 'quarter_reopenings_end';
  end if;
  return new;
end
$$;

create trigger quarter_reopenings_end
  before update on quarter_reopenings
  for each row execute function quarter_reopenings_end();

-- `reopened_at` of a version only from null to the moment, and only by a
-- whole-branch reopening of its quarter inserted by this transaction (review
-- must-fix 7: no write reopens a quarter without a reason and days).
create function quarter_closings_reopen() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- The migrator's fixtures (tests) are not the application.
  if session_user <> 'sodiq_app' then
    return new;
  end if;
  if (to_jsonb(new) - 'reopened_at') is distinct from (to_jsonb(old) - 'reopened_at')
    or old.reopened_at is not null
    or new.reopened_at is distinct from class_tutors_moment()
    or not exists (
      select 1 from quarter_reopenings r
      where r.quarter_id = old.quarter_id and r.journal_id is null
        and r.ended_by_closing_id is null and r.created_xact = pg_current_xact_id()
    ) then
    raise exception 'quarter_closings_reopen'
      using errcode = 'check_violation', constraint = 'quarter_closings_reopen';
  end if;
  return new;
end
$$;

create trigger quarter_closings_reopen
  before update on quarter_closings
  for each row execute function quarter_closings_reopen();

-- 0133's write of a version, for the three causes: the next version per
-- quarter and the moment for each; a branch close while none is in force, a
-- journal's re-close while the branch close is in force and the journal has
-- an unfinished reopening, a recalculation while the branch close is in force.
-- Same name; replaces 0133's.
create or replace function quarter_closings_write() returns trigger
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
  if new.cause = 'close' then
    if quarter_branch_close(new.quarter_id) is not null then
      raise exception 'quarters_closed'
        using errcode = 'check_violation', constraint = 'quarters_closed';
    end if;
  else
    if quarter_branch_close(new.quarter_id) is null then
      raise exception 'quarter_not_closed'
        using errcode = 'check_violation', constraint = 'quarter_not_closed';
    end if;
    if new.cause = 'journal_close'
      and (quarter_unfinished_reopening(new.quarter_id, new.journal_id)).id is null then
      raise exception 'quarter_journal_not_reopened'
        using errcode = 'check_violation', constraint = 'quarter_journal_not_reopened';
    end if;
  end if;
  new.version := coalesce(
    (select max(c.version) from quarter_closings c where c.quarter_id = new.quarter_id), 0
  ) + 1;
  new.closed_at := moment;
  new.reopened_at := null;
  return new;
end
$$;

-- A close ends the reopenings it closes again, in its transaction.
create function quarter_closings_end_reopenings() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.cause = 'close' then
    update quarter_reopenings set ended_by_closing_id = new.id
      where quarter_id = new.quarter_id and ended_by_closing_id is null;
  elsif new.cause = 'journal_close' then
    update quarter_reopenings set ended_by_closing_id = new.id
      where quarter_id = new.quarter_id and journal_id = new.journal_id
        and ended_by_closing_id is null;
  end if;
  return null;
end
$$;

create trigger quarter_closings_end_reopenings
  after insert on quarter_closings
  for each row execute function quarter_closings_end_reopenings();

-- ---------------------------------------------------------------------------
-- The closed state, with the reopenings.

-- Closed for writes: a branch close in force, or a whole-branch reopening
-- that is unfinished and whose end has passed at the transaction's moment
-- (plan decision 3). The migrator, with no moment, sees an unfinished
-- reopening as open. Replaces 0133's; `quarterClosedNow` of
-- `closed-quarters.ts` answers the same at `transactionMoment`.
create or replace function quarter_is_closed(quarter_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select quarter_branch_close(quarter_ref) is not null
    or coalesce(
      (quarter_unfinished_reopening(quarter_ref, null)).open_until <= class_tutors_moment(),
      false
    )
$$;

-- Open for a journal's own rows: the quarter is open, or the journal has an
-- unfinished reopening whose end has not passed (plan decision 4).
create function quarter_journal_open(quarter_ref uuid, journal_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select not quarter_is_closed(quarter_ref)
    or coalesce(
      (quarter_unfinished_reopening(quarter_ref, journal_ref)).open_until > class_tutors_moment(),
      false
    )
$$;

-- Whether the quarter has ever been closed: in a reopened quarter or journal
-- only corrections and explicit unlocks apply (plan decision 5).
create function quarter_ever_closed(quarter_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (select 1 from quarter_closings c where c.quarter_id = quarter_ref)
$$;

-- `quarter_open_guard` for a journal's own row: the quarter FOR KEY SHARE
-- whatever its state, then its state for that journal.
create function quarter_journal_open_guard(quarter_ref uuid, journal_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if quarter_ref is null then
    return;
  end if;
  perform 1 from quarters q where q.id = quarter_ref for key share;
  if not quarter_journal_open(quarter_ref, journal_ref) then
    raise exception 'quarters_closed'
      using errcode = 'check_violation', constraint = 'quarters_closed';
  end if;
end
$$;

-- The journal of a dated lesson: its block's year, its class or group and its subject.
create function lesson_journal(lesson_ref uuid) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select j.id from lessons l
  join lesson_blocks b on b.id = l.block_id
  join journals j on j.branch_id = l.branch_id
    and j.academic_year_id = b.academic_year_id
    and j.subject_id = l.subject_id
    and (j.class_id = l.class_id or j.group_id = l.group_id)
  where l.id = lesson_ref
$$;

grant execute on function quarter_journal_open(uuid, uuid) to sodiq_app;
grant execute on function quarter_ever_closed(uuid) to sodiq_app;
grant execute on function quarter_journal_open_guard(uuid, uuid) to sodiq_app;
grant execute on function lesson_journal(uuid) to sodiq_app;

-- 0122's unlock coverage: an unlock decided before a close of its quarter
-- never covers it again (From 9.2b, decision 3: "only corrections and
-- explicit unlocks apply"; plan decision 5). Same name and signature;
-- otherwise unchanged.
create or replace function journal_unlock_covers(
  unlock_ref uuid,
  account_ref uuid,
  lesson_ref uuid,
  journal_ref uuid,
  quarter_ref uuid,
  moment timestamptz
) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found_row journal_unlocks;
begin
  if unlock_ref is null then
    return false;
  end if;
  select * into found_row from journal_unlocks u where u.id = unlock_ref for share;
  if not found then
    return false;
  end if;
  return found_row.status = 'approved'
    and found_row.open_until > moment
    and exists (select 1 from staff s where s.id = found_row.staff_id and s.account_id = account_ref)
    and case found_row.target
      when 'lesson' then lesson_ref is not null and found_row.lesson_id = lesson_ref
      else lesson_ref is null and found_row.journal_id = journal_ref
        and found_row.quarter_id = quarter_ref
    end
    -- A close of the branch, or a re-close of the unlock's journal, after the decision.
    and not exists (
      select 1 from quarter_closings c
      where c.quarter_id = coalesce(found_row.quarter_id, lesson_quarter(found_row.lesson_id))
        and c.closed_at > found_row.decided_at
        and (
          c.cause = 'close'
          or (
            c.cause = 'journal_close'
            and c.journal_id = coalesce(found_row.journal_id, lesson_journal(found_row.lesson_id))
          )
        )
    );
end;
$$;

-- In a quarter that has been closed and is open again for the journal
-- (reopened), a person's write is taken only as a correction or under an
-- unlock decided after the close (plan decision 5); otherwise `journal_locked`.
-- The orphan assignments, the plan openings and the cells an exemption
-- reopened give no write there.
create function journal_reopened_check(
  quarter_ref uuid,
  journal_ref uuid,
  lesson_ref uuid,
  how text,
  writer uuid,
  reason text
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if quarter_ref is null or not quarter_ever_closed(quarter_ref) then
    return;
  end if;
  if how = 'correction' or coalesce(btrim(reason), '') <> '' then
    -- The judge checks the corrector and the reason.
    return;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    return;
  end if;
  if not journal_unlock_covers(
    nullif(current_setting('app.unlock_id', true), '')::uuid,
    writer,
    lesson_ref,
    case when lesson_ref is null then journal_ref end,
    case when lesson_ref is null then quarter_ref end,
    moment
  ) then
    raise exception 'journal_locked'
      using errcode = 'check_violation', constraint = 'journal_locked';
  end if;
end
$$;

-- 0133's guard of the journal's tables, for the journal of the row: the open
-- state of the quarter for that journal, and in a reopened one the rule
-- above. Same name; otherwise unchanged.
create or replace function journal_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  row_new jsonb;
  row_old jsonb;
  quarter_ref uuid;
  journal_ref uuid;
  lesson_ref uuid;
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
    journal_ref := (row_new ->> 'journal_id')::uuid;
    perform quarter_journal_open_guard(quarter_ref, journal_ref);
    -- The exam's date and "not held" in a reopened quarter: a corrector's only.
    if quarter_ever_closed(quarter_ref) and not journal_corrector(
      (row_new ->> 'changed_by')::uuid, new.branch_id, class_tutors_moment()
    ) and class_tutors_moment() is not null then
      raise exception 'journal_locked'
        using errcode = 'check_violation', constraint = 'journal_locked';
    end if;
    return new;
  end if;
  if coalesce(row_new ->> 'changed_how', '') not in (
    'entry', 'offline_entry', 'not_held', 'carry', 'deleted', 'undo', 'late_entry', 'correction'
  ) then
    return new;
  end if;
  if row_new ->> 'rating_exam_id' is not null then
    select x.quarter_id, x.journal_id into quarter_ref, journal_ref from journal_rating_exams x
      where x.id = (row_new ->> 'rating_exam_id')::uuid;
  else
    lesson_ref := (row_new ->> 'lesson_id')::uuid;
    quarter_ref := lesson_quarter(lesson_ref);
    journal_ref := lesson_journal(lesson_ref);
  end if;
  perform quarter_journal_open_guard(quarter_ref, journal_ref);
  perform journal_reopened_check(
    quarter_ref, journal_ref, lesson_ref, row_new ->> 'changed_how',
    (row_new ->> 'changed_by')::uuid, journal_correction_reason()
  );
  return new;
end
$$;

-- 0133's judge, with the open state of the quarter for the journal of the
-- lesson or of the rating exam, and in a reopened one no orphan assignment
-- (plan decision 5). Same name and signature; otherwise unchanged.
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
  quarter_of uuid;
  journal_of uuid;
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
  quarter_of := coalesce(quarter_ref, lesson_quarter(lesson_ref));
  journal_of := coalesce(journal_ref, lesson_journal(lesson_ref));
  perform quarter_journal_open_guard(quarter_of, journal_of);
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
  ) and (
    quarter_ever_closed(quarter_of)
    or not journal_orphan_covers(
      nullif(current_setting('app.orphan_assignment_id', true), '')::uuid,
      writer, lesson_ref, moment
    )
  ) then
    raise exception 'journal_locked'
      using errcode = 'check_violation', constraint = 'journal_locked';
  end if;
  return case when how in ('entry', 'offline_entry', 'not_held', 'carry') then 'late_entry' else how end;
end;
$$;

-- 0133's guard of unlock requests, for the journal of the lesson or of the
-- rating exam: a request and an approval in a reopened journal are taken
-- while its reopening is open. Same name; otherwise unchanged.
create or replace function journal_unlocks_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.status <> 'approved' then
    return new;
  end if;
  if new.target = 'rating' then
    perform quarter_journal_open_guard(new.quarter_id, new.journal_id);
  else
    perform quarter_journal_open_guard(lesson_quarter(new.lesson_id), lesson_journal(new.lesson_id));
  end if;
  return new;
end
$$;

-- 0133's guard of the closing decisions: a decision is taken while the
-- quarter has an unfinished reopening of the whole branch or of a journal of
-- the decision's subject, also after its end has passed, until the re-close
-- (review must-fix 1: a correction can raise a flag the re-close needs
-- decided). The service checks the student is listed under that journal.
-- Same name; otherwise unchanged.
create or replace function quarter_result_decisions_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.student_id is distinct from new.student_id then
    return new;
  end if;
  perform 1 from quarters q where q.id = new.quarter_id for key share;
  if exists (
    select 1 from quarter_reopenings r
    left join journals j on j.id = r.journal_id
    where r.quarter_id = new.quarter_id and r.ended_by_closing_id is null
      and (r.journal_id is null or j.subject_id = new.subject_id)
  ) then
    return new;
  end if;
  perform quarter_open_guard(new.quarter_id);
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Exemptions (review correction 1; `edge/exemptions`: "The closed part is
-- applied after the affected journals of that quarter are reopened"). In a
-- closed quarter the days of a change are taken when every journal they reach
-- (the student's journals with a lesson on those days, every subject for one
-- of all subjects, the exemption's subjects otherwise) has an unfinished
-- reopening whose end has not passed; with no journal reached, refused as
-- before.

-- Whether the days `from_day` to `until_day` of quarter `quarter_ref` may be
-- changed for the student in the subjects given (`subjects` null: all).
create function exemption_quarter_applies(
  quarter_ref uuid,
  student_ref uuid,
  subjects uuid[],
  from_day date,
  until_day date
) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  with reached as materialized (
    select distinct lesson_journal(l.id) as journal_id
    from lessons l
    join lesson_blocks b on b.id = l.block_id
    where b.quarter_id = quarter_ref
      and l.lesson_date between from_day and until_day
      and l.cancel_cause is null
      and (subjects is null or l.subject_id = any (subjects))
      and (
        exists (
          select 1 from class_memberships m
          where m.student_id = student_ref and m.class_id = l.class_id
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        )
        or exists (
          select 1 from group_memberships m
          where m.student_id = student_ref and m.group_id = l.group_id
            and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        )
      )
  )
  select exists (select 1 from reached)
    and not exists (
      select 1 from reached r where not coalesce(
        (quarter_unfinished_reopening(quarter_ref, r.journal_id)).open_until > class_tutors_moment(),
        false
      )
    )
$$;

grant execute on function exemption_quarter_applies(uuid, uuid, uuid[], date, date) to sodiq_app;

-- `quarter_days_open_guard` for an exemption: each dated quarter of the
-- branch meeting the days FOR KEY SHARE in the order of the id; a closed one
-- is passed when the days inside it may be changed for the exemption.
-- `subjects_known` false (the insert of an exemption of some subjects, before
-- its subject rows): a closed quarter is passed when one of its journals has
-- an open reopening, and the subject rows' trigger checks again.
create function exemption_days_open_guard(
  e exemptions,
  subjects_known boolean,
  from_day date,
  until_day date
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  found record;
  subjects uuid[];
begin
  if from_day is null or (until_day is not null and until_day < from_day) then
    return;
  end if;
  if not e.all_subjects then
    select array_agg(s.subject_id) into subjects from exemption_subjects s where s.exemption_id = e.id;
    subjects := coalesce(subjects, '{}');
  end if;
  for found in
    select q.id, q.start_date, q.end_date from quarters q
    where q.branch_id = e.branch_id
      and q.start_date is not null
      and q.end_date >= from_day
      and (until_day is null or q.start_date <= until_day)
    order by q.id
    for key share
  loop
    if quarter_is_closed(found.id) then
      if not subjects_known and not e.all_subjects then
        if not exists (
          select 1 from quarter_reopenings r
          where r.quarter_id = found.id and r.journal_id is not null
            and r.ended_by_closing_id is null and r.open_until > class_tutors_moment()
        ) then
          raise exception 'quarters_closed'
            using errcode = 'check_violation', constraint = 'quarters_closed';
        end if;
      elsif not exemption_quarter_applies(
        found.id,
        e.student_id,
        case when e.all_subjects then null else subjects end,
        greatest(from_day, found.start_date),
        least(coalesce(until_day, found.end_date), found.end_date)
      ) then
        raise exception 'quarters_closed'
          using errcode = 'check_violation', constraint = 'quarters_closed';
      end if;
    end if;
  end loop;
end
$$;

-- 0133's guard of exemptions, with the closed days checked for the
-- exemption's journals. Same name; otherwise unchanged.
create or replace function exemptions_closed_quarter() returns trigger
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
        perform exemption_days_open_guard(new, false, new.start_date, new.end_date);
      end if;
      return new;
    end if;
    if (new.voided_at is null) <> (old.voided_at is null)
      or (new.kind, new.all_subjects, new.start_time, new.end_time)
        is distinct from (old.kind, old.all_subjects, old.start_time, old.end_time) then
      perform exemption_days_open_guard(
        new, true,
        least(old.start_date, new.start_date),
        greatest(old.end_date, new.end_date)
      );
      return new;
    end if;
    if new.start_date is distinct from old.start_date then
      perform exemption_days_open_guard(
        new, true,
        least(old.start_date, new.start_date),
        greatest(old.start_date, new.start_date) - 1
      );
    end if;
    if new.end_date is distinct from old.end_date then
      perform exemption_days_open_guard(
        new, true,
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

-- The subjects of a new exemption of some subjects: its closed days checked
-- again with its subjects known.
create function exemption_subjects_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  e exemptions;
begin
  select * into e from exemptions x where x.id = new.exemption_id;
  if e.voided_at is not null or e.all_subjects then
    return null;
  end if;
  begin
    perform exemption_days_open_guard(e, true, e.start_date, e.end_date);
  exception
    when check_violation then
      if sqlerrm = 'quarters_closed' then
        raise exception 'exemption_closed_quarter'
          using errcode = 'check_violation', constraint = 'exemption_closed_quarter';
      end if;
      raise;
  end;
  return null;
end
$$;

-- Deferred: after every subject row of the exemption is written.
create constraint trigger exemption_subjects_closed_quarter
  after insert on exemption_subjects
  deferrable initially deferred
  for each row execute function exemption_subjects_closed_quarter();

-- ---------------------------------------------------------------------------
-- The nightly check.

create table result_checks (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The branch date the check is of.
  day date not null,
  -- From the transaction's moment (the injected clock).
  started_at timestamptz not null,
  finished_at timestamptz,
  -- Counts only: journals, cells, records read; differences by kind.
  summary jsonb not null default '{}' constraint result_checks_summary_check check (
    jsonb_typeof(summary) = 'object'
  ),
  constraint result_checks_id_branch_key unique (id, branch_id)
);

create index result_checks_branch_idx on result_checks (branch_id, finished_at);

alter table result_checks enable row level security;
create policy branch_filter on result_checks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on result_checks to sodiq_app;
grant insert (branch_id, day, started_at) on result_checks to sodiq_app;
grant update (finished_at, summary) on result_checks to sodiq_app;

-- A run is finished once, at the transaction's moment, and nothing else changes.
create function result_checks_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    new.started_at := moment;
    new.finished_at := null;
    new.summary := '{}';
    return new;
  end if;
  if (new.id, new.branch_id, new.day, new.started_at)
    is distinct from (old.id, old.branch_id, old.day, old.started_at)
    or old.finished_at is not null then
    raise exception 'result_checks_finished'
      using errcode = 'check_violation', constraint = 'result_checks_finished';
  end if;
  new.finished_at := moment;
  return new;
end
$$;

create trigger result_checks_write
  before insert or update on result_checks
  for each row execute function result_checks_write();

create table result_check_differences (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  check_id uuid not null,
  quarter_id uuid not null,
  journal_id uuid not null,
  subject_id uuid,
  student_id uuid,
  kind text not null constraint result_check_differences_kind_check check (
    kind in (
      'cell_history', 'work_history', 'rating_history', 'refused',
      'stored_module', 'stored_entries', 'record_missing'
    )
  ),
  -- Ids, versions, paths and codes; no names and no values typed.
  detail jsonb not null constraint result_check_differences_detail_check check (
    jsonb_typeof(detail) = 'object'
  ),
  constraint result_check_differences_check_fkey foreign key (check_id, branch_id)
    references result_checks (id, branch_id),
  constraint result_check_differences_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint result_check_differences_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id)
);

create index result_check_differences_check_idx on result_check_differences (check_id);
create index result_check_differences_journal_idx on result_check_differences (journal_id);
create index result_check_differences_student_idx on result_check_differences (student_id);

alter table result_check_differences enable row level security;
create policy branch_filter on result_check_differences for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on result_check_differences to sodiq_app;
grant insert (branch_id, check_id, quarter_id, journal_id, subject_id, student_id, kind, detail)
  on result_check_differences to sodiq_app;

-- A difference only into a run still going.
create function result_check_differences_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from result_checks c where c.id = new.check_id and c.finished_at is null
  ) then
    raise exception 'result_checks_finished'
      using errcode = 'check_violation', constraint = 'result_checks_finished';
  end if;
  return new;
end
$$;

create trigger result_check_differences_write
  before insert on result_check_differences
  for each row execute function result_check_differences_write();

-- ---------------------------------------------------------------------------
-- The daily schedule (plan decision 9): each kind of daily work enqueued once
-- per branch and branch date, in the transaction that enqueues it.

create table scheduled_runs (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  kind text not null constraint scheduled_runs_kind_check check (
    kind in (
      'results.check', 'results.closing_overdue', 'results.check_missed', 'plans.reminders',
      'journal.about_to_lock', 'timetable.forced_delete_purge'
    )
  ),
  day date not null,
  -- From the transaction's moment.
  enqueued_at timestamptz not null,
  constraint scheduled_runs_key unique (branch_id, kind, day)
);

alter table scheduled_runs enable row level security;
create policy branch_filter on scheduled_runs for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on scheduled_runs to sodiq_app;
grant insert (branch_id, kind, day, enqueued_at) on scheduled_runs to sodiq_app;

create function scheduled_runs_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  new.enqueued_at := moment;
  return new;
end
$$;

create trigger scheduled_runs_write
  before insert on scheduled_runs
  for each row execute function scheduled_runs_write();

-- "Lesson about to lock with data missing" once per lesson and person (`10`;
-- plan decision 16).
create table lesson_lock_notices (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  lesson_id uuid not null,
  account_id uuid not null references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_lock_notices_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  constraint lesson_lock_notices_key unique (branch_id, lesson_id, account_id)
);

create index lesson_lock_notices_account_idx on lesson_lock_notices (account_id);

alter table lesson_lock_notices enable row level security;
create policy branch_filter on lesson_lock_notices for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_lock_notices to sodiq_app;
grant insert (branch_id, lesson_id, account_id) on lesson_lock_notices to sodiq_app;

-- ---------------------------------------------------------------------------
-- The forced delete's purge (From 5.8b; plan decision 18).

alter table forced_deletes add column purged_at timestamptz;

grant update (rows, purged_at) on forced_deletes to sodiq_app;

-- Only the purge writes them: `purged_at` from null to the moment, after the
-- restore time, of a row not restored, and `rows` emptied with it.
create function forced_deletes_purge() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  -- The migrator's fixtures (tests) are not the application.
  if session_user <> 'sodiq_app'
    or (new.rows, new.purged_at) is not distinct from (old.rows, old.purged_at) then
    return new;
  end if;
  moment := class_tutors_moment();
  if moment is null
    or old.purged_at is not null
    or old.restored_at is not null
    or new.restored_at is not null
    or old.restore_until > moment
    or new.purged_at is distinct from moment
    or new.rows <> '{}'::jsonb then
    raise exception 'forced_deletes_purge'
      using errcode = 'check_violation', constraint = 'forced_deletes_purge';
  end if;
  return new;
end
$$;

create trigger forced_deletes_purge
  before update on forced_deletes
  for each row execute function forced_deletes_purge();

-- ---------------------------------------------------------------------------
-- pg-boss's schedule (plan decision 9; 0.5b kept `schedule` off "until the
-- nightly check, 9.2c"): the worker stores the cron row of `schedule.tick`
-- (an insert that updates the row when it exists) and the cron pass reads
-- it and records the job it sent; `pgboss.version.cron_on` is already
-- writable. No delete: no schedule is removed by the application.
grant select, insert, update on pgboss.schedule to sodiq_app;
