-- 0013 Notifications to staff in the app (task 0.9).
--
-- docs/spec/10-portal-notifications-release-2.md, Notifications: staff
-- notifications in the app (timetable changes, substitutions, locks, plan
-- windows) are part of Release 1; SMS and the portal come in Release 2.
-- docs/spec/edge-cases/system-behaviour.md: a job is recorded together with
-- the data change that caused it; nothing that cannot be rebuilt lives only in
-- the job queue. The rows here are the record; the delivery job only pushes.
--
-- One row per person and event. The text is made in the browser from the kind
-- and its data, in the language of the account (decided by the owner at the
-- plan of 0.9); the server stores no text.
--
-- School-wide with a branch label (SCHOOL_WIDE_WITH_BRANCH in
-- apps/api/src/database/catalog.test.ts, decided by the owner): a person reads
-- their notifications from every branch at once, before any branch is chosen
-- in the switcher, and a Super Admin's or a school-wide event has no branch.

create table notifications (
  id uuid primary key default uuidv7(),
  -- The person. An account has no branch.
  account_id uuid not null references accounts (id),
  -- The branch of the event; empty for an event of the whole school.
  branch_id uuid references branches (id),
  -- The event, for example timetable.changed. The kinds and the data each one
  -- carries are NOTIFICATION_KINDS in packages/shared; the database checks the
  -- format only, so a later task that adds a kind needs no migration.
  kind text not null constraint notifications_kind_check check (
    kind ~ '^[a-z]+(\.[a-z_]+)+$' and length(kind) <= 100
  ),
  -- What the text of the kind needs: ids, dates, names as the event saw them.
  data jsonb not null,
  -- From the injected clock.
  created_at timestamptz not null,
  -- From the injected clock; empty while unread.
  read_at timestamptz,
  constraint notifications_read_after_created_check check (
    read_at is null or read_at >= created_at
  )
);

-- "The latest notifications of this person", newest first.
create index notifications_account_idx on notifications (account_id, created_at desc);
-- "How many unread", on every connection and list.
create index notifications_unread_idx on notifications (account_id) where read_at is null;
-- The branch is a label; the foreign key wants an index for a later check of a branch.
create index notifications_branch_idx on notifications (branch_id);

-- The application writes a notification and marks it read; it never changes
-- or removes one otherwise.
grant select, insert on notifications to sodiq_app;
grant update (read_at) on notifications to sodiq_app;
