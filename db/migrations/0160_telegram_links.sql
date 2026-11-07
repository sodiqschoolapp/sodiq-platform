-- Task 11.4: the Telegram chat link of a Parent account (docs/spec/10-portal-notifications-release-2.md,
-- Signing in: Telegram; plan of pull request #298).
--
-- "One account is linked to one chat, and one chat to one account": two partial unique
-- indexes over the open links hold it, whatever the application does. The chat is the
-- Telegram user id: the mini app opened from the bot carries the user, and a user's private
-- chat with the bot has the user's id (decision 4). Accounts and relatives are school-wide
-- (0005, 0036), so this table has no branch column. No existing row changes.

create table telegram_links (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  telegram_user_id bigint not null check (telegram_user_id > 0),
  linked_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (
    end_reason in ('sign_out', 'password_change', 'password_reset', 'unlinked', 'moved', 'blocked')
  ),
  -- The administrator of "Unlink Telegram"; null for every other end.
  ended_by uuid references accounts (id),
  -- When the earlier chat of a moved link was told (the job `telegram.tell_moved`).
  told_at timestamptz,
  check ((ended_at is null) = (end_reason is null)),
  check (ended_by is null or end_reason = 'unlinked'),
  check (told_at is null or end_reason = 'moved')
);

create unique index telegram_links_open_account_key on telegram_links (account_id)
  where ended_at is null;
create unique index telegram_links_open_chat_key on telegram_links (telegram_user_id)
  where ended_at is null;
create index telegram_links_account_idx on telegram_links (account_id, linked_at);

-- A link belongs to a Parent account only (`is_parent_account`, 0158): a staff account never
-- has one, even when the person is also a relative (`edge/close-relatives`).
create function telegram_links_parent_only() returns trigger
language plpgsql
as $$
begin
  if not is_parent_account(new.account_id) then
    raise exception 'telegram_link_not_parent'
      using errcode = 'check_violation', constraint = 'telegram_link_not_parent';
  end if;
  return new;
end;
$$;

create trigger telegram_links_parent_only
  before insert on telegram_links
  for each row execute function telegram_links_parent_only();

-- Written once; only the end and the notice of a move change. Never deleted.
grant select, insert on telegram_links to sodiq_app;
grant update (ended_at, end_reason, ended_by, told_at) on telegram_links to sodiq_app;

-- The session opened in the mini app through a link, or that wrote it: ending the link ends
-- these sessions, so the next opening asks for the password (decision 7).
alter table sessions add column telegram_link_id uuid references telegram_links (id);
create index sessions_telegram_link_idx on sessions (telegram_link_id)
  where telegram_link_id is not null and ended_at is null;
grant update (telegram_link_id) on sessions to sodiq_app;

-- A list widened for a new requirement; the existing reasons are kept as 0008 wrote them.
alter table sessions drop constraint sessions_end_reason_check;
alter table sessions add constraint sessions_end_reason_check check (
  end_reason in (
    'sign_out', 'password_change', 'idle', 'sign_out_everywhere', 'password_reset',
    'expired', 'account_locked', 'trusted_device_removed', 'telegram_unlinked'
  )
);
