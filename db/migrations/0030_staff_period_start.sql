-- 0030 The start of the current employment period of a staff record (task
-- 2.3c-1, pull request #65).
--
-- docs/spec/edge-cases/people-roles-accounts.md, Staff over time:
-- "Re-hiring restores the same record, staff ID and login with a new
-- employment period"; Accounts and sign-in: "A report lists accounts never
-- used". An account counts as never used when no session was opened since
-- the start of its person's current employment period (decision 10 with
-- correction 2 of the review of #65): 00:00, in the time zone of the record's
-- main branch, of the `valid_from` of the first `active` or `inactive` row
-- after the latest `left` that has begun; of the first row when there was no
-- such `left`; of that `left` itself while no return follows it. A row taken
-- back before it began (`valid_until = valid_from`) was never in force.
--
-- SECURITY DEFINER so that every reader gets the same answer: the main branch
-- link and its branch may be hidden by the membership filter from a reader of
-- another branch (found by the review of #65). It answers one moment about
-- one record and does not read app_branch_ids().
create function staff_period_start(record_id uuid, at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with zone as (
    select coalesce(
      (
        select br.time_zone
        from public.staff_branches b
        join public.branches br on br.id = b.branch_id
        where b.staff_id = staff_period_start.record_id and b.is_main
      ),
      'Asia/Tashkent'
    ) as tz
  ),
  rows as (
    select st.status, st.valid_from
    from public.staff_statuses st
    where st.staff_id = staff_period_start.record_id
      and (st.valid_until is null or st.valid_until <> st.valid_from)
  ),
  latest_left as (
    select max(r.valid_from) as day
    from rows r, zone z
    where r.status = 'left' and r.valid_from <= (staff_period_start.at at time zone z.tz)::date
  ),
  start as (
    select case
      when l.day is null then (select min(r.valid_from) from rows r)
      else coalesce(
        (
          select min(r.valid_from)
          from rows r
          where r.status in ('active', 'inactive') and r.valid_from > l.day
        ),
        l.day
      )
    end as day
    from latest_left l
  )
  select (s.day::timestamp at time zone z.tz)
  from start s, zone z
  where s.day is not null
$$;

revoke execute on function staff_period_start(uuid, timestamptz) from public;
grant execute on function staff_period_start(uuid, timestamptz) to sodiq_app;
