-- 0036 Close relatives ("Parents"), their links to students and their
-- switched-off accounts (task 2.5a, pull request #72).
--
-- docs/spec/04-people.md, Close relatives: "A close relative is a person
-- record of its own ... One relative can be linked to several students, and
-- one student can have several relatives." "Main phone | Required, except for
-- a relative recorded with \"no phone of their own\" ... Unique: no two
-- relatives can have the same main phone." "Relationship | Required. Kept on
-- the link between the relative and each student". "A student cannot be saved
-- without at least one relative, and the last relative of a student cannot be
-- removed." "A relative with no linked students is archived."
-- docs/spec/edge-cases/close-relatives.md: "Relatives are school-wide
-- records, and the phone is unique across the whole school. Staff can open a
-- relative only if a student of their own branch is linked; students of other
-- branches appear as a count." "Each student has exactly one main contact."
-- "Every relative linked to a student has a Parent account ... Each link
-- between a relative and a student carries: relationship, main contact,
-- portal access and \"receives notices\". Portal access is on by default".
--
-- Decisions of pull request #72 (plan approved with corrections 1 and 2):
-- `relatives` has no branch and is filtered by membership through the live
-- links, which are an ordinary branch table (decision 2, Look first; policy
-- `relative_membership`, named in MEMBERSHIP_FILTERED_TABLES of
-- apps/api/src/database/catalog.test.ts); a link is unlinked once and never
-- deleted, but goes with a student deleted as created twice (decision 10);
-- the phone of a relative is found across branches by `relative_by_phone`
-- and the students elsewhere are a count (decision 3, Look first); a
-- relative with no live link is archived and comes back with a new one
-- (decisions 10 and 14); a student of 2.4a without a relative is refused only
-- on the edit of the record (decision 11); a relative is committed only with
-- its account and a live link (correction 2).

-- A full name as typed on the document (decision 15): the shape of
-- `student_name_valid` of 0032, longer. RELATIVE_NAME_MAX_LENGTH of
-- packages/shared.
create function relative_name_valid(name text) returns boolean
language sql
immutable
as $$
  select (
    name ~ '^[A-Za-zʻʼ]+([ -][A-Za-zʻʼ]+)*$'
    or name ~ '^[А-Яа-яЁёЎўҚқҒғҲҳ]+([ -][А-Яа-яЁёЎўҚқҒғҲҳ]+)*$'
  ) and length(name) <= 120
$$;

create table relatives (
  id uuid primary key default uuidv7(),
  full_name text not null constraint relatives_full_name_check check (
    relative_name_valid(full_name)
  ),
  -- The name folded by `spellingKey` of packages/shared, written with the
  -- name; the search compares it. A Cyrillic letter folds to at most two.
  name_key text not null constraint relatives_name_key_check check (
    length(name_key) between 1 and 240
  ),
  -- The main phone with its country code (decision 9). Empty: "no phone of
  -- their own" (decision 8). 2.5b's "no valid phone" is a column of its own.
  phone text constraint relatives_phone_check check (phone ~ '^\+[0-9]{7,15}$'),
  workplace text constraint relatives_workplace_check check (
    workplace = btrim(workplace) and length(workplace) between 1 and 120
  ),
  email text constraint relatives_email_check check (
    email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  -- Written only by `relatives_follow_links`, from the injected clock.
  archived_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now()
);

-- Across the school, archived relatives included (edge/developer-rules,
-- Identifiers); relatives with no phone of their own are not compared.
create unique index relatives_phone_idx on relatives (phone) where phone is not null;
create index relatives_name_key_idx on relatives (name_key);

-- The link of a relative to a student (decision 10): a branch table, unlinked
-- once and kept for history.
create table student_relatives (
  id uuid primary key default uuidv7(),
  student_id uuid not null,
  branch_id uuid not null references branches (id),
  relative_id uuid not null references relatives (id),
  -- RELATIONSHIPS of packages/shared.
  relationship text not null constraint student_relatives_relationship_check check (
    relationship in (
      'father', 'mother', 'grandfather', 'grandmother', 'uncle', 'aunt', 'brother', 'sister',
      'guardian', 'other'
    )
  ),
  main_contact boolean not null,
  -- Stored only in Release 1 (decision 13).
  portal_access boolean not null default true,
  receives_notices boolean not null default true,
  -- From the injected clock, at the insert.
  linked_at timestamptz not null,
  -- Written once by the unlink, from the injected clock.
  unlinked_at timestamptz,
  constraint student_relatives_student_fkey foreign key (student_id, branch_id)
    references students (id, branch_id) on update cascade on delete cascade
);

-- One live link per student and relative; at most one live main contact.
create unique index student_relatives_live_idx on student_relatives (
  branch_id, student_id, relative_id
) where unlinked_at is null;
create unique index student_relatives_main_idx on student_relatives (branch_id, student_id)
  where main_contact and unlinked_at is null;
create index student_relatives_relative_idx on student_relatives (relative_id)
  where unlinked_at is null;
create index student_relatives_student_idx on student_relatives (student_id);

alter table student_relatives enable row level security;
create policy branch_filter on student_relatives for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert (
  id, student_id, branch_id, relative_id, relationship, main_contact, portal_access,
  receives_notices, linked_at
) on student_relatives to sodiq_app;
grant update (relationship, main_contact, portal_access, receives_notices, unlinked_at)
  on student_relatives to sodiq_app;

-- A relative is visible and writable only while a live link of a branch of
-- the transaction exists (`student_relatives` is itself branch-filtered); the
-- insert check is open, since the record is inserted before its first link
-- (correction 2 refuses a commit without one).
alter table relatives enable row level security;
create policy relative_membership on relatives for all to sodiq_app
  using (
    exists (
      select 1 from student_relatives l
      where l.relative_id = relatives.id and l.unlinked_at is null
    )
  )
  with check (true);

grant select, insert (id, full_name, name_key, phone, workplace, email) on relatives to sodiq_app;
grant update (full_name, name_key, phone, workplace, email) on relatives to sodiq_app;

-- The unlink is written once (decision 10): `unlinked_at` from empty to the
-- moment of the transaction (`app.now`), never back, never before the link;
-- an unlinked row takes no other change. The branch may change with the
-- student (the cascade of the move of task 3.3). Not SECURITY DEFINER.
create function student_relatives_unlink_once() returns trigger
language plpgsql
as $$
declare
  moment timestamptz;
begin
  if old.unlinked_at is not null then
    if (to_jsonb(new) - 'branch_id') is distinct from (to_jsonb(old) - 'branch_id') then
      raise exception 'student_relatives_unlinked'
        using errcode = 'check_violation', constraint = 'student_relatives_unlinked';
    end if;
    return new;
  end if;
  if new.unlinked_at is not null then
    moment := nullif(current_setting('app.now', true), '')::timestamptz;
    if moment is null or moment < old.linked_at then
      raise exception 'student_relatives_unlink_moment'
        using errcode = 'check_violation', constraint = 'student_relatives_unlink_moment';
    end if;
    new.unlinked_at := moment;
  end if;
  return new;
end
$$;

create trigger student_relatives_unlink_once
  before update on student_relatives
  for each row execute function student_relatives_unlink_once();

-- Always connected (`04`): at the commit a student has at least one live link
-- and exactly one live main contact. Checked on the insert of a student, on a
-- link written or its main mark or unlink changed, and on the edit of the
-- record (the columns of the edit only, without the grade, which a return
-- also writes: a photo, a UID correction, a status, a return and the branch
-- move of 3.3 pass, decision 11; the edit writes every column at once). A student deleted in the
-- transaction is not checked. Not SECURITY DEFINER: the links of a student
-- are rows of its branch, which the writing transaction sees.
create function student_relatives_guard() returns trigger
language plpgsql
as $$
declare
  record_id uuid;
  live bigint;
  main bigint;
begin
  if tg_table_name = 'students' then
    record_id := new.id;
  else
    record_id := new.student_id;
  end if;
  if not exists (select 1 from students where id = record_id) then
    return null;
  end if;
  select count(*), count(*) filter (where main_contact) into live, main
    from student_relatives
    where student_id = record_id and unlinked_at is null;
  if live = 0 then
    raise exception 'student_needs_relative'
      using errcode = 'check_violation', constraint = 'student_needs_relative';
  end if;
  if main <> 1 then
    raise exception 'student_main_contact'
      using errcode = 'check_violation', constraint = 'student_main_contact';
  end if;
  return null;
end
$$;

create constraint trigger student_relatives_guard_create
  after insert on students
  deferrable initially deferred
  for each row execute function student_relatives_guard();

create constraint trigger student_relatives_guard_edit
  after update of
    first_name, last_name, paternal_name, name_key, sex, birth_date, document_type,
    document_number, jshshir, phone, email, address, region, previous_school, diagnostic_score,
    scholarship_type, scholarship_coverage, scholarship_amount, consent_signed_on
  on students
  deferrable initially deferred
  for each row execute function student_relatives_guard();

create constraint trigger student_relatives_guard
  after insert or update of main_contact, unlinked_at on student_relatives
  deferrable initially deferred
  for each row execute function student_relatives_guard();

-- A relative with no live link in any branch is archived, and a new live link
-- restores it (`04`: "A relative with no linked students is archived";
-- decisions 10 and 14). SECURITY DEFINER (decision 3): the links of other
-- branches decide it, and an archived relative is visible to no branch. The
-- relative's row is locked first, in a statement of its own, then its live
-- links counted in a second one, so that a link in one branch and the last
-- unlink in another are ordered (plan review, finding 4). The moment is the
-- transaction's (`app.now`); without it nothing is archived.
create function relatives_follow_links() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target uuid;
  live bigint;
  moment timestamptz;
begin
  if tg_op = 'DELETE' then
    target := old.relative_id;
  else
    target := new.relative_id;
  end if;
  perform 1 from public.relatives where id = target for update;
  select count(*) into live
    from public.student_relatives
    where relative_id = target and unlinked_at is null;
  if live = 0 then
    moment := nullif(current_setting('app.now', true), '')::timestamptz;
    if moment is null then
      raise exception 'relatives_archive_moment'
        using errcode = 'check_violation', constraint = 'relatives_archive_moment';
    end if;
    update public.relatives set archived_at = moment
      where id = target and archived_at is null;
  else
    update public.relatives set archived_at = null
      where id = target and archived_at is not null;
  end if;
  return null;
end
$$;

revoke execute on function relatives_follow_links() from public;

create trigger relatives_follow_links
  after insert or update of unlinked_at or delete on student_relatives
  for each row execute function relatives_follow_links();

-- The Parent account, created with the record and switched off until
-- Release 2 (`edge`: "Every relative linked to a student has a Parent
-- account"), as `student_accounts`. Release 2 drops the check.
create table relative_accounts (
  relative_id uuid primary key references relatives (id),
  -- From the injected clock.
  created_at timestamptz not null,
  switched_on_at timestamptz constraint relative_accounts_switched_off_check check (
    switched_on_at is null
  )
);

alter table relative_accounts enable row level security;
create policy relative_membership on relative_accounts for all to sodiq_app
  using (
    exists (
      select 1 from student_relatives l
      where l.relative_id = relative_accounts.relative_id and l.unlinked_at is null
    )
  )
  with check (true);

grant select, insert (relative_id, created_at) on relative_accounts to sodiq_app;

-- A relative is committed with its account and a live link (correction 2:
-- a relative inserted without a link would hold its phone, live, visible to
-- no branch). Not SECURITY DEFINER: the writing transaction sees the link it
-- wrote, and through it the account.
create function relatives_complete_check() returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from student_relatives where relative_id = new.id and unlinked_at is null
  ) then
    raise exception 'relative_needs_link'
      using errcode = 'check_violation', constraint = 'relative_needs_link';
  end if;
  if not exists (select 1 from relative_accounts where relative_id = new.id) then
    raise exception 'relative_needs_account'
      using errcode = 'check_violation', constraint = 'relative_needs_account';
  end if;
  return null;
end
$$;

create constraint trigger relatives_complete_check
  after insert on relatives
  deferrable initially deferred
  for each row execute function relatives_complete_check();

-- The holder of an exact main phone, archived included (decision 3, Look
-- first): id, full name and the number of students linked live in every
-- branch, for the phone typed first and the refused phone change ("that
-- relative is shown"). Nothing else of the record. Called by the service only
-- in routes held by `relatives` create or edit.
create function relative_by_phone(phone text)
returns table (id uuid, full_name text, students bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.id, r.full_name, (
    select count(*) from public.student_relatives l
    where l.relative_id = r.id and l.unlinked_at is null
  )
  from public.relatives r
  where r.phone = relative_by_phone.phone
$$;

revoke execute on function relative_by_phone(text) from public;
grant execute on function relative_by_phone(text) to sodiq_app;

-- The number of students of branches outside the transaction's linked live
-- to a relative that the transaction sees (a live link of its branches), or
-- null for one it does not see (`edge`: "students of other branches appear as
-- a count"). A count, never row data.
create function relative_links_elsewhere(relative_id uuid) returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when exists (
      select 1 from public.student_relatives l
      where l.relative_id = relative_links_elsewhere.relative_id
        and l.unlinked_at is null
        and l.branch_id = any (public.app_branch_ids())
    )
    then (
      select count(*) from public.student_relatives l
      where l.relative_id = relative_links_elsewhere.relative_id
        and l.unlinked_at is null
        and not (l.branch_id = any (public.app_branch_ids()))
    )
  end
$$;

revoke execute on function relative_links_elsewhere(uuid) from public;
grant execute on function relative_links_elsewhere(uuid) to sodiq_app;
