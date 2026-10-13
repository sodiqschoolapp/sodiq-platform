-- 0039 The audit log screen and the own sign-in history (task 2.6a).
--
-- docs/spec/edge-cases/people-roles-accounts.md, Personal data and the audit
-- log: "The Super Admin reads all; the Principal and Academic Vice Principal
-- read their branch; every user sees their own sign-in history ... It can be
-- searched by person, record and date." The log stays insert and select only
-- for sodiq_app (edge-cases/developer-rules.md, History and audit).

-- The school-wide entries written by a request of a branch carry the branch in
-- `details.branchId` (task 2.5a, decision 17): the branch's readers read them
-- (pull request #75, decision 3).
create index audit_log_school_branch_idx
  on audit_log_school ((details ->> 'branchId'), occurred_at);

-- The date search of the Super Admin across every branch and school-wide.
create index audit_log_occurred_idx on audit_log (occurred_at);
create index audit_log_school_occurred_idx on audit_log_school (occurred_at);

-- The sign-in events of one account, from both logs, newest first, one page
-- after a cursor (pull request #75, decision 10). SECURITY DEFINER: an
-- administrator's lock or reset of the account is written to the log of the
-- administrator's branch, which a route of the own account (no branch) cannot
-- read through the row filter. `auth.*` events match by their actor or by the
-- account as their record; `account.*` events by the record only, so an
-- administrator never reads in their own history what they did to another
-- account. Answers no value, detail or reason: the moment, the event, who
-- acted, and the browser of the session of a sign-in.
create function own_sign_in_history(
  account uuid,
  before_at timestamptz,
  before_id uuid,
  page integer
)
returns table (
  id uuid,
  occurred_at timestamptz,
  action text,
  actor_id uuid,
  user_agent text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with entries as (
    select l.id, l.occurred_at, l.action, l.actor_id, l.record_type, l.record_id
    from public.audit_log l
    where l.action like 'account.%'
      and l.record_type = 'account' and l.record_id = own_sign_in_history.account
    union all
    select l.id, l.occurred_at, l.action, l.actor_id, l.record_type, l.record_id
    from public.audit_log_school l
    where (
      l.action like 'auth.%'
      and (
        l.actor_id = own_sign_in_history.account
        or (l.record_type = 'account' and l.record_id = own_sign_in_history.account)
      )
    ) or (
      l.action like 'account.%'
      and l.record_type = 'account' and l.record_id = own_sign_in_history.account
    )
  )
  select e.id, e.occurred_at, e.action, e.actor_id,
    case when e.action = 'auth.sign_in' then s.user_agent end as user_agent
  from entries e
  left join public.sessions s
    on e.record_type = 'session' and s.id = e.record_id
    and s.account_id = own_sign_in_history.account
  where e.action in (
      'auth.sign_in', 'auth.sign_in_failed', 'auth.sign_in_locked', 'auth.sign_in_inactive',
      'auth.second_step_passed', 'auth.second_step_failed', 'auth.recovery_code_used',
      'auth.sign_out', 'auth.sign_out_everywhere', 'auth.session_idle', 'auth.session_expired',
      'auth.device_trusted', 'auth.trust_ended', 'auth.trusted_device_removed',
      'auth.password_change', 'auth.password_change_failed', 'auth.password_reset_requested',
      'auth.password_reset_by_email', 'account.password_reset', 'account.rehire_password',
      'account.locked', 'account.unlocked', 'account.second_step_on', 'account.second_step_off',
      'account.second_step_reset'
    )
    and (
      own_sign_in_history.before_at is null
      or (e.occurred_at, e.id) < (own_sign_in_history.before_at, own_sign_in_history.before_id)
    )
  order by e.occurred_at desc, e.id desc
  limit least(greatest(own_sign_in_history.page, 1), 100)
$$;

-- The first and last name of each person named by an account id or a staff
-- id, in any branch (pull request #75, decision 12, Look first): the actor and
-- the person of the entries of one page of the log. The Basic group only,
-- nothing else of the record; a vacancy and an unknown id answer nothing.
create function audit_names(ids uuid[])
returns table (id uuid, first_name text, last_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (x.id) x.id, s.first_name, s.last_name
  from unnest(audit_names.ids) as x (id)
  join public.staff s on (s.id = x.id or s.account_id = x.id) and s.kind = 'person'
  order by x.id, s.id
$$;

revoke execute on function own_sign_in_history(uuid, timestamptz, uuid, integer) from public;
revoke execute on function audit_names(uuid[]) from public;
grant execute on function own_sign_in_history(uuid, timestamptz, uuid, integer) to sodiq_app;
grant execute on function audit_names(uuid[]) to sodiq_app;
