-- 0178 The assistant: settings, conversations, messages, model calls and
-- restores (task 11.12, pull request #374; the owner's spec change of
-- 21 November 2026).
--
-- 02, Assistant: "The Super Admin can switch it off for the whole school or
-- for one of the three roles; it is off until switched on." Limits: "A limit
-- of requests per person per day, and a monthly spending cap for the school:
-- $300 at the start." Audit: "The conversation is kept ... 90 days after its
-- last message a conversation is archived ... Conversations are never
-- deleted."
--
-- Five new tables, no existing row changes (stop-list item 3). Every table but
-- the settings is insert-only for the application (no update, no delete
-- grant), and every table of a conversation carries its branch with the
-- branch filter (CLAUDE.md, Branch on every row). Archived is never stored:
-- it is read from the moments of the last message and the last restore,
-- compared with the clock on each request (plan decision 8).

create table assistant_settings (
  id boolean primary key default true constraint assistant_settings_one_row check (id),
  school_on boolean not null default false,
  -- ASSISTANT_ROLES of packages/shared.
  roles_on text[] not null default '{}' constraint assistant_settings_roles_check check (
    roles_on <@ array['super_admin', 'academic_vice_principal', 'teacher']::text[]
  ),
  daily_limit integer not null default 30
    constraint assistant_settings_daily_limit_check check (daily_limit between 1 and 500),
  monthly_cap_dollars integer not null default 300
    constraint assistant_settings_cap_check check (monthly_cap_dollars between 1 and 100000)
);

insert into assistant_settings (id) values (true);

grant select on assistant_settings to sodiq_app;
grant update (school_on, roles_on, daily_limit, monthly_cap_dollars)
  on assistant_settings to sodiq_app;

create table assistant_conversations (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  account_id uuid not null references accounts (id),
  -- The chosen role the conversation was started in (plan decision 7).
  role text not null constraint assistant_conversations_role_check check (
    role in ('super_admin', 'academic_vice_principal', 'teacher')
  ),
  title text not null constraint assistant_conversations_title_check check (
    length(title) between 1 and 80
  ),
  -- From the injected clock (the transaction's moment), never now().
  created_at timestamptz not null,
  constraint assistant_conversations_owner_key unique (id, branch_id, account_id),
  constraint assistant_conversations_id_branch_key unique (id, branch_id)
);

create index assistant_conversations_account_idx on assistant_conversations (account_id);
create index assistant_conversations_branch_idx on assistant_conversations (branch_id);

alter table assistant_conversations enable row level security;
create policy branch_filter on assistant_conversations for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_conversations to sodiq_app;

create table assistant_messages (
  id uuid primary key default uuidv7(),
  conversation_id uuid not null,
  branch_id uuid not null references branches (id),
  -- Copied from the conversation and held by the foreign key, so the daily
  -- count reads a guaranteed value (plan review, should fix 7).
  account_id uuid not null,
  constraint assistant_messages_conversation_fkey foreign key (conversation_id, branch_id, account_id)
    references assistant_conversations (id, branch_id, account_id),
  seq integer not null constraint assistant_messages_seq_check check (seq >= 1),
  constraint assistant_messages_seq_key unique (conversation_id, seq),
  kind text not null constraint assistant_messages_kind_check check (
    kind in ('question', 'answer', 'read', 'notice')
  ),
  -- A question: the text as typed; an answer: its text and pages; a read: the
  -- operation, arguments, status and the filtered result the model was given;
  -- a notice: its code.
  content jsonb not null constraint assistant_messages_content_check check (
    jsonb_typeof(content) = 'object'
  ),
  created_at timestamptz not null,
  constraint assistant_messages_id_branch_key unique (id, branch_id)
);

create index assistant_messages_account_idx on assistant_messages (account_id, created_at)
  where kind = 'question';

alter table assistant_messages enable row level security;
create policy branch_filter on assistant_messages for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_messages to sodiq_app;

-- One row per call of the model: a question with reads makes several, and a
-- call that failed after it was billed is a row too (plan review, must fix 5).
create table assistant_model_calls (
  id uuid primary key default uuidv7(),
  -- The question the call answered.
  message_id uuid not null,
  branch_id uuid not null references branches (id),
  constraint assistant_model_calls_message_fkey foreign key (message_id, branch_id)
    references assistant_messages (id, branch_id),
  model text not null constraint assistant_model_calls_model_check check (
    length(model) between 1 and 200
  ),
  tokens_in integer not null constraint assistant_model_calls_tokens_in_check check (tokens_in >= 0),
  -- Thinking tokens included: billed at the output price (plan decision 11).
  tokens_out integer not null
    constraint assistant_model_calls_tokens_out_check check (tokens_out >= 0),
  -- Whole micro-dollars, rounded up once per call.
  cost_micros bigint not null constraint assistant_model_calls_cost_check check (cost_micros >= 0),
  created_at timestamptz not null
);

create index assistant_model_calls_created_idx on assistant_model_calls (created_at);

alter table assistant_model_calls enable row level security;
create policy branch_filter on assistant_model_calls for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_model_calls to sodiq_app;

create table assistant_conversation_restores (
  id uuid primary key default uuidv7(),
  conversation_id uuid not null,
  branch_id uuid not null references branches (id),
  constraint assistant_conversation_restores_conversation_fkey foreign key (conversation_id, branch_id)
    references assistant_conversations (id, branch_id),
  restored_by uuid not null references accounts (id),
  restored_at timestamptz not null
);

create index assistant_conversation_restores_conversation_idx
  on assistant_conversation_restores (conversation_id, restored_at);

alter table assistant_conversation_restores enable row level security;
create policy branch_filter on assistant_conversation_restores for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_conversation_restores to sodiq_app;

-- The person's questions between two moments, in every branch: the daily
-- limit counts the whole school day while a request's filter holds one branch.
-- A count only, no row.
create function assistant_questions_between(account uuid, from_moment timestamptz, until_moment timestamptz)
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
    and m.created_at >= assistant_questions_between.from_moment
    and m.created_at < assistant_questions_between.until_moment
$$;

revoke execute on function assistant_questions_between(uuid, timestamptz, timestamptz) from public;
grant execute on function assistant_questions_between(uuid, timestamptz, timestamptz) to sodiq_app;

-- The school's spend between two moments, every model call of every branch,
-- in whole micro-dollars. A sum only, no row.
create function assistant_spend_between(from_moment timestamptz, until_moment timestamptz)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(sum(c.cost_micros), 0)::bigint
  from public.assistant_model_calls c
  where c.created_at >= assistant_spend_between.from_moment
    and c.created_at < assistant_spend_between.until_moment
$$;

revoke execute on function assistant_spend_between(timestamptz, timestamptz) from public;
grant execute on function assistant_spend_between(timestamptz, timestamptz) to sodiq_app;
