-- 0003 The audit log (task 0.5a).
--
-- docs/spec/13-technology.md, Security: every change is written to an audit log
-- that cannot be edited: who, when, old value, new value.
-- docs/spec/edge-cases/developer-rules.md, "History and audit": append-only, the
-- application's database user cannot update or delete; partitioned by month.
--
-- Two tables with the same columns: audit_log belongs to a branch and has the
-- branch filter; audit_log_school holds events of the whole school (sign-ins,
-- relatives, appointments across branches) and has no branch.

create table audit_log (
  id uuid not null default uuidv7(),
  -- From the injected clock: later rules compare it (for example "entries made
  -- within 48 hours of a reset").
  occurred_at timestamptz not null,
  branch_id uuid not null references branches (id),
  -- The account that acted; empty for the system (a server command, a job).
  -- No foreign key: accounts arrive in task 0.6a, and the log must never be
  -- blocked by, or block, another table.
  actor_id uuid,
  -- The person the entry is about, when there is one.
  person_id uuid,
  -- The assignment that allowed the action (task 0.7).
  assignment_id uuid,
  -- What happened, for example 'branch.create'.
  action text not null check (action <> ''),
  -- The record that changed; both empty for events without one (sign-in, export).
  record_type text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  -- What is neither old nor new value: the filters and row count of an export.
  details jsonb,
  request_id text,
  -- A partitioned table needs the partition key in its primary key.
  primary key (id, occurred_at),
  check ((record_type is null) = (record_id is null))
) partition by range (occurred_at);

create table audit_log_school (
  id uuid not null default uuidv7(),
  occurred_at timestamptz not null,
  actor_id uuid,
  person_id uuid,
  assignment_id uuid,
  action text not null check (action <> ''),
  record_type text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  details jsonb,
  request_id text,
  primary key (id, occurred_at),
  check ((record_type is null) = (record_id is null))
) partition by range (occurred_at);

-- Search by person (the actor or the person an entry is about), record and
-- date is task 2.6. Each partition gets these indexes from its parent.
create index audit_log_branch_idx on audit_log (branch_id, occurred_at);
create index audit_log_actor_idx on audit_log (actor_id, occurred_at);
create index audit_log_person_idx on audit_log (person_id, occurred_at);
create index audit_log_record_idx on audit_log (record_type, record_id);

create index audit_log_school_actor_idx on audit_log_school (actor_id, occurred_at);
create index audit_log_school_person_idx on audit_log_school (person_id, occurred_at);
create index audit_log_school_record_idx on audit_log_school (record_type, record_id);

-- The branch filter of migration 0002, exactly.
alter table audit_log enable row level security;
create policy branch_filter on audit_log for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Partitions: one per month from October 2026 to December 2029, borders in UTC,
-- and a default partition, so a write never fails for a missing month. The
-- application user cannot create tables; later months come from a new
-- migration (a test fails while fewer than 6 months remain). Before a month is
-- added, the default partition must hold no row of that month.
--
-- A partition that is read directly is not covered by the policy of its
-- parent. So each partition of audit_log gets the branch filter too, and the
-- application user gets no right on any partition, only on the two parents.
do $$
declare
  month date;
  suffix text;
  partition text;
begin
  for month in
    select generate_series(date '2026-10-01', date '2029-12-01', interval '1 month')::date
  loop
    suffix := to_char(month, 'YYYY_MM');
    execute format(
      'create table %I partition of audit_log for values from (%L) to (%L)',
      'audit_log_' || suffix,
      to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
    execute format(
      'create table %I partition of audit_log_school for values from (%L) to (%L)',
      'audit_log_school_' || suffix,
      to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  end loop;

  create table audit_log_default partition of audit_log default;
  create table audit_log_school_default partition of audit_log_school default;

  for partition in
    select inhrelid::regclass::text from pg_inherits where inhparent = 'audit_log'::regclass
  loop
    execute format('alter table %I enable row level security', partition);
    execute format(
      'create policy branch_filter on %I for all to sodiq_app
         using (branch_id = any ((select app_branch_ids())::uuid[]))
         with check (branch_id = any ((select app_branch_ids())::uuid[]))',
      partition
    );
  end loop;
end
$$;

-- Append-only: insert and read, on the parents only. No update, no delete, no
-- truncate, and nothing at all on a partition.
grant select, insert on audit_log to sodiq_app;
grant select, insert on audit_log_school to sodiq_app;
