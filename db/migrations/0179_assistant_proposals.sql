-- 0179 The assistant's proposals, their decisions and the outcome of each
-- step, and the step an audit entry was written by (task 11.13, pull request
-- #376; the owner's spec change of 21 November 2026).
--
-- 02, Assistant, Reading and proposing: "A change is never made by the
-- assistant alone: it is shown as a proposal ... Nothing changes until the
-- person presses Confirm. Each change then goes through the same action as on
-- the screen, in order; the first change refused stops the rest ... A
-- proposal not confirmed within 15 minutes expires." Audit: "Every change
-- made through the assistant is recorded as the person's change, marked 'via
-- assistant', and the audit log shows the request it came from."
--
-- Three new tables and two nullable columns; no existing row changes
-- (stop-list item 3). The tables are insert-only for the application.
-- "Expired" is never stored: no decision and expires_at not after now,
-- compared with the clock on each request.

create table assistant_proposals (
  id uuid primary key default uuidv7(),
  conversation_id uuid not null,
  branch_id uuid not null references branches (id),
  account_id uuid not null,
  constraint assistant_proposals_conversation_fkey foreign key (conversation_id, branch_id, account_id)
    references assistant_conversations (id, branch_id, account_id),
  -- The question the proposal answers.
  question_id uuid not null,
  constraint assistant_proposals_question_fkey foreign key (question_id, branch_id)
    references assistant_messages (id, branch_id),
  role text not null constraint assistant_proposals_role_check check (
    role in ('super_admin', 'academic_vice_principal', 'teacher')
  ),
  -- The exact requests, 1 to 10, each with its id, made here so that the
  -- audit entries of a running step can name it.
  steps jsonb not null constraint assistant_proposals_steps_check check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 1 and 10
  ),
  -- From the injected clock (the transaction's moment), never now().
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint assistant_proposals_expiry_check check (
    expires_at = created_at + interval '15 minutes'
  ),
  constraint assistant_proposals_id_branch_key unique (id, branch_id),
  constraint assistant_proposals_owner_key unique (id, branch_id, account_id)
);

create index assistant_proposals_conversation_idx
  on assistant_proposals (conversation_id, created_at);

alter table assistant_proposals enable row level security;
create policy branch_filter on assistant_proposals for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_proposals to sodiq_app;

-- One decision per proposal, ever: two Confirms at the same moment meet on
-- the primary key, and the second is refused.
create table assistant_proposal_decisions (
  proposal_id uuid primary key,
  branch_id uuid not null references branches (id),
  account_id uuid not null,
  constraint assistant_proposal_decisions_proposal_fkey foreign key (proposal_id, branch_id, account_id)
    references assistant_proposals (id, branch_id, account_id),
  decision text not null constraint assistant_proposal_decisions_decision_check check (
    decision in ('confirmed', 'declined')
  ),
  decided_at timestamptz not null
);

alter table assistant_proposal_decisions enable row level security;
create policy branch_filter on assistant_proposal_decisions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_proposal_decisions to sodiq_app;

-- The outcome of each step of a confirmed proposal, written as the step ends.
create table assistant_proposal_steps (
  step_id uuid primary key,
  proposal_id uuid not null,
  branch_id uuid not null references branches (id),
  constraint assistant_proposal_steps_proposal_fkey foreign key (proposal_id, branch_id)
    references assistant_proposals (id, branch_id),
  seq integer not null constraint assistant_proposal_steps_seq_check check (seq between 1 and 10),
  constraint assistant_proposal_steps_seq_key unique (proposal_id, seq),
  state text not null constraint assistant_proposal_steps_state_check check (
    state in ('done', 'refused', 'outdated', 'not_run')
  ),
  -- The HTTP status the route answered, 0 when it was not sent.
  status integer not null constraint assistant_proposal_steps_status_check check (
    status between 0 and 599
  ),
  code text,
  created_at timestamptz not null
);

alter table assistant_proposal_steps enable row level security;
create policy branch_filter on assistant_proposal_steps for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_proposal_steps to sodiq_app;

-- The step an audit entry was written by (`Audit.record` reads it from the
-- request context). Nullable with no default: the catalog changes and no
-- partition is rewritten or scanned. No foreign key, as integration_key_id
-- (0176): one would be validated over every partition of the live log. The
-- insert grant of 0003 covers the new column; the tables stay append-only.
alter table audit_log add column assistant_step_id uuid;
alter table audit_log_school add column assistant_step_id uuid;
