-- 0175 Integration keys: the keys and their people (task 10.9, pull request #368;
-- the owner's spec change of 21 November 2026).
--
-- 02, Integration keys: "The Super Admin creates a key with a name ..., a list
-- of people and an end date at most one year ahead. ... The secret is shown
-- once, when the key is created, and is stored only as a hash. Only the Super
-- Admin creates keys, changes their people and end date, and revokes them. The
-- list of keys shows each key's last use." 13, Security: "long random secrets,
-- stored only as a hash".
--
-- Both tables are school-wide (build plan 10.9: "with the branch rule of the
-- school-wide records (a key is of the whole school)"; decision 1 of the plan,
-- Look first): one key may list people of several branches. Two new tables,
-- no existing row changes.

create table integration_keys (
  id uuid primary key default uuidv7(),
  -- INTEGRATION_KEY_NAME_MAX_LENGTH of packages/shared. Fixed at create
  -- (decision 8): no update grant.
  name text not null constraint integration_keys_name_check check (
    length(btrim(name)) between 1 and 100
  ),
  -- SHA-256 of the secret, hex (decision 3). Never the secret. Task 10.10
  -- finds a key by it on each request.
  secret_hash text not null
    constraint integration_keys_secret_hash_check check (secret_hash ~ '^[0-9a-f]{64}$')
    constraint integration_keys_secret_hash_key unique,
  -- The last school date the key works, in Asia/Tashkent (decision 5), and
  -- the moment it stops: 00:00 Tashkent of the next day. The moment is what
  -- a rule compares with the clock on each request; the date is shown.
  ends_on date not null,
  ends_at timestamptz not null,
  constraint integration_keys_ends_check check (
    ends_at = ((ends_on + 1)::timestamp at time zone 'Asia/Tashkent')
  ),
  -- From the injected clock.
  created_at timestamptz not null,
  created_by uuid not null references accounts (id),
  -- Revoked for good: set once, never cleared (the trigger below).
  revoked_at timestamptz,
  revoked_by uuid references accounts (id),
  constraint integration_keys_revoked_check check ((revoked_at is null) = (revoked_by is null)),
  -- Written by task 10.10 on each request made with the key.
  last_used_at timestamptz
);

-- One name among the keys not revoked; a revoked key's name may be used again.
create unique index integration_keys_name_key on integration_keys (lower(btrim(name)))
  where revoked_at is null;

grant select, insert on integration_keys to sodiq_app;
grant update (ends_on, ends_at, revoked_at, revoked_by, last_used_at)
  on integration_keys to sodiq_app;

-- A revoked key cannot be restored, and nothing of it changes but its last
-- use. Runs as the invoker.
create function integration_keys_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.revoked_at is not null and (
    new.revoked_at is distinct from old.revoked_at
    or new.revoked_by is distinct from old.revoked_by
    or new.ends_on is distinct from old.ends_on
    or new.ends_at is distinct from old.ends_at
  ) then
    raise exception 'integration_key_revoked'
      using errcode = 'check_violation', constraint = 'integration_key_revoked';
  end if;
  return new;
end;
$$;

create trigger integration_keys_guard
  before update on integration_keys
  for each row execute function integration_keys_guard();

create table integration_key_people (
  id uuid primary key default uuidv7(),
  key_id uuid not null references integration_keys (id),
  -- The staff record of the person (a staff ID is read through it).
  staff_id uuid not null references staff (id),
  -- From the injected clock.
  added_at timestamptz not null,
  added_by uuid not null references accounts (id),
  -- A person taken off the key: the row is ended, never deleted (decision 9).
  removed_at timestamptz,
  removed_by uuid references accounts (id),
  constraint integration_key_people_removed_check check (
    (removed_at is null) = (removed_by is null)
  ),
  constraint integration_key_people_removed_after_check check (
    removed_at is null or removed_at >= added_at
  )
);

-- A person is on a key once at a time.
create unique index integration_key_people_key on integration_key_people (key_id, staff_id)
  where removed_at is null;
create index integration_key_people_staff_idx on integration_key_people (staff_id)
  where removed_at is null;

grant select, insert on integration_key_people to sodiq_app;
grant update (removed_at, removed_by) on integration_key_people to sodiq_app;

-- The people of a revoked key do not change, and a removed person does not
-- come back on the same row. Reads the key without a lock: every route locks
-- the key row `for update` in a statement before its writes. Runs as the
-- invoker.
create function integration_key_people_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.removed_at is not null and (
    new.removed_at is distinct from old.removed_at
    or new.removed_by is distinct from old.removed_by
  ) then
    raise exception 'integration_key_person_removed'
      using errcode = 'check_violation', constraint = 'integration_key_person_removed';
  end if;
  if exists (
    select 1 from integration_keys k where k.id = new.key_id and k.revoked_at is not null
  ) then
    raise exception 'integration_key_revoked'
      using errcode = 'check_violation', constraint = 'integration_key_revoked';
  end if;
  return new;
end;
$$;

create trigger integration_key_people_guard
  before insert or update of removed_at, removed_by on integration_key_people
  for each row execute function integration_key_people_guard();
