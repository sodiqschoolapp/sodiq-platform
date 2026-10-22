-- 0112 The resets of the report of entries after a reset (task 6.1c, pull
-- request #209).
--
-- docs/spec/edge-cases/people-roles-accounts.md, Accounts and sign-in: "A
-- report lists entries made within 48 hours of a reset. ... A password reset
-- by email that follows a change of the email by somebody else is listed in
-- the same report."
--
-- The plan approved on pull request #209 with corrections 1 to 5: decisions
-- 1, 3, 4 and 6. One account serves every branch, so a reset written in the
-- log of one branch opens the account in all of them; the readers of a branch
-- must see it to check the branch's entries, and the row filter hides another
-- branch's log from them (decision 1, Look first). The function answers ids,
-- kinds and moments only, never the entries' other values; names come through
-- `audit_names` (0039).

-- The resets in [from_at, to_at) of the accounts of the staff records (people,
-- not vacancies) linked to `branch_ref`, and of any account that wrote a cell
-- line of `branch_ref` within 48 hours of its reset, so that a link taken off
-- later does not hide the entries (decision 6). The administrator's reset
-- (also written by the second-step reset) goes to a branch's log, the re-hire
-- password and the email reset to the school's (decision 3); every kind is
-- read from both logs. For an email reset, the last email change the entry
-- itself names (`details.lastEmailChange`, by and at, 2.3c-2 decision 6) and
-- the action of the entry that wrote that email (`staff.create` or
-- `staff.edit`), read again by its moment and actor (decision 4, correction
-- 2). Called by the route with the branch of the request only.
create function password_resets_of_branch(branch_ref uuid, from_at timestamptz, to_at timestamptz)
returns table (
  entry_id uuid,
  account_id uuid,
  kind text,
  occurred_at timestamptz,
  actor_id uuid,
  email_change_by uuid,
  email_change_at timestamptz,
  email_change_action text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with resets as (
    select l.id, l.record_id, l.action, l.occurred_at, l.actor_id, l.details
    from public.audit_log l
    where l.action in ('account.password_reset', 'account.rehire_password', 'auth.password_reset_by_email')
      and l.record_type = 'account'
      and l.occurred_at >= from_at
      and l.occurred_at < to_at
    union all
    select l.id, l.record_id, l.action, l.occurred_at, l.actor_id, l.details
    from public.audit_log_school l
    where l.action in ('account.password_reset', 'account.rehire_password', 'auth.password_reset_by_email')
      and l.record_type = 'account'
      and l.occurred_at >= from_at
      and l.occurred_at < to_at
  ),
  changes as (
    select
      r.*,
      case
        when r.action = 'auth.password_reset_by_email'
          and jsonb_typeof(r.details -> 'lastEmailChange') = 'object'
        then r.details -> 'lastEmailChange'
      end as change
    from resets r
  )
  select
    c.id,
    c.record_id,
    case c.action
      when 'account.password_reset' then 'administrator'
      when 'account.rehire_password' then 'rehire'
      else 'email'
    end,
    c.occurred_at,
    c.actor_id,
    (c.change ->> 'by')::uuid,
    (c.change ->> 'at')::timestamptz,
    (
      select e.action
      from public.staff s
      join public.audit_log e on e.person_id = s.id
      where c.change is not null
        and s.account_id = c.record_id
        and s.kind = 'person'
        and e.action in ('staff.create', 'staff.edit')
        and e.new_value ? 'email'
        and e.occurred_at = (c.change ->> 'at')::timestamptz
        and e.actor_id is not distinct from (c.change ->> 'by')::uuid
      order by e.id desc
      limit 1
    )
  from changes c
  where exists (
      select 1
      from public.staff s
      join public.staff_branches b on b.staff_id = s.id
      where s.account_id = c.record_id
        and s.kind = 'person'
        and b.branch_id = branch_ref
    )
    or exists (
      select 1
      from public.journal_cell_history h
      where h.branch_id = branch_ref
        and h.changed_by = c.record_id
        and h.changed_at >= c.occurred_at
        and h.changed_at < c.occurred_at + interval '48 hours'
    )
$$;

revoke execute on function password_resets_of_branch(uuid, timestamptz, timestamptz) from public;
grant execute on function password_resets_of_branch(uuid, timestamptz, timestamptz) to sodiq_app;
