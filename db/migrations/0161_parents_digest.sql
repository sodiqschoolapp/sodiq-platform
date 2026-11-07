-- 0161 The parents' digest (task 11.5, pull request #299; the owner's spec change of
-- 6 November 2026; docs/spec/10-portal-notifications-release-2.md, The parents' digest).
--
-- "Parents receive notices as messages from the school's bot, gathered in a digest." The
-- school's time of day and quiet hours (the Super Admin), the parent's frequency, one digest per
-- Parent account and Tashkent school date with its send log, the children it named and what it
-- carried, so a value changed or removed after it was sent is listed again once.
--
-- Accounts, relatives and Telegram links are school-wide (0005, 0036, 0160), and a parent's
-- digest covers children in several branches: these tables have no branch column and are read
-- by the Super Admin alone (plan decision 11). The journal is read in transactions of the
-- child's branches only.
--
-- Nothing here changes or removes an existing row: new tables, the first row of a new table,
-- one nullable column, functions and grants.

-- ---------------------------------------------------------------------------
-- The school's settings of the digest: one row (named in SCHOOL_WIDE_TABLES). `10`: "The Super
-- Admin sets the time of day for the whole school"; "the quiet hours are set by the Super Admin
-- (21:00 to 08:00 by default)". Times are Tashkent clock times. When and by whom they changed
-- is read from the audit log.

create function digest_in_quiet(at_time time, quiet_from time, quiet_until time)
returns boolean
language sql
immutable
as $$
  select case
    when quiet_from < quiet_until then at_time >= quiet_from and at_time < quiet_until
    else at_time >= quiet_from or at_time < quiet_until
  end
$$;

create table digest_settings (
  id boolean primary key default true constraint digest_settings_one_row check (id),
  send_at time not null,
  quiet_from time not null,
  quiet_until time not null,
  constraint digest_settings_quiet_check check (quiet_from <> quiet_until),
  -- Plan decision 9: a digest time inside the quiet hours would always wait.
  constraint digest_settings_send_at_check check (
    not digest_in_quiet(send_at, quiet_from, quiet_until)
  ),
  -- Whole minutes: the screen sets hours and minutes.
  constraint digest_settings_minutes_check check (
    date_trunc('minute', send_at) = send_at
    and date_trunc('minute', quiet_from) = quiet_from
    and date_trunc('minute', quiet_until) = quiet_until
  )
);

insert into digest_settings (id, send_at, quiet_from, quiet_until)
values (true, '19:00', '21:00', '08:00');

grant select on digest_settings to sodiq_app;
grant update (send_at, quiet_from, quiet_until) on digest_settings to sodiq_app;

-- ---------------------------------------------------------------------------
-- The parent's frequency. `10`: "daily at 19:00; twice a week, Wednesday and Saturday at 19:00;
-- or once a week, Saturday at 19:00 ... Until a parent chooses, twice a week": no row is twice a
-- week. Written by the parent's own route only.

create table digest_frequencies (
  account_id uuid primary key references accounts (id),
  frequency text not null constraint digest_frequencies_frequency_check check (
    frequency in ('daily', 'twice_weekly', 'weekly')
  ),
  chosen_at timestamptz not null
);

grant select, insert on digest_frequencies to sodiq_app;
grant update (frequency, chosen_at) on digest_frequencies to sodiq_app;

-- ---------------------------------------------------------------------------
-- A chat that blocked the bot (Release 2 plan, reading 8): set when a send is answered 403,
-- cleared on /start or a mini app launch from the chat. Named apart from `end_reason =
-- 'blocked'`, which is an account that can no longer sign in (0160).

alter table telegram_links add column bot_blocked_at timestamptz;
grant update (bot_blocked_at) on telegram_links to sodiq_app;

-- ---------------------------------------------------------------------------
-- One digest per Parent account and Tashkent school date: written `due` by the tick, then
-- `nothing`, `delivered`, `blocked` (the chat blocked the bot), `no_chat` (the link ended
-- meanwhile) or `failed` (after the last attempt). The period is closed when a digest is
-- `delivered` or `nothing`; the next one starts there (plan decision 8).

create table digests (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  digest_date date not null,
  telegram_link_id uuid not null references telegram_links (id),
  due_at timestamptz not null,
  status text not null default 'due' constraint digests_status_check check (
    status in ('due', 'nothing', 'delivered', 'blocked', 'failed', 'no_chat')
  ),
  attempts integer not null default 0 constraint digests_attempts_check check (attempts >= 0),
  next_try_at timestamptz not null,
  period_from timestamptz,
  period_until timestamptz,
  sent_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint digests_key unique (account_id, digest_date),
  constraint digests_period_check check (
    (status in ('delivered', 'nothing')) = (period_until is not null)
  ),
  constraint digests_sent_check check ((status = 'delivered') = (sent_at is not null))
);

create index digests_due_idx on digests (next_try_at) where status = 'due';
create index digests_account_idx on digests (account_id, digest_date);
create index digests_date_idx on digests (digest_date, id);

grant select, insert on digests to sodiq_app;
grant update (status, attempts, next_try_at, period_from, period_until, sent_at) on digests
  to sodiq_app;

-- The children a digest was for, as named: first name and class only (`10`, Privacy). Written at
-- each attempt from the children in scope, so a digest not delivered names them too (`10`,
-- Sending: "for which children ... delivered or not"); `in_message` marks those the delivered
-- message named.
-- The student id without a key, as a log row: a student merge or branch move (3.3c, 3.3d) has
-- nothing of the send log to carry.
create table digest_parts (
  id uuid primary key default uuidv7(),
  digest_id uuid not null references digests (id),
  student_id uuid not null,
  first_name text not null,
  class_name text,
  in_message boolean not null default false,
  constraint digest_parts_key unique (digest_id, student_id)
);

grant select, insert on digest_parts to sodiq_app;
grant update (in_message) on digest_parts to sodiq_app;

-- What a delivered digest carried, one row per entry, with the value as it was sent. No key to
-- the journal's rows: a work removed takes its cells with it, and a digest must never block a
-- change of the journal (review correction 2). An entry gone is listed once "removed". No branch:
-- an entry is read again in every branch of the child's year (plan decision 17).
create table digest_entries (
  id uuid primary key default uuidv7(),
  digest_id uuid not null references digests (id),
  account_id uuid not null references accounts (id),
  -- Without a key, as in `digest_parts`.
  student_id uuid not null,
  kind text not null constraint digest_entries_kind_check check (
    kind in ('attendance', 'score', 'rating', 'comment')
  ),
  -- The journal's row: a cell (attendance or score), a rating entry, a comment.
  source_id uuid not null,
  -- The subject and the date as sent: what names an entry listed "removed" once its row is gone.
  subject_id uuid references subjects (id),
  lesson_date date,
  state text not null constraint digest_entries_state_check check (
    state in ('new', 'corrected', 'removed')
  ),
  -- The value sent; all null for "removed".
  sent_mark smallint,
  sent_score integer,
  sent_total integer,
  sent_version integer,
  constraint digest_entries_key unique (digest_id, kind, source_id),
  constraint digest_entries_removed_check check (
    (state = 'removed') = (
      sent_mark is null and sent_score is null and sent_total is null and sent_version is null
    )
  )
);

create index digest_entries_child_idx on digest_entries (account_id, student_id, kind, source_id);

grant select, insert on digest_entries to sodiq_app;

-- ---------------------------------------------------------------------------
-- The children a digest may name at a moment: those of the portal (`portal_children`, 0159:
-- an open link, portal access on, the student active) whose link also has "receives notices"
-- on (`10`, What it holds; `edge/close-relatives`, Divorced parents). The same rule for the
-- build and for the check just before sending. SECURITY DEFINER as `portal_children`.
create function digest_children(account_id uuid, at timestamptz)
returns table (
  student_id uuid,
  branch_id uuid,
  first_name text,
  class_grade smallint,
  class_name text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select k.student_id, k.branch_id, k.first_name, k.class_grade, k.class_name
  from public.portal_children(digest_children.account_id, digest_children.at) k
  where exists (
    select 1
    from public.relative_accounts ra
    join public.student_relatives l on l.relative_id = ra.relative_id
    where ra.account_id = digest_children.account_id
      and l.student_id = k.student_id
      and l.unlinked_at is null
      and l.portal_access
      and l.receives_notices
  )
$$;

revoke execute on function digest_children(uuid, timestamptz) from public;
grant execute on function digest_children(uuid, timestamptz) to sodiq_app;

-- The Parent accounts with an open Telegram link whose chat has not blocked the bot, with the
-- link and the frequency (twice a week when none was chosen): the tick's list. Both tables are
-- school-wide, so the function runs as its caller.
create function digest_recipients()
returns table (account_id uuid, telegram_link_id uuid, frequency text, linked_at timestamptz)
language sql
stable
set search_path = pg_catalog, public
as $$
  select t.account_id, t.id, coalesce(f.frequency, 'twice_weekly'), t.linked_at
  from public.telegram_links t
  left join public.digest_frequencies f on f.account_id = t.account_id
  where t.ended_at is null
    and t.bot_blocked_at is null
  order by t.account_id
$$;

grant execute on function digest_recipients() to sodiq_app;
