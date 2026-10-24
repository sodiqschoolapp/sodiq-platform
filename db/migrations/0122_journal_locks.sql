-- 0122 The edit period, unlocks and corrections of the journal (task 8.4,
-- pull request #222).
--
-- docs/spec/07-journal.md, Editing rules and locks: "A teacher can enter and
-- change data for a lesson for a number of days after it (the edit days, a
-- branch setting). After that the lesson is locked." "To change a locked
-- lesson the teacher sends an unlock request." docs/spec/edge-cases/
-- 00-definitions.md, Lock moment: "23:59 branch time on the lesson's date
-- plus the edit days. Fixed per lesson; changing the setting affects only
-- lessons dated after the change." docs/spec/edge-cases/journal.md, Locks,
-- unlocks and corrections: "The teacher sends an unlock request ... approves
-- and sets 1 to 7 days. The unlock covers that lesson and that person only.
-- Entries made under it are marked 'entered after the edit period' with the
-- approver's name." "The Academic Vice Principal corrects a mark ... needs a
-- reason ... notifies the teacher with the old and new value. No unlock is
-- needed." docs/spec/edge-cases/system-behaviour.md: "extends the edit
-- period for a date range for the whole branch in one logged action".
-- docs/spec/edge-cases/developer-rules.md, Time-based state: compared with
-- the clock on each request, flipped by no job.
--
-- The plan approved on pull request #222 with corrections 1 to 5. Build
-- decision 15 (Look first): the lock moment is worked out on each request by
-- `journal_lock_moment` from the log of the edit days and the extensions,
-- never stored on `lessons`: an update of `lessons` runs `lessons_claims`
-- and `lesson_block_claims` for every row (group locks, the claims written
-- again), so a re-store of a year's lessons on a change of the edit days
-- would take the timetable's locks lesson by lesson. The log fixes the lock
-- per lesson all the same ("changing the setting affects only lessons dated
-- after the change"), and a moved lesson takes the lock of its new date.

-- ---------------------------------------------------------------------------
-- The edit days in force for a date: a log of every change of
-- `branch_settings.edit_days`, written only by the trigger on that table
-- (decision 2). A lesson dated D takes the newest row changed before D; the
-- first row of a branch (`-infinity`) holds the value it started with. Two
-- changes on one day leave the last one.

create table branch_edit_days (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The branch day of the change; `-infinity` for the value a branch started with.
  changed_on date not null,
  -- The setting is 1 to 30 (branch_settings); a fixture of the migrator may
  -- write a longer period to keep its lessons open.
  edit_days smallint not null constraint branch_edit_days_edit_days_check check (edit_days >= 1),
  -- The transaction's moment (the injected clock); null for the first row.
  changed_at timestamptz,
  constraint branch_edit_days_day_key unique (branch_id, changed_on)
);

alter table branch_edit_days enable row level security;
create policy branch_filter on branch_edit_days for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

insert into branch_edit_days (branch_id, changed_on, edit_days)
  select s.branch_id, '-infinity', s.edit_days from branch_settings s;

-- The trigger runs as the writer; a direct write of the application is
-- refused (the depth guard of 0058, for the application only: a fixture of
-- the migrator sets the edit days of its test branch here). No delete.
grant select, insert on branch_edit_days to sodiq_app;
grant update (edit_days, changed_at) on branch_edit_days to sodiq_app;

create function branch_edit_days_direct() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() <= 1 and session_user = 'sodiq_app' then
    raise exception 'branch_edit_days_direct'
      using errcode = 'check_violation', constraint = 'branch_edit_days_direct';
  end if;
  return new;
end;
$$;

create trigger branch_edit_days_direct
  before insert or update on branch_edit_days
  for each row execute function branch_edit_days_direct();

create function branch_settings_edit_days_log() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  day date;
begin
  if tg_op = 'INSERT' then
    insert into branch_edit_days (branch_id, changed_on, edit_days)
      values (new.branch_id, '-infinity', new.edit_days)
      on conflict (branch_id, changed_on) do nothing;
    return null;
  end if;
  if new.edit_days = old.edit_days then
    return null;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    if session_user = 'sodiq_app' then
      raise exception 'journal_cell_moment'
        using errcode = 'check_violation', constraint = 'journal_cell_moment';
    end if;
    -- A change by the migrator outside a request (a data fix).
    moment := now();
  end if;
  select (moment at time zone b.time_zone)::date into day
    from branches b where b.id = new.branch_id;
  insert into branch_edit_days (branch_id, changed_on, edit_days, changed_at)
    values (new.branch_id, day, new.edit_days, moment)
    on conflict (branch_id, changed_on)
      do update set edit_days = excluded.edit_days, changed_at = excluded.changed_at;
  return null;
end;
$$;

create trigger branch_settings_edit_days_log
  after insert or update of edit_days on branch_settings
  for each row execute function branch_settings_edit_days_log();

-- ---------------------------------------------------------------------------
-- The branch-wide extension (decision 13): the Academic Vice Principal
-- lengthens the edit period of every lesson in a date range ending today or
-- earlier, by 1 to 7 days from the day of the action. Never changed or
-- removed; a lock never moves earlier.

create table journal_edit_extensions (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  from_date date not null,
  to_date date not null,
  days smallint not null constraint journal_edit_extensions_days_check check (days between 1 and 7),
  -- 00:00 of the branch day after the action's day plus the days (decision 4),
  -- written by the trigger below from the transaction's moment.
  open_until timestamptz not null,
  reason text not null constraint journal_edit_extensions_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  created_by uuid not null references accounts (id),
  -- The transaction's moment (the injected clock), by the trigger.
  created_at timestamptz not null,
  constraint journal_edit_extensions_range_check check (from_date <= to_date)
);

create index journal_edit_extensions_range_idx
  on journal_edit_extensions (branch_id, from_date, to_date);

alter table journal_edit_extensions enable row level security;
create policy branch_filter on journal_edit_extensions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_edit_extensions to sodiq_app;
grant insert (id, branch_id, from_date, to_date, days, open_until, reason, created_by, created_at)
  on journal_edit_extensions to sodiq_app;

create function journal_edit_extensions_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  zone text;
  today date;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  select b.time_zone into zone from branches b where b.id = new.branch_id;
  today := (moment at time zone zone)::date;
  if new.to_date > today then
    raise exception 'journal_extension_future'
      using errcode = 'check_violation', constraint = 'journal_extension_future';
  end if;
  new.created_at := moment;
  new.open_until := ((today + new.days + 1)::timestamp at time zone zone);
  return new;
end;
$$;

create trigger journal_edit_extensions_write
  before insert on journal_edit_extensions
  for each row execute function journal_edit_extensions_write();

-- ---------------------------------------------------------------------------
-- The lock moment of a day of a branch (decision 1): 00:00 of the branch day
-- after the day plus the edit days in force for that day, so 23:59 of the
-- last day is still open; never earlier than an extension whose range holds
-- the day. Run as the invoker: both tables are read through the branch filter.

create function journal_lock_moment(branch_ref uuid, day date) returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select greatest(
    (
      (day + (
        select d.edit_days from branch_edit_days d
        where d.branch_id = branch_ref and d.changed_on < day
        order by d.changed_on desc
        limit 1
      ) + 1)::timestamp at time zone b.time_zone
    ),
    (
      select max(x.open_until) from journal_edit_extensions x
      where x.branch_id = branch_ref and x.from_date <= day and day <= x.to_date
    )
  )
  from branches b
  where b.id = branch_ref and day is not null
$$;

-- The lock of a lesson, from its date.
create function journal_lesson_lock(lesson_ref uuid) returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select journal_lock_moment(l.branch_id, l.lesson_date) from lessons l where l.id = lesson_ref
$$;

-- The lock of a journal's rating exam in a quarter, from the date in force
-- (decision 2): null while the exam has no date.
create function journal_rating_lock(journal_ref uuid, quarter_ref uuid) returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select journal_lock_moment(j.branch_id, journal_rating_date(journal_ref, quarter_ref))
  from journals j
  where j.id = journal_ref
$$;

grant execute on function journal_lock_moment(uuid, date) to sodiq_app;
grant execute on function journal_lesson_lock(uuid) to sodiq_app;
grant execute on function journal_rating_lock(uuid, uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- Unlock requests (decisions 4, 7 and 8): one person, one lesson or one
-- rating exam of a journal and quarter. Never deleted by the application;
-- they go with a lesson removed by a forced delete.

create table journal_unlocks (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  target text not null constraint journal_unlocks_target_check check (target in ('lesson', 'rating')),
  lesson_id uuid,
  journal_id uuid,
  quarter_id uuid,
  -- The person the unlock covers: the requester's staff record.
  staff_id uuid not null references staff (id),
  requested_by uuid not null references accounts (id),
  reason text not null constraint journal_unlocks_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  -- The transaction's moment of the request (the injected clock), by the trigger.
  requested_at timestamptz not null,
  status text not null constraint journal_unlocks_status_check check (
    status in ('sent', 'approved', 'refused', 'withdrawn')
  ),
  days smallint constraint journal_unlocks_days_check check (days between 1 and 7),
  -- 00:00 of the branch day after the decision day plus the days (decision 4).
  open_until timestamptz,
  decided_by uuid references accounts (id),
  decided_at timestamptz,
  refuse_reason text constraint journal_unlocks_refuse_reason_check check (
    length(btrim(refuse_reason)) between 1 and 500
  ),
  -- Written by journal_unlocks_write: 1 on insert, one more on every update.
  version integer not null,
  constraint journal_unlocks_keys_check check (
    case target
      when 'lesson' then lesson_id is not null and journal_id is null and quarter_id is null
      else lesson_id is null and journal_id is not null and quarter_id is not null
    end
  ),
  constraint journal_unlocks_decision_check check (
    case status
      when 'sent' then days is null and open_until is null and decided_by is null
        and decided_at is null and refuse_reason is null
      when 'approved' then days is not null and open_until is not null and decided_by is not null
        and decided_at is not null and refuse_reason is null
      when 'refused' then days is null and open_until is null and decided_by is not null
        and decided_at is not null
      else days is null and open_until is null and decided_by is null and decided_at is not null
        and refuse_reason is null
    end
  ),
  constraint journal_unlocks_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  constraint journal_unlocks_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint journal_unlocks_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id)
);

-- One waiting request of a person per lesson, and per rating exam.
create unique index journal_unlocks_lesson_waiting_key
  on journal_unlocks (branch_id, lesson_id, staff_id)
  where status = 'sent' and target = 'lesson';
create unique index journal_unlocks_rating_waiting_key
  on journal_unlocks (branch_id, journal_id, quarter_id, staff_id)
  where status = 'sent' and target = 'rating';
create index journal_unlocks_lesson_idx on journal_unlocks (lesson_id) where lesson_id is not null;
create index journal_unlocks_journal_idx on journal_unlocks (journal_id, quarter_id)
  where journal_id is not null;
create index journal_unlocks_branch_idx on journal_unlocks (branch_id, status, requested_at);

alter table journal_unlocks enable row level security;
create policy branch_filter on journal_unlocks for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_unlocks to sodiq_app;
grant insert (id, branch_id, target, lesson_id, journal_id, quarter_id, staff_id, requested_by,
  reason, requested_at, status, version) on journal_unlocks to sodiq_app;
grant update (status, days, decided_by, refuse_reason) on journal_unlocks to sodiq_app;

-- The moments, the version, the requester and the one way of a decision:
-- `sent` to `approved`, `refused` or `withdrawn`, once, never decided by the requester.
create function journal_unlocks_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  zone text;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'sent' or not exists (
      select 1 from staff s where s.id = new.staff_id and s.account_id = new.requested_by
    ) then
      raise exception 'journal_unlock_write'
        using errcode = 'check_violation', constraint = 'journal_unlock_write';
    end if;
    new.version := 1;
    new.requested_at := moment;
    return new;
  end if;
  if old.status <> 'sent' or new.status = 'sent' then
    raise exception 'journal_unlock_decided'
      using errcode = 'check_violation', constraint = 'journal_unlock_decided';
  end if;
  -- Nobody approves their own (`02`, Own requests; permission review should-fix 1).
  if new.decided_by = old.requested_by then
    raise exception 'journal_unlock_own'
      using errcode = 'check_violation', constraint = 'journal_unlock_own';
  end if;
  new.version := old.version + 1;
  new.decided_at := moment;
  if new.status = 'approved' then
    select b.time_zone into zone from branches b where b.id = new.branch_id;
    new.open_until := ((((moment at time zone zone)::date) + new.days + 1)::timestamp at time zone zone);
  else
    new.open_until := null;
  end if;
  return new;
end;
$$;

create trigger journal_unlocks_write
  before insert or update on journal_unlocks
  for each row execute function journal_unlocks_write();

-- Whether an approved unlock open at the moment covers the account's person
-- and the target (the lesson, or the journal and quarter of a rating exam).
-- The unlock row is read FOR SHARE: a decision held open makes the entry wait.
create function journal_unlock_covers(
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
    end;
end;
$$;

-- Whether the account holds, at the moment, the post that corrects in the
-- branch: the Academic Vice Principal of the branch or the Super Admin
-- (`edge/journal`; `02`, Super Admin: "every other action of the Academic
-- Vice Principal"). `assignments` has no row policy.
create function journal_corrector(account_ref uuid, branch_ref uuid, moment timestamptz)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from assignments a
    where a.account_id = account_ref
      and a.valid_from <= moment
      and (a.valid_until is null or moment < a.valid_until)
      and (
        (a.role = 'super_admin' and a.branch_id is null)
        or (a.role = 'academic_vice_principal' and a.branch_id = branch_ref)
      )
  )
$$;

grant execute on function journal_unlock_covers(uuid, uuid, uuid, uuid, uuid, timestamptz) to sodiq_app;
grant execute on function journal_corrector(uuid, uuid, timestamptz) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The kinds of a work and of a comment written past the lock (decision 3).

alter table journal_works drop constraint journal_works_changed_how_check;
alter table journal_works add constraint journal_works_changed_how_check check (
  changed_how in (
    'entry', 'not_held', 'carry', 'move', 'takeover', 'separation', 'restored', 'deleted',
    'late_entry', 'correction'
  )
);

alter table journal_work_history drop constraint journal_work_history_changed_how_check;
alter table journal_work_history add constraint journal_work_history_changed_how_check check (
  changed_how in (
    'entry', 'not_held', 'carry', 'move', 'takeover', 'separation', 'restored', 'deleted',
    'forced_delete', 'late_entry', 'correction'
  )
);

alter table journal_comments drop constraint journal_comments_changed_how_check;
alter table journal_comments add constraint journal_comments_changed_how_check check (
  changed_how in ('entry', 'restored', 'late_entry', 'correction')
);

alter table journal_comment_history drop constraint journal_comment_history_changed_how_check;
alter table journal_comment_history add constraint journal_comment_history_changed_how_check check (
  changed_how in ('entry', 'restored', 'forced_delete', 'late_entry', 'correction')
);

-- ---------------------------------------------------------------------------
-- The guard of the edit period (decision 3). A write of a person (`entry`,
-- `offline_entry`, `not_held`, `carry`, `deleted`, `undo`, and `late_entry`
-- or `correction` written as such) is judged against the lock of its lesson
-- or rating exam and the transaction's moment (the injected clock):
--
-- - a correction (a non-empty reason, `app.correction_reason`; for a rating
--   entry its own reason, correction 2) by the Academic Vice Principal of the
--   branch or the Super Admin passes at any moment and is written
--   `correction` (a delete stays `deleted`);
-- - before the lock every write passes as it came;
-- - from the lock it passes only under the approved unlock named by
--   `app.unlock_id` that covers that target and the writer's person and is
--   still open; `entry`, `offline_entry`, `not_held` and `carry` are then
--   written `late_entry`, `undo` and `deleted` stay; otherwise it is refused
--   `journal_locked`.
--
-- The writes of the system (`exemption`, `transfer`, `cancellation`, `move`,
-- `takeover`, `separation`, `restored`) pass: they follow a timetable, plan
-- or exemption change, not an entry. Without the moment the application is
-- refused; the migrator (a data fix, a fixture) passes.

create function journal_edit_judge(
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
  ) then
    raise exception 'journal_locked'
      using errcode = 'check_violation', constraint = 'journal_locked';
  end if;
  return case when how in ('entry', 'offline_entry', 'not_held', 'carry') then 'late_entry' else how end;
end;
$$;

-- The correction's reason of the transaction (the cells, works and comments).
create function journal_correction_reason() returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select nullif(current_setting('app.correction_reason', true), '')
$$;

create function journal_cells_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    -- Only the clearing of an empty lesson and the works triggers delete a cell (0108, 0119).
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  new.changed_how := journal_edit_judge(
    new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, null, null
  );
  return new;
end;
$$;

create trigger journal_cells_edit_guard
  before insert or update or delete on journal_cells
  for each row execute function journal_cells_edit_guard();

-- A work is judged at its own lesson (the check lesson for a homework, where
-- its column and cells are; spec review should-fix 3), and a person's move to
-- another lesson at both; a delete of a work by the application as its
-- `deleted` line (spec review must-fix 2).
create function journal_works_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or forced_delete_names('lesson', old.lesson_id) then
      return old;
    end if;
    perform journal_edit_judge(
      old.branch_id, journal_lesson_lock(old.lesson_id), 'deleted', old.changed_by,
      journal_correction_reason(), old.lesson_id, null, null
    );
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.lesson_id is distinct from old.lesson_id then
    perform journal_edit_judge(
      old.branch_id, journal_lesson_lock(old.lesson_id), new.changed_how, new.changed_by,
      journal_correction_reason(), old.lesson_id, null, null
    );
  end if;
  new.changed_how := journal_edit_judge(
    new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, null, null
  );
  return new;
end;
$$;

create trigger journal_works_edit_guard
  before insert or update or delete on journal_works
  for each row execute function journal_works_edit_guard();

-- A comment is judged at the lock of its target: its lesson, or the rating
-- exam of a rating entry's comment. A move of the work's lesson (on update
-- cascade) and a write that changes nothing pass (`database.md`).
create function journal_comments_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_row journal_rating_exams;
begin
  if tg_op = 'DELETE' then
    -- Only a forced delete of the lesson removes a comment (0120).
    return old;
  end if;
  if tg_op = 'INSERT' and new.changed_how = 'restored' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.body is not distinct from old.body
    and new.visibility = old.visibility then
    return new;
  end if;
  if new.rating_exam_id is not null then
    select * into exam_row from journal_rating_exams x where x.id = new.rating_exam_id;
    new.changed_how := journal_edit_judge(
      new.branch_id, journal_rating_lock(exam_row.journal_id, exam_row.quarter_id),
      new.changed_how, new.changed_by, journal_correction_reason(), null,
      exam_row.journal_id, exam_row.quarter_id
    );
  else
    new.changed_how := journal_edit_judge(
      new.branch_id, journal_lesson_lock(new.lesson_id), new.changed_how, new.changed_by,
      journal_correction_reason(), new.lesson_id, null, null
    );
  end if;
  return new;
end;
$$;

create trigger journal_comments_edit_guard
  before insert or update or delete on journal_comments
  for each row execute function journal_comments_edit_guard();

-- A rating entry is judged at the lock of its exam's date in force; a
-- correction carries the entry's own reason (correction 2). "Exempt", set or
-- taken back by the Academic Vice Principal (or the Super Admin), needs no
-- correction (decision 6).
create function journal_rating_entries_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_row journal_rating_exams;
  moment timestamptz;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  select * into exam_row from journal_rating_exams x where x.id = new.rating_exam_id;
  moment := class_tutors_moment();
  if new.changed_how <> 'correction' and moment is not null
    and (new.kind is not distinct from 'exempt' or (tg_op = 'UPDATE' and old.kind is not distinct from 'exempt'))
    and journal_corrector(new.changed_by, new.branch_id, moment) then
    return new;
  end if;
  new.changed_how := journal_edit_judge(
    new.branch_id, journal_rating_lock(exam_row.journal_id, exam_row.quarter_id),
    new.changed_how, new.changed_by,
    case when new.changed_how = 'correction' then coalesce(new.reason, '') else '' end,
    null, exam_row.journal_id, exam_row.quarter_id
  );
  return new;
end;
$$;

create trigger journal_rating_entries_edit_guard
  before insert or update or delete on journal_rating_entries
  for each row execute function journal_rating_entries_edit_guard();

-- The exam's hand date and "not held" (decision 6 as the review changed it):
-- from the lock of the date in force, only the Academic Vice Principal (or
-- the Super Admin) changes them; anyone else is refused `journal_locked`.
-- An unlock covers entries, not the exam's own settings.
create function journal_rating_exams_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  lock_at timestamptz;
begin
  if new.exam_date is not distinct from old.exam_date and new.not_held = old.not_held then
    return new;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    if session_user = 'sodiq_app' then
      raise exception 'journal_cell_moment'
        using errcode = 'check_violation', constraint = 'journal_cell_moment';
    end if;
    return new;
  end if;
  lock_at := journal_rating_lock(old.journal_id, old.quarter_id);
  if lock_at is not null and moment >= lock_at
    and not journal_corrector(new.changed_by, new.branch_id, moment) then
    raise exception 'journal_locked'
      using errcode = 'check_violation', constraint = 'journal_locked';
  end if;
  return new;
end;
$$;

create trigger journal_rating_exams_edit_guard
  before update on journal_rating_exams
  for each row execute function journal_rating_exams_edit_guard();

-- ---------------------------------------------------------------------------
-- The histories keep the reason of a correction and the unlock of a write
-- made under one (the approver's name is read through it). Same names and
-- signatures as 0108, 0119 and 0120; bodies otherwise unchanged.

alter table journal_cell_history
  add column reason text,
  add column unlock_id uuid;
alter table journal_work_history
  add column reason text,
  add column unlock_id uuid;
alter table journal_comment_history
  add column reason text,
  add column unlock_id uuid;
alter table journal_rating_history
  add column unlock_id uuid;

-- The reason of a correction line and the unlock of a line of a person, from
-- the settings of the transaction.
create function journal_line_reason(how text) returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when how in ('correction', 'deleted') then journal_correction_reason()
  end
$$;

create function journal_line_unlock(how text) returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when how in ('late_entry', 'undo', 'deleted') then
      nullif(current_setting('app.unlock_id', true), '')::uuid
  end
$$;

grant execute on function journal_line_reason(text) to sodiq_app;
grant execute on function journal_line_unlock(text) to sodiq_app;
grant execute on function journal_correction_reason() to sodiq_app;

create or replace function journal_cells_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_before, mark_after, score_before, score_after, changed_by, changed_how, changed_at,
      reason, unlock_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      old.mark, new.mark, old.score, new.score, new.changed_by, new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how)
    );
  else
    insert into journal_cell_history (
      branch_id, cell_id, lesson_id, student_id, work_id, version,
      mark_after, score_after, changed_by, changed_how, changed_at, reason, unlock_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.student_id, new.work_id, new.version,
      new.mark, new.score, new.changed_by, new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how)
    );
  end if;
  return null;
end;
$$;

create or replace function journal_works_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  author uuid;
begin
  if tg_op = 'INSERT' then
    if new.changed_how = 'restored' or forced_restore_names('lesson', new.lesson_id) then
      insert into journal_work_history (
        branch_id, work_id, lesson_id, source_lesson_id, kind, version, total_after,
        not_held_after, carried_from_after, plan_work_after, changed_by, changed_how, changed_at
      ) values (
        new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
        new.total, new.not_held, new.carried_from_lesson_id, new.plan_work_id, new.changed_by,
        'restored', coalesce(class_tutors_moment(), new.changed_at)
      );
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.total is not distinct from old.total
      and new.not_held = old.not_held
      and new.lesson_id = old.lesson_id
      and new.carried_from_lesson_id is not distinct from old.carried_from_lesson_id
      and new.plan_work_id is not distinct from old.plan_work_id then
      return null;
    end if;
    insert into journal_work_history (
      branch_id, work_id, lesson_id, source_lesson_id, kind, version,
      total_before, total_after, not_held_before, not_held_after, lesson_before,
      carried_from_after, plan_work_before, plan_work_after, changed_by, changed_how, changed_at,
      reason, unlock_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
      old.total, new.total, old.not_held, new.not_held,
      case when new.lesson_id <> old.lesson_id then old.lesson_id end,
      new.carried_from_lesson_id, old.plan_work_id, new.plan_work_id, new.changed_by,
      new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how)
    );
    return null;
  end if;
  moment := class_tutors_moment();
  select f.deleted_by into author from forced_deletes f
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
    limit 1;
  if author is null and pg_trigger_depth() > 1 and old.total is null and not old.not_held then
    return null;
  end if;
  if moment is null then
    if session_user <> 'sodiq_app' then
      return null;
    end if;
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  insert into journal_work_history (
    branch_id, work_id, lesson_id, source_lesson_id, kind, version,
    total_before, not_held_before, plan_work_before, changed_by, changed_how, changed_at,
    reason, unlock_id
  ) values (
    old.branch_id, old.id, old.lesson_id, old.source_lesson_id, old.kind, old.version + 1,
    old.total, old.not_held, old.plan_work_id, coalesce(author, old.changed_by),
    case when author is null then 'deleted' else 'forced_delete' end, moment,
    case when author is null then journal_line_reason('deleted') end,
    case when author is null then journal_line_unlock('deleted') end
  );
  return null;
end;
$$;

create or replace function journal_comments_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  author uuid;
  moment timestamptz;
begin
  if tg_op = 'DELETE' then
    select f.deleted_by into author from forced_deletes f
      where f.created_xact = pg_current_xact_id()
        and f.record_type = 'lesson'
        and f.record_id = old.lesson_id
      limit 1;
    moment := class_tutors_moment();
    if moment is null then
      raise exception 'journal_cell_moment'
        using errcode = 'check_violation', constraint = 'journal_cell_moment';
    end if;
    insert into journal_comment_history (
      branch_id, comment_id, student_id, target, lesson_id, work_id, rating_exam_id, version,
      body_before, visibility_before, changed_by, changed_how, changed_at
    ) values (
      old.branch_id, old.id, old.student_id, old.target, old.lesson_id, old.work_id,
      old.rating_exam_id, old.version + 1, old.body, old.visibility, author, 'forced_delete', moment
    );
    return null;
  end if;
  if tg_op = 'UPDATE' and new.version = old.version then
    return null;
  end if;
  insert into journal_comment_history (
    branch_id, comment_id, student_id, target, lesson_id, work_id, rating_exam_id, version,
    body_before, body_after, visibility_before, visibility_after, changed_by, changed_how, changed_at,
    reason, unlock_id
  ) values (
    new.branch_id, new.id, new.student_id, new.target, new.lesson_id, new.work_id,
    new.rating_exam_id, new.version,
    case when tg_op = 'UPDATE' then old.body end, new.body,
    case when tg_op = 'UPDATE' then old.visibility end, new.visibility,
    new.changed_by, new.changed_how, coalesce(class_tutors_moment(), new.changed_at),
    journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how)
  );
  return null;
end;
$$;

create or replace function journal_rating_entries_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_row journal_rating_exams;
begin
  select * into exam_row from journal_rating_exams x where x.id = new.rating_exam_id;
  insert into journal_rating_history (
    branch_id, rating_exam_id, journal_id, quarter_id, student_id, entry_id, version,
    kind_before, kind_after, score_before, score_after, reason, changed_by, changed_how, changed_at,
    unlock_id
  ) values (
    new.branch_id, new.rating_exam_id, exam_row.journal_id, exam_row.quarter_id, new.student_id,
    new.id, new.version,
    case when tg_op = 'UPDATE' then old.kind end, new.kind,
    case when tg_op = 'UPDATE' then old.score end, new.score,
    nullif(current_setting('app.rating_reason', true), ''), new.changed_by, new.changed_how,
    new.changed_at, journal_line_unlock(new.changed_how)
  );
  return null;
end;
$$;
