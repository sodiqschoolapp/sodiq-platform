-- 0184 The assistant's limits as settings, Continue and Undo (task 11.21,
-- pull request #388; the owner's spec change of 25 November 2026).
--
-- 02, Assistant, Limits: "The Super Admin also sets, on the Assistant settings
-- page: requests per person per day (none at the start), reads and changes in
-- one question (40 at the start), changes in one proposal (100 at the start),
-- and the time for one question (10 minutes at the start)." Answers: "A long
-- piece of work goes on in parts". Reading and proposing: "A confirmed
-- proposal can be undone".
--
-- Columns added with their defaults, as 0180 added fallback_on, checks
-- replaced by wider ones (the requirement changed; plan decision 1, Look
-- first) and two functions replaced. No stored value changes: the settings
-- row keeps its daily limit (plan decision 3, Look first; stop-list item 3).

-- The three new limits, with the bounds of packages/shared.
alter table assistant_settings
  add column question_actions integer not null default 40
    constraint assistant_settings_question_actions_check check (question_actions between 1 and 200),
  add column proposal_steps integer not null default 100
    constraint assistant_settings_proposal_steps_check check (proposal_steps between 1 and 200),
  add column question_minutes integer not null default 10
    constraint assistant_settings_question_minutes_check check (question_minutes between 1 and 30);

-- 0: no daily limit. The column default only: the stored row is not changed.
alter table assistant_settings drop constraint assistant_settings_daily_limit_check;
alter table assistant_settings
  add constraint assistant_settings_daily_limit_check check (daily_limit between 0 and 500);
alter table assistant_settings alter column daily_limit set default 0;

grant update (question_actions, proposal_steps, question_minutes) on assistant_settings to sodiq_app;

-- The steps of one proposal: up to the bound of the setting (review of the
-- plan, corrections 1 and 2: the array check kept beside the wider length).
alter table assistant_proposals drop constraint assistant_proposals_steps_check;
alter table assistant_proposals
  add constraint assistant_proposals_steps_check check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 1 and 200
  );

alter table assistant_proposal_steps drop constraint assistant_proposal_steps_seq_check;
alter table assistant_proposal_steps
  add constraint assistant_proposal_steps_seq_check check (seq between 1 and 200);

-- The id a done create step's answer gave, kept for its Undo.
alter table assistant_proposal_steps add column record_id uuid;

-- The end of a question's answer window: its stored moment, the time limit
-- set at that moment and 30 s (plan decision 5). Null on a question stored
-- before: its window stays 270 s.
alter table assistant_messages add column answer_until timestamptz;
alter table assistant_messages
  add constraint assistant_messages_answer_until_check check (
    answer_until is null or (kind = 'question' and answer_until > created_at)
  );

-- Whether a question of the account is still being answered at `at` (the
-- moment of the request, from the injected clock): no answer and no notice
-- after it in its conversation, and its window not past. Bounded below by the
-- longest window (30 minutes and 30 s). A yes or no, never row data.
drop function assistant_question_running(uuid, timestamptz);

create function assistant_question_running(account uuid, at timestamptz)
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
      and q.created_at > assistant_question_running.at - interval '30 minutes 30 seconds'
      and coalesce(q.answer_until, q.created_at + interval '270 seconds')
        > assistant_question_running.at
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

-- The person's questions between two moments, every branch together; an Undo
-- (a question naming the proposal it undoes) calls no model and is not
-- counted (plan decision 9).
create or replace function assistant_questions_between(account uuid, from_moment timestamptz, until_moment timestamptz)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)
  from public.assistant_messages m
  where m.account_id = assistant_questions_between.account
    and m.kind = 'question'
    and not (m.content ? 'undoOf')
    and m.created_at >= assistant_questions_between.from_moment
    and m.created_at < assistant_questions_between.until_moment
$$;
