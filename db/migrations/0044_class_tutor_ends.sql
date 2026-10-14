-- 0044 The Tutor rows of one assignment past the branch filter, for the audit
-- entry of a change of the role's end (task 3.1a, pull request #88, code
-- review round 1, finding 1).
--
-- Plan decision 20 as confirmed: "A role end, a `left` and an archive that
-- end Tutor rows name them in their own audit entry". A role end is written
-- school-wide (`assignments` has no policy) and the mirror
-- `assignments_class_tutors_end` (0042, 0043) moves the Tutor rows of every
-- branch, but the transaction of an Academic Vice Principal sees only the
-- branch of the request. This function answers the rows of one assignment in
-- any branch, ids and moments only, so that the entry names every row the
-- mirror moved. .claude/rules/database.md: what a cascade changes elsewhere
-- is kept in the audit entry.
create function class_tutor_ends(assignment_id uuid)
returns table (id uuid, class_id uuid, valid_until timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select t.id, t.class_id, t.valid_until
  from public.class_tutors t
  where t.assignment_id = class_tutor_ends.assignment_id
  order by t.id
$$;

revoke execute on function class_tutor_ends(uuid) from public;
grant execute on function class_tutor_ends(uuid) to sodiq_app;
