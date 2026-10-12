-- 0029 The branches without an active Academic Vice Principal (task 2.3b-2,
-- pull request #64).
--
-- docs/spec/edge-cases/people-roles-accounts.md, Who can act: "The Academic
-- Vice Principal is ill for three weeks at the end of a quarter, or the post
-- is vacant ... a branch with no active Academic Vice Principal shows an
-- alert to the Super Admin."
--
-- The alert's route is school-wide (no branch), where the membership filter
-- hides every staff row, so the answer is read here (decision 1 of #64, Look
-- first): the branches, id and name only, where no Academic Vice Principal
-- is active at the moment given. Active (decisions 2 and 3): the assignment
-- of that branch has begun and not ended (a planned end keeps it active until
-- it comes), the account is not locked, and the staff record linked to the
-- account is not inactive or left on that day, read by `staff_account_blocked`
-- (0024), the check of sign-in, in the time zone of the record's main branch.
-- An account with no linked record counts as active, as for sign-in.
--
-- Branches cannot be archived yet (decision 4); when they can, this function
-- leaves the archived ones out (a test of branches-without-vice pins it).
create function branches_without_vice_principal(at timestamptz)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select br.id, br.name
  from public.branches br
  where not exists (
    select 1
    from public.assignments a
    join public.accounts ac on ac.id = a.account_id
    where a.role = 'academic_vice_principal'
      and a.branch_id = br.id
      and a.valid_from <= branches_without_vice_principal.at
      and (a.valid_until is null or a.valid_until > branches_without_vice_principal.at)
      and ac.locked_at is null
      and not public.staff_account_blocked(a.account_id, branches_without_vice_principal.at)
  )
  order by br.name, br.id
$$;

revoke execute on function branches_without_vice_principal(timestamptz) from public;
grant execute on function branches_without_vice_principal(timestamptz) to sodiq_app;
