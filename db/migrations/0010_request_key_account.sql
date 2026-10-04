-- 0010 The request key belongs to the account that sent it (task 0.7c).

-- Repeat-safe actions (developer rules, "Repeat-safe actions"): a key is made
-- by one browser for one action. The same key sent by another account is
-- refused, so nobody gets the stored answer of somebody else's request.
--
-- A job has no account: its key is the job id and its scope begins with
-- `job:` (apps/api/src/jobs/job-runner.ts). Every other key names its account.
-- The table is small and nothing is deployed yet, so one step is enough.
alter table request_keys
  add column account_id uuid references accounts (id),
  add constraint request_keys_account_check
    check ((account_id is null) = (scope like 'job:%'));

-- The rights stay as they are: insert covers the new column, and the only
-- column the application user may update is still `result`.
