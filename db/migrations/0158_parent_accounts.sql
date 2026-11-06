-- 0158 Parent accounts: login, slips, reset (task 11.1, pull request #292; the owner's spec
-- change of 6 November 2026).
--
-- docs/spec/10-portal-notifications-release-2.md, Signing in: "Parents sign in with a login
-- and password, like staff. The account is the relative's Parent account (`04`, Close
-- relatives): one account for one person, whatever the number of children, classes or
-- branches." "A parent session never carries staff rights. A staff member who is also a
-- parent has two accounts, each with its own login."
-- docs/spec/edge-cases/close-relatives.md, first passwords: "printing gives a new first
-- password, random, valid for 30 days, printed once and not stored". "A relative whose slip
-- was printed in another class and is still valid is listed with that class and date".
--
-- Plan of #292, approved with corrections: decision 1 (Look first, a check removed because
-- the requirement changed: `edge/close-relatives`, "Every relative linked to a student has a
-- Parent account"; the comment of 0036, "Release 2 drops the check"); decision 6 (a parent
-- account whose relative can no longer sign in); decision 15 (a slip of another branch is
-- named "another branch", never its class).
--
-- Nothing here changes or removes an existing row: a check is dropped, a nullable column, a
-- table, triggers, functions and grants are added.

alter table relative_accounts drop constraint relative_accounts_switched_off_check;

-- The account of the relative, written once at the first print (decision 5).
alter table relative_accounts add column account_id uuid
  constraint relative_accounts_account_id_key unique references accounts (id);

grant update (account_id, switched_on_at) on relative_accounts to sodiq_app;

-- The link to the account is written once, from empty to an account, never changed or
-- emptied; the account is switched on in the same statement, from the moment of the
-- transaction (`app.now`). Not SECURITY DEFINER: it reads only the row itself.
create function relative_accounts_link_once() returns trigger
language plpgsql
as $$
begin
  if new.account_id is distinct from old.account_id then
    if old.account_id is not null then
      raise exception 'relative_account_linked'
        using errcode = 'check_violation', constraint = 'relative_account_linked';
    end if;
    if new.switched_on_at is null then
      raise exception 'relative_account_switch_on'
        using errcode = 'check_violation', constraint = 'relative_account_switch_on';
    end if;
  elsif new.switched_on_at is distinct from old.switched_on_at then
    raise exception 'relative_account_switch_on'
      using errcode = 'check_violation', constraint = 'relative_account_switch_on';
  end if;
  return new;
end
$$;

create trigger relative_accounts_link_once
  before update on relative_accounts
  for each row execute function relative_accounts_link_once();

-- Parent and staff accounts never mix ("a parent session never carries staff rights"). Three
-- guards, each SECURITY DEFINER: a relative and a staff record are filtered by branch, and
-- the rule must not depend on the row filter.

-- A parent account: an account linked to a relative.
create function is_parent_account(account_id uuid) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.relative_accounts r where r.account_id = is_parent_account.account_id
  )
$$;

create function relative_accounts_not_staff() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.account_id is null then
    return new;
  end if;
  if exists (select 1 from public.staff s where s.account_id = new.account_id) then
    raise exception 'parent_account_staff'
      using errcode = 'check_violation', constraint = 'parent_account_staff';
  end if;
  if exists (select 1 from public.assignments a where a.account_id = new.account_id) then
    raise exception 'parent_account_assigned'
      using errcode = 'check_violation', constraint = 'parent_account_assigned';
  end if;
  return new;
end
$$;

revoke execute on function relative_accounts_not_staff() from public;

create trigger relative_accounts_not_staff
  before update of account_id on relative_accounts
  for each row execute function relative_accounts_not_staff();

create function assignments_not_parent() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.is_parent_account(new.account_id) then
    raise exception 'assignment_parent_account'
      using errcode = 'check_violation', constraint = 'assignment_parent_account';
  end if;
  return new;
end
$$;

revoke execute on function assignments_not_parent() from public;

create trigger assignments_not_parent
  before insert or update of account_id on assignments
  for each row execute function assignments_not_parent();

create function staff_not_parent() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.account_id is not null and public.is_parent_account(new.account_id) then
    raise exception 'staff_parent_account'
      using errcode = 'check_violation', constraint = 'staff_parent_account';
  end if;
  return new;
end
$$;

revoke execute on function staff_not_parent() from public;

create trigger staff_not_parent
  before insert or update of account_id on staff
  for each row execute function staff_not_parent();

-- Whether a student is active on the date of a moment, in the time zone of the student's
-- branch. SECURITY DEFINER: sign-in comes before any branch is known.
create function student_active_at(student_id uuid, at timestamptz) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.student_statuses st
    join public.branches br on br.id = st.branch_id
    where st.student_id = student_active_at.student_id
      and st.status = 'active'
      and st.valid_from <= (student_active_at.at at time zone br.time_zone)::date
      and (
        st.valid_until is null
        or st.valid_until > (student_active_at.at at time zone br.time_zone)::date
      )
  )
$$;

-- Whether a parent account can no longer sign in at a moment (decision 6): its relative is
-- archived or merged, or has no live link with portal access on to a student active on that
-- date. False for an account that is not a parent's. Read by sign-in and by every request
-- of a parent session.
create function parent_account_blocked(account_id uuid, at timestamptz) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.relative_accounts ra
    join public.relatives r on r.id = ra.relative_id
    where ra.account_id = parent_account_blocked.account_id
      and (
        r.archived_at is not null
        or r.merged_into is not null
        or not exists (
          select 1
          from public.student_relatives l
          where l.relative_id = r.id
            and l.unlinked_at is null
            and l.portal_access
            and public.student_active_at(l.student_id, parent_account_blocked.at)
        )
      )
  )
$$;

-- The full name of the relative of a parent account, for the session answer (as
-- `own_person_name` of 0027 for staff). The route gives no name while a step is owed.
create function own_relative_name(account_id uuid) returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.full_name
  from public.relative_accounts ra
  join public.relatives r on r.id = ra.relative_id
  where ra.account_id = own_relative_name.account_id
$$;

-- The slips printed for a Parent account: who printed which for which class, and until when
-- it is valid. Never the password or its hash (decision 9). A branch table, append-only for
-- the application.
create table parent_slips (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  account_id uuid not null references accounts (id),
  relative_id uuid not null references relatives (id),
  -- The class printed; empty for a reset.
  class_id uuid,
  kind text not null constraint parent_slips_kind_check check (kind in ('first', 'reset')),
  language text not null constraint parent_slips_language_check check (
    language in ('uz', 'ru', 'en')
  ),
  -- From the real clock, as the password's end (task 10.5, decision 1).
  printed_at timestamptz not null,
  valid_until timestamptz not null,
  printed_by uuid not null references accounts (id),
  assignment_id uuid not null references assignments (id),
  constraint parent_slips_class_check check ((kind = 'first') = (class_id is not null)),
  constraint parent_slips_valid_check check (valid_until > printed_at),
  constraint parent_slips_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id)
);

create index parent_slips_account_idx on parent_slips (account_id, printed_at desc);
create index parent_slips_branch_idx on parent_slips (branch_id);

alter table parent_slips enable row level security;
create policy branch_filter on parent_slips for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on parent_slips to sodiq_app;

-- The newest slip of a Parent account, whatever its branch (must-fix 1 of the spec review:
-- a slip of another branch must be seen, or a print there would replace a password the
-- family holds). Valid while its end is ahead of `at` and the account still has the
-- password to change. The class is named only for a slip of `branch_id`; a slip of another
-- branch answers `other_branch` and no class (decision 15). Called only by routes that
-- checked the relative against the branch of the request.
create function parent_slip_state(account_id uuid, branch_id uuid, at timestamptz)
returns table (
  kind text,
  printed_at timestamptz,
  valid_until timestamptz,
  valid boolean,
  other_branch boolean,
  class_id uuid,
  class_name text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    s.kind,
    s.printed_at,
    s.valid_until,
    s.valid_until > parent_slip_state.at and a.must_change_password,
    s.branch_id <> parent_slip_state.branch_id,
    case when s.branch_id = parent_slip_state.branch_id then s.class_id end,
    case when s.branch_id = parent_slip_state.branch_id then c.name end
  from public.parent_slips s
  join public.accounts a on a.id = s.account_id
  left join public.classes c on c.id = s.class_id
  where s.account_id = parent_slip_state.account_id
  order by s.printed_at desc, s.id desc
  limit 1
$$;
