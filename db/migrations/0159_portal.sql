-- 0159 The portal: the children a Parent account may see (task 11.2, pull request #294; the
-- owner's spec change of 6 November 2026).
--
-- docs/spec/10-portal-notifications-release-2.md, What parents see: "A parent sees each linked
-- student whose link has portal access switched on ... A link with portal access off shows
-- nothing of that child, in the portal or in the digest, from the next request. A student who
-- left the school is not shown." "A parent never sees ... another student's data."
-- Build plan 11.2: "one child-scope check used by every portal route and every message later:
-- an open link, portal access on, the student active; checked on every request, never cached
-- across requests"; the child is shown "in any branch".
--
-- Plan of #294, approved: decision 3 (a child's data in any branch, the branch taken from
-- these readers, never from a header), decision 4 (every refusal of the scope is a 404),
-- decision 6 (each date read in the branch of the child's class membership on that date).
--
-- Nothing here changes or removes a row: two read-only functions and their grants.

-- The students a Parent account may see at a moment, with the class of each on the date of
-- the moment in its branch's time. The same rule as `parent_account_blocked` (0158): an account
-- is blocked exactly when this answers no row (a test pins it). SECURITY DEFINER: relatives
-- are school-wide and a child's rows may be in any branch; the session of a parent names no
-- branch. Nothing of the student beyond the names and the class leaves it.
create function portal_children(account_id uuid, at timestamptz)
returns table (
  student_id uuid,
  branch_id uuid,
  first_name text,
  last_name text,
  class_id uuid,
  class_grade smallint,
  class_name text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (s.id)
    s.id,
    s.branch_id,
    s.first_name,
    s.last_name,
    c.id,
    c.grade::smallint,
    c.name
  from public.relative_accounts ra
  join public.relatives r on r.id = ra.relative_id
  join public.student_relatives l on l.relative_id = r.id
  join public.students s on s.id = l.student_id
  join public.branches b on b.id = s.branch_id
  left join public.class_memberships m
    on m.student_id = s.id
    and m.valid_from <= (portal_children.at at time zone b.time_zone)::date
    and m.valid_until > (portal_children.at at time zone b.time_zone)::date
  left join public.classes c on c.id = m.class_id
  where ra.account_id = portal_children.account_id
    and r.archived_at is null
    and r.merged_into is null
    and l.unlinked_at is null
    and l.portal_access
    and public.student_active_at(s.id, portal_children.at)
  order by s.id, m.valid_from desc
$$;

revoke execute on function portal_children(uuid, timestamptz) from public;
grant execute on function portal_children(uuid, timestamptz) to sodiq_app;

-- The branches of a child's class memberships over a span of dates, each with the part of the
-- span it covers, half-open `[valid_from, valid_until)` as the memberships are. A branch move
-- accepted ahead keeps the old branch's memberships until it takes effect (0053), so a week
-- can lie in two branches. Nothing when the student is not in the account's scope at the
-- moment: the scope is read again here, in the same statement.
create function portal_child_branches(
  account_id uuid,
  student_id uuid,
  from_date date,
  to_date date,
  at timestamptz
)
returns table (branch_id uuid, valid_from date, valid_until date)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.branch_id, greatest(m.valid_from, from_date), least(m.valid_until, to_date + 1)
  from public.class_memberships m
  where m.student_id = portal_child_branches.student_id
    and m.valid_from < m.valid_until
    and m.valid_from <= to_date
    and m.valid_until > from_date
    and exists (
      select 1
      from public.portal_children(portal_child_branches.account_id, portal_child_branches.at) k
      where k.student_id = portal_child_branches.student_id
    )
  order by m.valid_from
$$;

revoke execute on function portal_child_branches(uuid, uuid, date, date, timestamptz) from public;
grant execute on function portal_child_branches(uuid, uuid, date, date, timestamptz) to sodiq_app;
