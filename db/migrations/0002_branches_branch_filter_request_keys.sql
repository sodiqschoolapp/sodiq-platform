-- 0002 Branches, the branch filter and repeat-safe request keys (task 0.4b).

-- Minimal on purpose: task 1.1 adds the full record (address, working weekdays,
-- contacts) and the right to create and edit. School-wide: it has no branch
-- filter, because the branch switcher shows the names.
create table branches (
  id uuid primary key default uuidv7(),
  name text not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now()
);

grant select on branches to sodiq_app;

-- The branch filter (docs/spec/edge-cases/developer-rules.md, "Branch filter").
--
-- A transaction says which branches it works for:
--
--   select set_config('app.branch_ids', '{<uuid>,<uuid>}', true);
--
-- The third argument makes the value last for this transaction only, so it
-- never stays on a pooled connection. Nothing set, or an empty value, gives an
-- empty list: no rows. A value that is not a list of uuids is an error, never
-- "all rows".
create function app_branch_ids() returns uuid[]
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.branch_ids', true), '')::uuid[], '{}'::uuid[])
$$;

revoke execute on function app_branch_ids() from public;
grant execute on function app_branch_ids() to sodiq_app;

-- Every later table that belongs to a branch has `branch_id uuid not null
-- references branches (id)` and exactly this policy, and no other:
--
--   alter table t enable row level security;
--   create policy branch_filter on t for all to sodiq_app
--     using (branch_id = any ((select app_branch_ids())::uuid[]))
--     with check (branch_id = any ((select app_branch_ids())::uuid[]));
--
-- The inner select makes PostgreSQL read the list once per query, not per row.
-- The cast is needed: without it "any ((select ...))" compares with the rows
-- of the select, not with the members of the list.
-- sodiq_migrator owns the tables and is not filtered. A test over the catalog
-- (apps/api/src/database/catalog.test.ts) fails for a table that has neither
-- the policy nor an entry in the list of school-wide tables.

-- Repeat-safe actions (developer rules, "Repeat-safe actions"): a request
-- carries a key; the key is written in the same transaction as the change, so
-- a repeat finds it and changes nothing. School-wide: a key is unique across
-- the school and the row holds no school data, only ids and a status.
create table request_keys (
  key uuid primary key,
  -- The action, for example 'timetable.publish'. A key belongs to one action.
  scope text not null,
  -- SHA-256 of the input: the same key with other content is refused.
  request_hash text not null,
  -- The small answer that a repeat gets again. Ids and status, never personal data.
  result jsonb,
  -- From the injected clock: the retention rule (task 8.3c) will compare it.
  created_at timestamptz not null
);

-- No delete, and no update except of the answer.
grant select, insert on request_keys to sodiq_app;
grant update (result) on request_keys to sodiq_app;
