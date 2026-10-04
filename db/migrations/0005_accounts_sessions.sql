-- 0005 Accounts and sessions (task 0.6a).
--
-- docs/spec/02-roles-and-access.md, Rules: no open sign-up, every account is
-- created by an administrator; login and password; the password is changed at
-- first sign-in.
-- docs/spec/13-technology.md, Security: Argon2id passwords, cookie sessions
-- kept in the database.
--
-- Both tables are school-wide: one person has one account for every branch, and
-- a sign-in happens before any branch is known. They hold no name: the link to
-- a staff record comes with task 2.2.

create table accounts (
  id uuid primary key default uuidv7(),
  -- Generated, for example a.karimov, a.karimov2 (edge cases, "Accounts and
  -- sign-in"). Never reused: the application user can neither delete an account
  -- nor change a login, and the login is unique.
  login text not null unique check (login ~ '^[a-z]\.[a-z]+[0-9]*$'),
  -- Argon2id in PHC text, with its salt and parameters. Never the password.
  password_hash text not null check (password_hash like '$argon2id$%'),
  -- True for a first password: nothing else is allowed until it is changed.
  must_change_password boolean not null,
  -- A first password is valid for 7 days. From the injected clock, compared
  -- with the clock at each sign-in; empty once the person chose a password.
  password_expires_at timestamptz,
  -- From the injected clock; empty while the first password is in use.
  password_changed_at timestamptz,
  -- From the injected clock.
  created_at timestamptz not null,
  -- The account that created this one; empty for the first-account command.
  created_by uuid references accounts (id)
);

grant select, insert on accounts to sodiq_app;
grant update (password_hash, must_change_password, password_expires_at, password_changed_at)
  on accounts to sodiq_app;

create table sessions (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  -- SHA-256 of the token in the cookie, as hex. The token itself is never
  -- stored, so a reader of this table cannot use a session.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- From the injected clock.
  created_at timestamptz not null,
  -- Stored moment: a session is in force while this is empty. Idle sign-out
  -- (task 0.6b) and trusted devices (0.6c) add their own moments.
  ended_at timestamptz,
  end_reason text check (end_reason in ('sign_out', 'password_change')),
  check ((ended_at is null) = (end_reason is null))
);

-- "End every other session of the account" at a password change.
create index sessions_open_idx on sessions (account_id) where ended_at is null;

-- A session is ended, never removed; its token and account cannot be changed.
grant select, insert on sessions to sodiq_app;
grant update (ended_at, end_reason) on sessions to sodiq_app;
