-- 0131 Journal exports and the support view (task 8.9, pull request #227).
--
-- docs/spec/edge-cases/system-behaviour.md: "A large export is a background
-- job, one per user, taken from one consistent moment and stamped with date
-- and 'provisional' or 'final'. The link works for 24 hours and access is
-- checked again at download." docs/spec/edge-cases/journal.md, "My grade
-- disappeared": "A support view for one student, journal and date shows
-- every save, every refusal and every such event in order".
--
-- The plan approved on pull request #227: decisions 4, 6, 7 and 11, and the
-- spec review of the plan (must-fix 2 and 3).

-- ---------------------------------------------------------------------------
-- The refusals of saves (decision 7): one row per student of a refused save
-- of attendance, numbers or a rating entry, written by the application in a
-- transaction of its own after the refused one rolled back. Append-only and
-- partitioned by month, as the histories (0108, 0119; edge/developer-rules,
-- History and audit). No key: the refusal outlives the lesson, the work and
-- the cell, and never blocks a forced delete.

create table journal_save_refusals (
  id uuid not null default uuidv7(),
  branch_id uuid not null references branches (id),
  journal_id uuid not null,
  -- The lesson of an attendance or a number; null for a rating entry.
  lesson_id uuid,
  -- The quarter of a rating entry; null otherwise.
  quarter_id uuid,
  student_id uuid not null,
  -- The work of a number, null for a planned column with no work stored yet; null for
  -- attendance and a rating entry.
  work_id uuid,
  -- The plan's work of a planned column with no work stored yet.
  plan_work_id uuid,
  kind text not null constraint journal_save_refusals_kind_check check (
    kind in ('attendance', 'score', 'rating')
  ),
  -- What was sent: the mark, the number or the score; null for a clear.
  value_sent integer,
  -- The kind of a rating entry sent (score, did_not_sit, exempt); null otherwise.
  entry_kind text constraint journal_save_refusals_entry_kind_check check (
    entry_kind in ('score', 'did_not_sit', 'exempt')
  ),
  -- The version the save was based on; null for a first save.
  version_sent integer,
  -- The code of the refusal the route answered.
  code text not null constraint journal_save_refusals_code_check check (
    code ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  account_id uuid not null,
  -- The transaction's moment (the injected clock).
  refused_at timestamptz not null,
  request_id text,
  constraint journal_save_refusals_shape_check check (
    (kind = 'rating' and lesson_id is null and quarter_id is not null and work_id is null
      and plan_work_id is null)
    or (kind = 'attendance' and lesson_id is not null and quarter_id is null and work_id is null
      and plan_work_id is null and entry_kind is null)
    or (kind = 'score' and lesson_id is not null and quarter_id is null
      and num_nonnulls(work_id, plan_work_id) = 1 and entry_kind is null)
  ),
  primary key (id, refused_at)
) partition by range (refused_at);

create index journal_save_refusals_student_idx
  on journal_save_refusals (branch_id, student_id, journal_id);
create index journal_save_refusals_branch_idx on journal_save_refusals (branch_id, refused_at);

alter table journal_save_refusals enable row level security;
create policy branch_filter on journal_save_refusals for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

do $$
declare
  month date;
  suffix text;
  partition name;
begin
  for month in
    select generate_series(date '2026-10-01', date '2029-12-01', interval '1 month')::date
  loop
    suffix := to_char(month, 'YYYY_MM');
    execute format(
      'create table public.%I partition of public.journal_save_refusals for values from (%L) to (%L)',
      'journal_save_refusals_' || suffix,
      to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  end loop;

  create table public.journal_save_refusals_default
    partition of public.journal_save_refusals default;

  for partition in
    select c.relname
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.journal_save_refusals'::regclass
  loop
    execute format('alter table public.%I enable row level security', partition);
    execute format(
      'create policy branch_filter on public.%I for all to sodiq_app
         using (branch_id = any ((select public.app_branch_ids())::uuid[]))
         with check (branch_id = any ((select public.app_branch_ids())::uuid[]))',
      partition
    );
  end loop;
end
$$;

-- Append-only: no update or delete.
grant select, insert on journal_save_refusals to sodiq_app;

-- The moment of a refusal is the transaction's, never another one: a row whose moment
-- differs is refused (a BEFORE trigger cannot move a row to another partition by changing
-- its key, so it checks rather than writes).
create function journal_save_refusals_write() returns trigger
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
  if new.refused_at is distinct from moment then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  return new;
end
$$;

create trigger journal_save_refusals_write
  before insert on journal_save_refusals
  for each row execute function journal_save_refusals_write();

-- ---------------------------------------------------------------------------
-- The branch exports (decisions 4, 6 and 11): one row per request, moved by
-- the job from queued to ready or failed, and by the next request from a
-- stale queued row to failed. The moments are the transaction's; the link
-- works until `expires_at`, compared with the clock on each request.

create table journal_exports (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  account_id uuid not null references accounts (id),
  -- The assignment that allowed the request.
  assignment_id uuid not null references assignments (id),
  quarter_id uuid not null,
  -- The first day of the month exported; null for the whole quarter.
  month date constraint journal_exports_month_check check (
    month is null or extract(day from month) = 1
  ),
  format text not null constraint journal_exports_format_check check (format in ('xlsx', 'pdf')),
  language text not null constraint journal_exports_language_check check (
    language in ('uz', 'ru', 'en')
  ),
  status text not null default 'queued' constraint journal_exports_status_check check (
    status in ('queued', 'ready', 'failed')
  ),
  -- The transaction's moments (the injected clock), by the trigger.
  requested_at timestamptz not null,
  -- The moment of the one snapshot the file was read from.
  as_of timestamptz,
  ready_at timestamptz,
  expires_at timestamptz,
  file_key text,
  journals integer constraint journal_exports_journals_check check (journals >= 0),
  rows integer constraint journal_exports_rows_check check (rows >= 0),
  failed_at timestamptz,
  failure text constraint journal_exports_failure_check check (
    failure ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  constraint journal_exports_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  -- The columns of each status (decision 6).
  constraint journal_exports_queued_check check (
    status <> 'queued' or (
      as_of is null and ready_at is null and expires_at is null and file_key is null
      and journals is null and rows is null and failed_at is null and failure is null
    )
  ),
  constraint journal_exports_ready_check check (
    status <> 'ready' or (
      as_of is not null and ready_at is not null and expires_at is not null
      and file_key is not null and journals is not null and rows is not null
      and failed_at is null and failure is null
      and as_of >= requested_at and as_of <= ready_at
      and expires_at = ready_at + interval '24 hours'
    )
  ),
  constraint journal_exports_failed_check check (
    status <> 'failed' or (
      failed_at is not null and failure is not null
      and as_of is null and ready_at is null and expires_at is null and file_key is null
    )
  )
);

-- "One per user" (decision 6): one queued export per person in a branch.
create unique index journal_exports_queued_key
  on journal_exports (account_id, branch_id)
  where status = 'queued';
create index journal_exports_account_idx on journal_exports (branch_id, account_id, requested_at);

alter table journal_exports enable row level security;
create policy branch_filter on journal_exports for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_exports to sodiq_app;
grant insert (id, branch_id, account_id, assignment_id, quarter_id, month, format, language, requested_at)
  on journal_exports to sodiq_app;
grant update (status, as_of, file_key, journals, rows, failure) on journal_exports to sodiq_app;

-- The moments and the one way of the status: queued to ready or failed, once.
-- A queued row is marked failed `journal_export_stale` only when it is older
-- than 20 minutes, beyond the job's 15-minute expiry (decision 6).
create function journal_exports_write() returns trigger
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
    new.status := 'queued';
    new.requested_at := moment;
    return new;
  end if;
  if old.status <> 'queued' or new.status = 'queued' then
    raise exception 'journal_export_status'
      using errcode = 'check_violation', constraint = 'journal_export_status';
  end if;
  if new.status = 'ready' then
    new.ready_at := moment;
    new.expires_at := moment + interval '24 hours';
  else
    new.failed_at := moment;
    if new.failure = 'journal_export_stale'
      and old.requested_at > moment - interval '20 minutes' then
      raise exception 'journal_export_status'
        using errcode = 'check_violation', constraint = 'journal_export_status';
    end if;
  end if;
  return new;
end
$$;

create trigger journal_exports_write
  before insert or update on journal_exports
  for each row execute function journal_exports_write();
