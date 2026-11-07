-- 0164 The child the bot's message of an announcement opens (task 11.7, pull request #306).
--
-- Spec review of the code, should-fix 6: the plan approved on #306 says the bot's button opens
-- the announcements "of the first child (by last and first name) the announcement reaches". The
-- recipients function of 0163 (spec review of the plan, should-fix 7: one place for the audience
-- rule) also answers that child's id, never a name. The same arguments and the same test; only
-- the column is added, so the function is made again.
--
-- Nothing here changes or removes a row: a function and its grants.

drop function announcement_recipients(uuid, timestamptz, uuid);

create function announcement_recipients(
  announcement_id uuid,
  at timestamptz,
  only_account uuid default null
)
returns table (account_id uuid, telegram_link_id uuid, student_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select t.account_id, t.id, first_child.student_id
  from public.announcements a
  join public.telegram_links t on t.ended_at is null
  cross join lateral (
    select k.student_id
    from public.portal_children(t.account_id, announcement_recipients.at) k
    where exists (
        select 1
        from public.relative_accounts ra
        join public.student_relatives l on l.relative_id = ra.relative_id
        where ra.account_id = t.account_id
          and l.student_id = k.student_id
          and l.unlinked_at is null
          and l.portal_access
          and l.receives_notices
      )
      and case a.audience
        when 'school' then true
        when 'branch' then k.branch_id = a.branch_id
        when 'grades' then k.branch_id = a.branch_id and k.class_grade = any (a.grades)
        when 'classes' then exists (
          select 1 from public.announcement_classes c
          where c.announcement_id = a.id and c.class_id = k.class_id
        )
        else false
      end
    order by k.last_name, k.first_name, k.student_id
    limit 1
  ) first_child
  where a.id = announcement_recipients.announcement_id
    and a.for_parents
    and a.archived_at is null
    and (announcement_recipients.only_account is null
      or t.account_id = announcement_recipients.only_account)
  order by t.account_id
$$;

revoke execute on function announcement_recipients(uuid, timestamptz, uuid) from public;
grant execute on function announcement_recipients(uuid, timestamptz, uuid) to sodiq_app;
