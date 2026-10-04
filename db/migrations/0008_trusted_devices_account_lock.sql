-- 0008 Trusted devices, the longest life of a session and the account lock
-- (task 0.6d).
--
-- docs/spec/edge-cases/people-roles-accounts.md, "Accounts and sign-in": with
-- "Trust this device" a browser stays signed in for 7 days from the sign-in,
-- with no idle sign-out; the sign-in that starts the trust still asks for the
-- second step; every session ends 7 days after sign-in at the latest, trusted
-- or not; the profile lists trusted devices and removing one ends its session.
-- "Staff over time": "Lock now" ends all sessions at once and is logged with a
-- reason.

-- A trusted device is the trusted session of that browser. The switch of the
-- sign-in page is stored as it was sent and never changed afterwards.
alter table sessions add column trust_requested boolean not null default false;

-- The moment trust began: when the sign-in that asked for it owed no step any
-- more (the second step, where the account has one). From the injected clock.
-- While this is set, `trust_ended_at` is empty and the session is in force, the
-- session has no idle sign-out.
alter table sessions add column trusted_from timestamptz;

-- The moment the trust of the session was over while the session lived on: the
-- own password change. From the injected clock. Every other end of trust ends
-- the session. It is also set on a session that asked for trust and changed
-- the password before trust began (the forced change of a first or reset
-- password): such a session never becomes trusted.
alter table sessions add column trust_ended_at timestamptz;

alter table sessions add constraint sessions_trust_requested_check
  check (trusted_from is null or trust_requested);
alter table sessions add constraint sessions_trust_ended_check
  check (trust_ended_at is null or trust_requested);

-- The longest life needs no column: a session is over 7 days after
-- `created_at`, compared with the clock on each request.
alter table sessions drop constraint sessions_end_reason_check;
alter table sessions add constraint sessions_end_reason_check check (
  end_reason in (
    'sign_out', 'password_change', 'idle', 'sign_out_everywhere', 'password_reset',
    'expired', 'account_locked', 'trusted_device_removed'
  )
);

-- `trust_requested` is written with the row and not granted for update.
grant update (trusted_from, trust_ended_at) on sessions to sodiq_app;

-- The lock of an account: separate from employment status. A locked account
-- cannot sign in and has no session. An unlock empties the three columns; the
-- audit log keeps who locked and unlocked, when and why.
alter table accounts add column locked_at timestamptz;
alter table accounts add column locked_by uuid references accounts (id);
alter table accounts add column lock_reason text;

alter table accounts add constraint accounts_lock_together_check check (
  (locked_at is null) = (locked_by is null) and (locked_at is null) = (lock_reason is null)
);
alter table accounts add constraint accounts_lock_reason_check check (
  lock_reason is null or (btrim(lock_reason) <> '' and char_length(lock_reason) <= 500)
);
-- Nobody locks their own account.
alter table accounts add constraint accounts_lock_not_own_check check (locked_by <> id);

grant update (locked_at, locked_by, lock_reason) on accounts to sodiq_app;
