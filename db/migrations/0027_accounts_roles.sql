-- 0027 Accounts and roles (task 2.3a, pull request #62).
--
-- docs/spec/edge-cases/people-roles-accounts.md, Who can act: "The Super
-- Admin creates staff accounts and gives all roles"; rights are assignments
-- with dates. Accounts and sign-in: "Logins are generated (for example
-- a.karimov) and never reused"; "The system refuses to lock or remove the
-- last active Super Admin". The owner's answer 14 (docs/decisions.md,
-- "Decided ahead for tasks 2.1 to 2.6") adds the login forms akmal.karimov
-- and akmal.b.karimov. 0.7a (docs/decisions.md): "an end that has passed is
-- final, an end that is still ahead may be moved while it is still ahead".

-- The login forms of answer 14 (decision 2 of #62, Look first): one, two or
-- three parts of letters joined by dots, then a number. Widened because the
-- owner's answer changed the requirement; the login stays unique and the
-- application still cannot change it, so a login is never reused. `accounts`
-- is small and the migration runs in one transaction.
alter table accounts drop constraint accounts_login_check;
alter table accounts add constraint accounts_login_check check (
  login ~ '^[a-z]+(\.[a-z]+){1,2}[0-9]*$' and char_length(login) <= 64
);

-- An account is linked to its staff record once (2.2a; the trigger
-- staff_account_link_guard of 0024 keeps the link).
grant update (account_id) on staff to sodiq_app;

-- The end of an assignment (decision 3 of #62). The moment of the
-- transaction is `app.now`, which `Transactions.run` sets from the injected
-- clock, so the rule follows the clock the application and its tests use,
-- never the database's. For the application user:
-- - without `app.now` an end is not written;
-- - an end at or before that moment has passed and is final;
-- - a new end is not before 00:00 of that day in the time zone of the
--   assignment's branch (of the school for the two roles without one), so a
--   person who leaves today loses the roles from 00:00 (2.2a, decision 15)
--   and no end rewrites an earlier day.
-- An end still ahead may be moved or emptied (a planned `left` taken back).
-- The migrator (migrations, the set-up of tests) is not checked. Runs as the
-- invoker: it reads `current_user`.
create function assignments_end_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  zone text;
  day_start timestamptz;
begin
  if current_user <> 'sodiq_app' or new.valid_until is not distinct from old.valid_until then
    return new;
  end if;
  moment := nullif(current_setting('app.now', true), '')::timestamptz;
  if moment is null then
    raise exception 'assignment_end_needs_moment'
      using errcode = 'check_violation', constraint = 'assignment_end_needs_moment';
  end if;
  if old.valid_until is not null and old.valid_until <= moment then
    raise exception 'assignment_end_final'
      using errcode = 'check_violation', constraint = 'assignment_end_final';
  end if;
  if new.valid_until is not null then
    select b.time_zone into zone from branches b where b.id = new.branch_id;
    zone := coalesce(zone, 'Asia/Tashkent');
    day_start := date_trunc('day', moment at time zone zone) at time zone zone;
    if new.valid_until < day_start then
      raise exception 'assignment_end_past'
        using errcode = 'check_violation', constraint = 'assignment_end_past';
    end if;
  end if;
  return new;
end;
$$;

create trigger assignments_end_guard
  before update of valid_until on assignments
  for each row execute function assignments_end_guard();

-- The session answer shows the person's own name (pull request #61,
-- decision 6) and the name of the administrator who reset the password
-- (2.2a: "`passwordResetBy` becomes a name"). Sign-in comes before any branch
-- is known, so these answer through SECURITY DEFINER functions, each a first
-- and last name only (decision 9 of #62, Look first).

-- The first and last name of the staff record linked to the account.
create function own_person_name(account_id uuid)
returns table (first_name text, last_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.first_name, s.last_name
  from public.staff s
  where s.account_id = own_person_name.account_id and s.kind = 'person'
$$;

-- The first and last name of the staff record of the administrator who reset
-- the account's password, while the reset password is in use; nothing when
-- the password was not reset or that administrator has no record.
create function reset_by_person_name(account_id uuid)
returns table (first_name text, last_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.first_name, s.last_name
  from public.accounts a
  join public.staff s on s.account_id = a.password_reset_by and s.kind = 'person'
  where a.id = reset_by_person_name.account_id and a.must_change_password
$$;

-- The number of active Super Admins at a moment (decision 5 of #62): an
-- account with a Super Admin assignment that has begun and has no end, that
-- is not locked, and whose staff record (if any) has no inactive or left
-- status in force on the date of the moment, or planned after it, in the
-- time zone of its main branch. A Super Admin's record may be in any branch,
-- and the route asks with no branch: a number only.
create function super_admin_active_count(at timestamptz) returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(distinct a.account_id)::integer
  from public.assignments a
  join public.accounts ac on ac.id = a.account_id
  where a.role = 'super_admin'
    and a.valid_from <= super_admin_active_count.at
    and a.valid_until is null
    and ac.locked_at is null
    and not exists (
      select 1
      from public.staff s
      join public.staff_branches b on b.staff_id = s.id and b.is_main
      join public.branches br on br.id = b.branch_id
      join public.staff_statuses st on st.staff_id = s.id
      where s.account_id = a.account_id
        and st.status in ('inactive', 'left')
        and st.valid_until is distinct from st.valid_from
        and (
          st.valid_until is null
          or st.valid_until > (super_admin_active_count.at at time zone br.time_zone)::date
        )
    )
$$;

revoke execute on function own_person_name(uuid) from public;
revoke execute on function reset_by_person_name(uuid) from public;
revoke execute on function super_admin_active_count(timestamptz) from public;
grant execute on function own_person_name(uuid) to sodiq_app;
grant execute on function reset_by_person_name(uuid) to sodiq_app;
grant execute on function super_admin_active_count(timestamptz) to sodiq_app;
