-- 0031 Password reset by email and the own photo (task 2.3c-2, pull request #66).
--
-- docs/spec/02-roles-and-access.md, Accounts and sign-in: build order: before
-- the school goes live, "Password reset by email"; it is one of the short list
-- of routes that work without sign-in. The owner's answer 16 (docs/decisions.md,
-- "Decided ahead for tasks 2.1 to 2.6"): "built now; until go-live (task 10.4)
-- emails are written to the log only, never sent".
--
-- A link is asked for by login (decision 7 of #66). The request writes a row;
-- a job made in the same transaction makes the token, stores its SHA-256,
-- sends the mail and sets `sent_at` and `valid_until` (one hour, decision 9);
-- the token itself is never stored (decision 13). A link works once, only
-- while it is the newest of its account, and is closed by a newer link, by
-- every password write and by an email change (decision 11). Every moment is
-- written from the injected clock and compared with it on each request
-- (CLAUDE.md, State from stored moments).
--
-- School-wide (SCHOOL_WIDE_TABLES): an account has no branch, and the request
-- comes before any branch is known.
create table password_reset_links (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  -- When the link was asked for: the 5-minute rule (decision 10) and the
  -- bound on a job that runs late (decision 9) compare it.
  requested_at timestamptz not null,
  -- SHA-256 of the token, as hex; empty until the job makes the link.
  token_hash text constraint password_reset_links_token_hash_key unique
    constraint password_reset_links_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz,
  valid_until timestamptz,
  used_at timestamptz,
  -- A link closed unused: a newer link, a password write, an email change.
  closed_at timestamptz,
  constraint password_reset_links_sent_check check (
    (token_hash is null) = (sent_at is null) and (sent_at is null) = (valid_until is null)
  ),
  constraint password_reset_links_valid_check check (valid_until > sent_at),
  constraint password_reset_links_used_check check (
    used_at is null or (sent_at is not null and used_at >= sent_at and used_at < valid_until)
  ),
  constraint password_reset_links_end_check check (used_at is null or closed_at is null)
);

create index password_reset_links_account_idx on password_reset_links (account_id, requested_at desc);

grant select, insert on password_reset_links to sodiq_app;
grant update (token_hash, sent_at, valid_until, used_at, closed_at) on password_reset_links
  to sodiq_app;

-- One-time use held by the database too (decision 11): each moment and the
-- hash go from empty to a value once and never change afterwards; the account
-- and the moment of the request never change.
create function password_reset_links_set_once() returns trigger
language plpgsql
as $$
begin
  if new.account_id is distinct from old.account_id
    or new.requested_at is distinct from old.requested_at
    or (old.token_hash is not null and new.token_hash is distinct from old.token_hash)
    or (old.sent_at is not null and new.sent_at is distinct from old.sent_at)
    or (old.valid_until is not null and new.valid_until is distinct from old.valid_until)
    or (old.used_at is not null and new.used_at is distinct from old.used_at)
    or (old.closed_at is not null and new.closed_at is distinct from old.closed_at)
  then
    raise exception 'password_reset_links_set_once'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger password_reset_links_set_once
  before update on password_reset_links
  for each row execute function password_reset_links_set_once();

-- The request and the job run before any branch is known, where the row filter
-- hides every staff row (decision 3 of #66, Look first). Each function answers
-- about one account and does not read app_branch_ids().

-- Whether a link may be made for the account now: not locked, its person
-- record not inactive or left on the date of `at`, and an email on the record.
-- A yes or no only, for the public request.
create function password_reset_allowed(account_id uuid, at timestamptz) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.accounts a
    join public.staff s on s.account_id = a.id and s.kind = 'person'
    where a.id = password_reset_allowed.account_id
      and a.locked_at is null
      and s.email is not null
      and s.email <> ''
      and not public.staff_account_blocked(a.id, password_reset_allowed.at)
  )
$$;

-- The email of the account's person record under the same conditions; nothing
-- otherwise. For the mail job only (correction 2 of the review of #66).
create function password_reset_address(account_id uuid, at timestamptz) returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.email
  from public.accounts a
  join public.staff s on s.account_id = a.id and s.kind = 'person'
  where a.id = password_reset_address.account_id
    and a.locked_at is null
    and s.email is not null
    and s.email <> ''
    and not public.staff_account_blocked(a.id, password_reset_address.at)
$$;

-- The person record linked to an account and the branch of its main link:
-- ids only, for the own photo (decision 18 of #66), whose work then runs in
-- that branch through the ordinary row filter.
create function own_staff_record(account_id uuid)
returns table (staff_id uuid, branch_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id, b.branch_id
  from public.staff s
  join public.staff_branches b on b.staff_id = s.id and b.is_main
  where s.account_id = own_staff_record.account_id and s.kind = 'person'
$$;

-- Who changed the email of the account's person record last, and when: the
-- actor's account id and the moment, nothing else (decision 6 and correction 1
-- of the review of #66). The entry `staff.edit` lives in a branch's log, which
-- the public confirm cannot see.
create function last_email_change(account_id uuid)
returns table (actor_id uuid, occurred_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select l.actor_id, l.occurred_at
  from public.staff s
  join public.audit_log l on l.person_id = s.id
  where s.account_id = last_email_change.account_id
    and s.kind = 'person'
    and l.action = 'staff.edit'
    and l.new_value ? 'email'
  order by l.occurred_at desc
  limit 1
$$;

revoke all on function password_reset_allowed(uuid, timestamptz) from public;
revoke all on function password_reset_address(uuid, timestamptz) from public;
revoke all on function own_staff_record(uuid) from public;
revoke all on function last_email_change(uuid) from public;
grant execute on function password_reset_allowed(uuid, timestamptz) to sodiq_app;
grant execute on function password_reset_address(uuid, timestamptz) to sodiq_app;
grant execute on function own_staff_record(uuid) to sodiq_app;
grant execute on function last_email_change(uuid) to sodiq_app;
