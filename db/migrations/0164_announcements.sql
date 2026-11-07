-- 0164 Announcements and events (task 11.7, pull request #306).
--
-- docs/spec/11-later-modules.md: "Announcements and events | 2 | Management | News and events
-- for chosen audiences, with a calendar." docs/spec/10-portal-notifications-release-2.md,
-- Notifications to staff: "Later in Release 2, through the bot: ... announcements to a chosen
-- audience." Build plan 11.7, approved by the owner on 7 November 2026 (stop-list item 5):
-- written by the Super Admin for any audience and by the Academic Vice Principal and the Vice
-- Principal for Spiritual and Moral Education for audiences of the branch of the request.
--
-- Plan of #306, approved: decision 1 (Look first: `announcements` is a branch-or-school table,
-- the school-wide row with no branch, as `lesson_plan_masters` (0118); the deliveries are
-- school-wide, as `digests` (0161); one SECURITY DEFINER reader of the recipients), decision 5
-- (the audience and the readers are fixed once saved), decision 11 (with review correction 3:
-- an event's times are clock times of the branch's time zone, shown as typed; a school-wide
-- event's time as typed too; no moment is stored for them, an event is not a lesson).
--
-- Nothing here changes or removes an existing row: new tables, a function and grants.

-- ---------------------------------------------------------------------------
-- An announcement (`news`) or an event (`event`, with dates, optional times and a place), for
-- an audience: where (`school`: no branch; `branch`; `grades` of the branch; `classes` of the
-- branch, in `announcement_classes`) and who (staff, parents, or both). Published when saved
-- (decision 11), `published_at` from the injected clock. The limits are the constants of
-- `packages/shared/src/announcements.ts` (a test compares them).

-- Grades 0 to 11 (grade 0, 0151), at least one, none empty, no repeats.
create function announcement_grades_valid(grades smallint[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select cardinality(grades) between 1 and 12
    and array_position(grades, null) is null
    and 0 <= all (grades)
    and 11 >= all (grades)
    and cardinality(grades) = (select count(distinct g) from unnest(grades) g)
$$;

create table announcements (
  id uuid primary key default uuidv7(),
  -- Empty for the whole school (`audience = 'school'`).
  branch_id uuid references branches (id),
  kind text not null constraint announcements_kind_check check (kind in ('news', 'event')),
  title text not null constraint announcements_title_check check (
    length(btrim(title)) between 1 and 120
  ),
  body text not null constraint announcements_body_check check (
    length(btrim(body)) between 1 and 2000
  ),
  audience text not null constraint announcements_audience_check check (
    audience in ('school', 'branch', 'grades', 'classes')
  ),
  -- Only for `grades`: grades 0 to 11 (grade 0, 0151), at least one, no repeats.
  grades smallint[],
  for_staff boolean not null,
  for_parents boolean not null,
  -- An event's school dates, both included.
  first_date date,
  last_date date,
  -- Clock times of the branch's time zone, as typed (review correction 3).
  starts_at time,
  ends_at time,
  place text constraint announcements_place_check check (
    place is null or length(btrim(place)) between 1 and 120
  ),
  published_at timestamptz not null,
  published_by uuid not null references accounts (id),
  edited_at timestamptz,
  edited_by uuid references accounts (id),
  version integer not null default 1 constraint announcements_version_check check (version >= 1),
  -- From the injected clock; empty while active.
  archived_at timestamptz,
  archived_by uuid references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint announcements_id_branch_key unique (id, branch_id),
  constraint announcements_school_check check ((audience = 'school') = (branch_id is null)),
  constraint announcements_readers_check check (for_staff or for_parents),
  constraint announcements_grades_check check (
    (audience = 'grades') = (grades is not null)
    and (grades is null or announcement_grades_valid(grades))
  ),
  constraint announcements_event_check check (
    case kind
      when 'event' then first_date is not null and last_date is not null and last_date >= first_date
      else first_date is null and last_date is null and starts_at is null and ends_at is null
        and place is null
    end
  ),
  constraint announcements_times_check check (
    (ends_at is null or (starts_at is not null and ends_at > starts_at))
    and (starts_at is null or date_trunc('minute', starts_at) = starts_at)
    and (ends_at is null or date_trunc('minute', ends_at) = ends_at)
  ),
  constraint announcements_archived_check check ((archived_at is null) = (archived_by is null)),
  constraint announcements_edited_check check ((edited_at is null) = (edited_by is null))
);

create index announcements_branch_idx on announcements (branch_id, published_at desc);
create index announcements_events_idx on announcements (first_date, last_date)
  where kind = 'event';

alter table announcements enable row level security;
create policy branch_or_school on announcements for all to sodiq_app
  using (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id is null or branch_id = any ((select app_branch_ids())::uuid[]));

-- The branch, kind, audience, grades and readers never change (decision 5).
grant select on announcements to sodiq_app;
grant insert (id, branch_id, kind, title, body, audience, grades, for_staff, for_parents,
  first_date, last_date, starts_at, ends_at, place, published_at, published_by)
  on announcements to sodiq_app;
grant update (title, body, first_date, last_date, starts_at, ends_at, place, edited_at,
  edited_by, version, archived_at, archived_by)
  on announcements to sodiq_app;

-- ---------------------------------------------------------------------------
-- The classes of an announcement for `classes`, of its own branch. Written with the
-- announcement, never changed (decision 5).

create table announcement_classes (
  announcement_id uuid not null,
  class_id uuid not null,
  branch_id uuid not null references branches (id),
  constraint announcement_classes_pkey primary key (announcement_id, class_id),
  constraint announcement_classes_announcement_fkey foreign key (announcement_id, branch_id)
    references announcements (id, branch_id),
  constraint announcement_classes_class_fkey foreign key (class_id, branch_id)
    references classes (id, branch_id)
);

create index announcement_classes_class_idx on announcement_classes (class_id);

alter table announcement_classes enable row level security;
create policy branch_filter on announcement_classes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on announcement_classes to sodiq_app;

-- Only an announcement of the `classes` audience takes classes.
create function announcement_classes_audience() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.announcements a
    where a.id = new.announcement_id and a.audience = 'classes'
  ) then
    raise exception 'announcement % is not for classes', new.announcement_id
      using errcode = 'check_violation', constraint = 'announcement_classes_audience_check';
  end if;
  return new;
end;
$$;

create trigger announcement_classes_audience
  before insert on announcement_classes
  for each row execute function announcement_classes_audience();

-- ---------------------------------------------------------------------------
-- One message of an announcement to one Parent account through the bot: written `due` by the
-- fan-out, then `delivered`, `blocked` (the chat blocked the bot), `no_chat` (no open link at
-- the send), `out_of_scope` (no child the announcement reaches any more), `withdrawn` (archived
-- before the send) or `failed` (after the last attempt). A Parent account has no branch (as
-- `digests`, 0161): named in SCHOOL_WIDE_TABLES.

create table announcement_deliveries (
  id uuid primary key default uuidv7(),
  announcement_id uuid not null references announcements (id),
  account_id uuid not null references accounts (id),
  telegram_link_id uuid not null references telegram_links (id),
  status text not null default 'due' constraint announcement_deliveries_status_check check (
    status in ('due', 'delivered', 'blocked', 'no_chat', 'out_of_scope', 'withdrawn', 'failed')
  ),
  attempts integer not null default 0
    constraint announcement_deliveries_attempts_check check (attempts >= 0),
  next_try_at timestamptz not null,
  sent_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint announcement_deliveries_key unique (announcement_id, account_id),
  constraint announcement_deliveries_sent_check check ((status = 'delivered') = (sent_at is not null))
);

create index announcement_deliveries_due_idx on announcement_deliveries (next_try_at)
  where status = 'due';
create index announcement_deliveries_account_idx on announcement_deliveries (account_id);

grant select, insert on announcement_deliveries to sodiq_app;
grant update (status, attempts, next_try_at, sent_at) on announcement_deliveries to sodiq_app;

-- ---------------------------------------------------------------------------
-- The Parent accounts an announcement for parents reaches at a moment (spec review should-fix
-- 7: one place for the audience rule): an open Telegram link, and at least one child of
-- `portal_children` (an open link, portal access on, the student active; its class on the date
-- of the moment in its branch's time) whose link also has "receives notices" on (decision 7, as
-- `digest_children`), and that matches the audience: any child for `school`; the child's branch
-- for `branch`; the child's branch and grade for `grades` (spec review should-fix 2); the
-- child's class for `classes`. With `only_account`, the same test for that account alone (the
-- re-check just before a send, `10`, Privacy). SECURITY DEFINER as `portal_children`: a parent's
-- children may be in any branch, and the job names none. It returns no name.
create function announcement_recipients(
  announcement_id uuid,
  at timestamptz,
  only_account uuid default null
)
returns table (account_id uuid, telegram_link_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select t.account_id, t.id
  from public.announcements a
  join public.telegram_links t on t.ended_at is null
  where a.id = announcement_recipients.announcement_id
    and a.for_parents
    and a.archived_at is null
    and (announcement_recipients.only_account is null
      or t.account_id = announcement_recipients.only_account)
    and exists (
      select 1
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
    )
  order by t.account_id
$$;

revoke execute on function announcement_recipients(uuid, timestamptz, uuid) from public;
grant execute on function announcement_recipients(uuid, timestamptz, uuid) to sodiq_app;
