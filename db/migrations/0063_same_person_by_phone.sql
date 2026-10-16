-- 0063 The mark "same person" read from the phones, and one phone for one
-- staff record (task 3.6b-1, pull request #119).
--
-- Issue #42, the owner's answer L81 of 15 October 2026: the mark between a
-- staff record and a relative follows the phone; nobody sets it by hand. The
-- owner's answer of 16 October 2026: a relative's phone that is a staff
-- member's current phone is never handed to another person; the staff phone
-- is corrected first.
-- docs/spec/edge-cases/close-relatives.md, "A teacher is also a parent": "The
-- mark compares current phone numbers only."
-- docs/spec/edge-cases/people-roles-accounts.md, "A teacher who left is hired
-- again": "A phone that belongs to another staff record is refused and that
-- record is shown."
--
-- Decisions of pull request #119 (plan approved with corrections 1 to 5):
-- the mark is read from the phones, never stored (decision 3, Look first);
-- staff phones are unique, archived and left records included (decision 4,
-- Look first); the phone warning of the duplicate check becomes the refusal
-- of the index (correction 2).

-- Step 1. One staff phone held twice stops the migration with the ids, so
-- that the data are corrected first (decision 4): which record keeps the
-- phone is not the migration's to choose.
do $$
declare
  held text;
begin
  select string_agg(format('%s (%s)', phone, ids), '; ') into held
  from (
    select phone, string_agg(id::text, ', ' order by id) as ids
    from staff
    where phone is not null
    group by phone
    having count(*) > 1
  ) twice;
  if held is not null then
    raise exception 'Two staff records share a phone; correct them first: %', held;
  end if;
end
$$;

create unique index staff_phone_idx on staff (phone) where phone is not null;

-- Step 2. The mark as the phones give it: a person, never a vacancy (a
-- vacancy has no phone), and a relative that has a phone and is not merged
-- (`edge`: "The uniqueness rule applies to relatives who have a phone"). Only
-- the main phone is compared (2.5b-2, decision 2). Archived relatives and
-- staff who left keep their phones, so their mark holds (correction 1).
-- SECURITY DEFINER: the other record may be of a branch the transaction does
-- not see, or of none (an archived relative). Ids only.
create function same_person_staff(relative_ids uuid[])
returns table (relative_id uuid, staff_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.id, s.id
  from public.relatives r
  join public.staff s on s.phone = r.phone and s.kind = 'person'
  where r.id = any (same_person_staff.relative_ids)
    and r.phone is not null
    and r.merged_into is null
  order by r.id
$$;

create function same_person_relative(staff_ids uuid[])
returns table (staff_id uuid, relative_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id, r.id
  from public.staff s
  join public.relatives r on r.phone = s.phone and r.merged_into is null
  where s.id = any (same_person_relative.staff_ids)
    and s.kind = 'person'
    and s.phone is not null
  order by s.id
$$;

revoke execute on function same_person_staff(uuid[]) from public;
revoke execute on function same_person_relative(uuid[]) from public;
grant execute on function same_person_staff(uuid[]) to sodiq_app;
grant execute on function same_person_relative(uuid[]) to sodiq_app;

-- Step 3. A stored mark that differs from the phones leaves an entry, so the
-- log says why a hand mark went or a mark appeared. One entry of
-- `audit_log_school` per relative, as the routes write the mark's entries:
--   * action 'relative.same_person' when the phones give a staff record,
--     'relative.same_person_removed' when they give none;
--   * old_value and new_value `{staffId}`, details `{staffId, cause}` with
--     the cause 'migration' (`staffId` the new mark, or the old one when it
--     goes, as the personal-data report filters it);
--   * actor_id empty: the system (0003);
--   * occurred_at the time of the transaction: a migration is not business
--     code and has no injected clock; the default partition of 0003 takes any
--     moment (as 0041).
-- A merged record held no mark (`relatives_merged_empty_check`), and an
-- emptied mark (archived by the last unlink, 2.5b-2) is compared like any
-- other.
with marks as (
  select
    r.id,
    r.staff_id as old_staff,
    (
      select s.id from staff s
      where s.phone = r.phone and s.kind = 'person' and r.phone is not null
        and r.merged_into is null
    ) as new_staff
  from relatives r
)
insert into audit_log_school (
  occurred_at, actor_id, action, record_type, record_id, old_value, new_value, details
)
select
  now(),
  null,
  case when new_staff is null then 'relative.same_person_removed' else 'relative.same_person' end,
  'relative',
  id,
  jsonb_build_object('staffId', old_staff),
  jsonb_build_object('staffId', new_staff),
  jsonb_build_object('staffId', coalesce(new_staff, old_staff), 'cause', 'migration')
from marks
where old_staff is distinct from new_staff;

-- Step 4. The stored mark goes (decision 3, Look first): the requirement
-- changed (L81), and the two unique phone indexes keep the mark one to one.
drop trigger relatives_same_person_check on relatives;
drop function relatives_same_person_check();
alter table relatives drop constraint relatives_merged_empty_check;
alter table relatives add constraint relatives_merged_empty_check check (
  merged_into is null or cardinality(extra_phones) = 0
);
drop index relatives_staff_idx;
revoke update (staff_id) on relatives from sodiq_app;
alter table relatives drop column staff_id;

-- Step 5. The duplicate warning keeps name and date of birth; a phone is now
-- refused by `staff_phone_idx` (correction 2). The signature stays, so that
-- 0024 is not edited; the phone argument is no longer read.
create or replace function staff_duplicate_elsewhere(
  first_name text, last_name text, birth_date date, phone text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.staff s
    where s.kind = 'person'
      and not exists (
        select 1 from public.staff_branches b
        where b.staff_id = s.id and b.branch_id = any (public.app_branch_ids())
      )
      and lower(s.first_name) = lower(staff_duplicate_elsewhere.first_name)
      and lower(s.last_name) = lower(staff_duplicate_elsewhere.last_name)
      and s.birth_date = staff_duplicate_elsewhere.birth_date
  )
$$;

-- Whether a staff record not linked to a branch of the transaction holds a
-- phone (`edge/people-roles-accounts`, re-hire row: "that record is shown"),
-- for the check before Save: the record of another branch is told, never
-- named (as the UID refusal). A boolean, never row data.
create function staff_phone_elsewhere(phone text) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.staff s
    where s.phone = staff_phone_elsewhere.phone
      and not exists (
        select 1 from public.staff_branches b
        where b.staff_id = s.id and b.branch_id = any (public.app_branch_ids())
      )
  )
$$;

revoke execute on function staff_phone_elsewhere(text) from public;
grant execute on function staff_phone_elsewhere(text) to sodiq_app;

-- Step 6. Every writer of a relative's main phone or a staff phone takes this
-- lock for the old and the new phone, in the order of the phones, before its
-- write (`.claude/rules/database.md`: two writes that claim one value across
-- tables), so that the mark read before and after a write, for its audit
-- entry, sees a same-moment write of the other table. Transaction-level.
create function phone_owner_lock(phone text) returns void
language sql
volatile
set search_path = pg_catalog, public
as $$
  select pg_advisory_xact_lock(hashtextextended('phone_owner:' || phone_owner_lock.phone, 0))
$$;

grant execute on function phone_owner_lock(text) to sodiq_app;
