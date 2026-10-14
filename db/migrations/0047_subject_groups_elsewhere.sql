-- 0047 The groups of other branches a subject change meets (task 3.2a, pull
-- request #91, decision 16 with the review's note: the refusal reaching an
-- Academic Vice Principal whose branch holds none of those groups names "a
-- group of another branch" and a count, never a group).
--
-- `subject_group_grades` (0046) answers per grade, so a group of two grades
-- would be counted twice; this function counts the groups themselves: the
-- active groups of a subject outside the branches of the transaction that a
-- change to `grades` leaves with a grade the subject no longer teaches, or,
-- for an archive, every such group. A count only: no group of another branch
-- is named (decision 12, Look first).
create function subject_groups_elsewhere(subject uuid, grades smallint[], archive boolean)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)::integer
  from public.groups g
  where g.subject_id = subject_groups_elsewhere.subject
    and g.archived_at is null
    and not (g.branch_id = any (public.app_branch_ids()))
    and (
      subject_groups_elsewhere.archive
      or exists (
        select 1
        from public.group_classes gc
        join public.classes c on c.id = gc.class_id
        where gc.group_id = g.id and not (c.grade = any (subject_groups_elsewhere.grades))
      )
    )
$$;

revoke execute on function subject_groups_elsewhere(uuid, smallint[], boolean) from public;
grant execute on function subject_groups_elsewhere(uuid, smallint[], boolean) to sodiq_app;
