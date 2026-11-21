-- 0176 Requests made through an integration key (task 10.10, the owner's spec
-- change of 21 November 2026; plan approved on pull request #369).
--
-- `02`, Integration keys: "The server limits how many requests a key may make
-- per minute" and "Every change made through a key is recorded as the
-- person's change, with the key named". Columns only: no existing row changes
-- (stop-list item 3).
--
-- The limit (decision 8 of the plan): a fixed window of one minute kept on the
-- key row, so it holds across the two servers. The guard counts each request
-- with one update `where revoked_at is null`, together with `last_used_at`.
-- `integration_keys_guard` (0175) refuses only the end date and the revoke
-- columns on a revoked key, so these stay writable as `last_used_at` is.
-- `integration_keys` holds a few rows: one step.
alter table integration_keys
  add column minute_started_at timestamptz,
  add column minute_requests integer not null default 0
    constraint integration_keys_minute_requests_check check (minute_requests >= 0);

grant update (minute_started_at, minute_requests) on integration_keys to sodiq_app;

-- The key a change was made through, on each audit entry written during a key
-- request (`Audit.record` reads it from the request context). Nullable with
-- no default: the catalog changes and no partition is rewritten or scanned.
-- No foreign key (decision 12 and review finding 11 of the plan): one would be
-- validated over every partition of the live log while inserts wait. A key is
-- never deleted (`sodiq_app` has no delete right on `integration_keys`), and
-- the id is written only from the key the guard found. The insert grant of
-- 0003 covers the new column; the tables stay append-only.
alter table audit_log add column integration_key_id uuid;
alter table audit_log_school add column integration_key_id uuid;
