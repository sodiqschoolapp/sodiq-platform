-- 0006 Sign-in limits, idle sign-out and password resets (task 0.6b).
--
-- docs/spec/edge-cases/people-roles-accounts.md, "Accounts and sign-in": after
-- five failures each further attempt is delayed, per account and device; a
-- reset gives a one-time password valid for 24 hours and ends all sessions;
-- the profile lists the sessions, with "sign out everywhere".
-- docs/spec/13-technology.md, Security: sessions end after a period without use.

-- Idle sign-out: the moment of the last use, from the injected clock. A session
-- is over once this plus the idle limit has passed; every request compares the
-- two, no timed job does.
alter table sessions add column last_used_at timestamptz;
update sessions set last_used_at = created_at;
alter table sessions alter column last_used_at set not null;

-- The browser as it named itself at sign-in, as a label in the session list.
alter table sessions add column user_agent text check (char_length(user_agent) <= 200);

alter table sessions drop constraint sessions_end_reason_check;
alter table sessions add constraint sessions_end_reason_check check (
  end_reason in ('sign_out', 'password_change', 'idle', 'sign_out_everywhere', 'password_reset')
);

grant update (last_used_at) on sessions to sodiq_app;

-- A reset by an administrator: who and when, shown to the person at the next
-- sign-in ("your password was reset by X") and emptied by the password change.
alter table accounts add column password_reset_by uuid references accounts (id);
alter table accounts add column password_reset_at timestamptz;
alter table accounts add check ((password_reset_by is null) = (password_reset_at is null));

grant update (password_reset_by, password_reset_at) on accounts to sodiq_app;

-- A browser that has signed in to an account before. Its cookie holds a random
-- token; only the SHA-256 is stored. Failed sign-ins from such a browser are
-- counted on their own, so guesses from elsewhere do not delay the person.
create table known_devices (
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references accounts (id),
  -- From the injected clock.
  first_signed_in_at timestamptz not null,
  primary key (token_hash, account_id)
);

grant select, insert on known_devices to sodiq_app;

-- The count of failed sign-ins per login and device. The login is stored as
-- its SHA-256 only: unknown logins are counted too, and people type passwords
-- into the login field. `device_key` is the token hash of a known device, or
-- 'unknown' for every other browser together.
create table sign_in_throttle (
  login_hash text not null check (login_hash ~ '^[0-9a-f]{64}$'),
  device_key text not null check (device_key = 'unknown' or device_key ~ '^[0-9a-f]{64}$'),
  failures integer not null check (failures >= 0),
  -- Both from the injected clock, compared with the clock at each attempt.
  last_failure_at timestamptz not null,
  blocked_until timestamptz,
  primary key (login_hash, device_key)
);

-- Rows whose last failure is older than 24 hours are removed in batches.
create index sign_in_throttle_last_failure_idx on sign_in_throttle (last_failure_at);

-- Bookkeeping, not history: a success removes the row.
grant select, insert, update, delete on sign_in_throttle to sodiq_app;
