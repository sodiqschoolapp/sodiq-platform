-- 0007 Two-step sign-in (task 0.6c).
--
-- docs/spec/edge-cases/people-roles-accounts.md, "Accounts and sign-in": the
-- second step is a code from an authenticator app, with ten single-use recovery
-- codes shown at set-up.
-- docs/spec/02-roles-and-access.md, Rules: required for the Super Admin and
-- Academic Vice Principal and optional for others.
--
-- Both tables are school-wide, like `accounts`: an account has no branch.

-- The second step of an account. It is in force once `confirmed_at` is set: a
-- set-up that was started and never confirmed with a code opens and closes
-- nothing.
create table account_second_steps (
  account_id uuid primary key references accounts (id),
  -- The secret the authenticator app holds too. A code is computed from it, so
  -- it cannot be stored as a hash; it is stored encrypted (AES-256-GCM) with a
  -- key that is not in the database. The prefix names the version of that key.
  secret text not null check (secret ~ '^v[1-9][0-9]*:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  -- All moments are from the injected clock.
  created_at timestamptz not null,
  confirmed_at timestamptz,
  -- The 30-second step of the last code that was accepted: a code is accepted
  -- once, and no code of an earlier step after it.
  last_used_step integer,
  -- The count of wrong codes, per account. Compared with the clock at each
  -- attempt; a right code starts it again.
  failures integer not null default 0 check (failures >= 0),
  last_failure_at timestamptz,
  blocked_until timestamptz
);

-- The account of a row cannot be changed. A second step that is turned off or
-- reset is removed; the audit log keeps what happened.
grant select, insert, delete on account_second_steps to sodiq_app;
grant update (
  secret, created_at, confirmed_at, last_used_step, failures, last_failure_at, blocked_until
) on account_second_steps to sodiq_app;

-- The recovery codes of an account: SHA-256 of each, as hex. A code is random
-- and long, shown once at set-up and never stored.
create table second_step_recovery_codes (
  account_id uuid not null references accounts (id),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  -- From the injected clock; a code with a moment here was used and is over.
  used_at timestamptz,
  primary key (account_id, code_hash)
);

grant select, insert, delete on second_step_recovery_codes to sodiq_app;
grant update (used_at) on second_step_recovery_codes to sodiq_app;

-- The moment a session passed the second step, from the injected clock. A
-- session of an account with a second step in force is open only if this is
-- not before the moment that second step was confirmed.
alter table sessions add column second_step_passed_at timestamptz;

grant update (second_step_passed_at) on sessions to sodiq_app;
