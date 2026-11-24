-- 0181 Whether a question of a person is still being answered (task 11.16,
-- pull request #381; the owner's spec change of 24 November 2026).
--
-- 02, Assistant, While it works: "A question shows in the conversation the
-- moment it is sent"; edge/people-roles-accounts, "The same conversation is
-- open in the panel and on the Assistant page, or in two tabs": "A second
-- question sent while the first is still being answered is refused with a
-- short message; it is never lost or asked twice."
--
-- "Being answered" is a fact of the person, in every branch, so it is read past
-- the row filter, as the daily count of 0178 is (spec review of the plan, must
-- fix 1): a question of the account asked after `since` (the moment of the
-- request less the answer window, given by the caller from the injected clock;
-- no now() here: a question is answered while now < its moment + the window) with no answer and no notice after it in its
-- conversation. A proposal is stored with its answer, so it is covered. A yes
-- or no, never row data. A function only: no existing row changes.

create function assistant_question_running(account uuid, since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.assistant_messages q
    where q.account_id = assistant_question_running.account
      and q.kind = 'question'
      and q.created_at > assistant_question_running.since
      and not exists (
        select 1
        from public.assistant_messages a
        where a.conversation_id = q.conversation_id
          and a.seq > q.seq
          and a.kind in ('answer', 'notice')
      )
  )
$$;

revoke execute on function assistant_question_running(uuid, timestamptz) from public;
grant execute on function assistant_question_running(uuid, timestamptz) to sodiq_app;
