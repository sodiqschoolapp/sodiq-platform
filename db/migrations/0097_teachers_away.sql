-- 0097 Teachers away: status and lock (task 5.7a-2a, pull request #186,
-- decisions 2 to 5 and review corrections 1 to 3).
--
-- docs/spec/06-timetable.md, How surprises are prevented: "When a teacher's
-- status is set to inactive or left from a date ... the system lists the
-- future lessons that depend on them ... or marks them 'needs a teacher' ...
-- An account can always be locked at once, whatever lessons remain."
-- docs/spec/edge-cases/people-roles-accounts.md, Staff over time: "'Lock
-- now' ... needs no reassignment ... The teacher's future lessons go to
-- 'needs a teacher'."
--
-- A status or a lock writes no lesson (decision 2): a lesson keeps its
-- teacher, and its state is read from stored moments on every request, as
-- for an absence (0096). The two tables below hold those moments; both are
-- written by triggers only, so no writer of `staff_statuses` or of
-- `accounts.locked_at` can leave them behind.

-- The moments of each status row (decision 4, Look first): a status from
-- today starts at the moment of the save and a cut to today ends at it; any
-- other date at the start of its day in the main branch's time zone (as
-- `staff_out_on`, 0024), so that a save never changes the state of a lesson
-- that has started. A taken-back row has an empty range.
create table staff_status_moments (
  -- A vacancy deleted with every row of it (`vacancy_delete`, 0025) takes its
  -- moments with its statuses.
  status_id uuid primary key references staff_statuses (id) on delete cascade,
  staff_id uuid not null references staff (id),
  applies_from timestamptz not null,
  -- Null: open.
  applies_until timestamptz,
  constraint staff_status_moments_range_check check (
    applies_until is null or applies_until >= applies_from
  )
);

create index staff_status_moments_staff_idx on staff_status_moments (staff_id, applies_from);

alter table staff_status_moments enable row level security;
create policy staff_membership on staff_status_moments for all to sodiq_app
  using (exists (select 1 from staff_branches b where b.staff_id = staff_status_moments.staff_id))
  with check (exists (select 1 from staff_branches b where b.staff_id = staff_status_moments.staff_id));

grant select on staff_status_moments to sodiq_app;

-- The moment of a status date: the moment given when the date is its day,
-- else the start of the date, in the main branch's time zone.
create function staff_status_moment(record_id uuid, day date, moment timestamptz)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when staff_status_moment.moment is not null
      and (staff_status_moment.moment at time zone zone.tz)::date = staff_status_moment.day
      then staff_status_moment.moment
    else staff_status_moment.day::timestamp at time zone zone.tz
  end
  from (
    select coalesce(
      (select br.time_zone
       from staff_branches b
       join branches br on br.id = b.branch_id
       where b.staff_id = staff_status_moment.record_id and b.is_main
       limit 1),
      'Asia/Tashkent'
    ) as tz
  ) zone
$$;

revoke execute on function staff_status_moment(uuid, date, timestamptz) from public;

-- Writes the moments of a status row on insert and moves their end on a cut
-- (correction 1): for the application the moment is `app.now`, and a write
-- without it is refused; for the migrator (the backfill, the test kits, the
-- seed) a date gives the start of its day.
create function staff_status_moments_write() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if session_user is distinct from current_user then
    moment := nullif(current_setting('app.now', true), '')::timestamptz;
    if moment is null then
      raise exception 'status_moment_needs_moment'
        using errcode = 'check_violation', constraint = 'status_moment_needs_moment';
    end if;
  end if;
  if tg_op = 'INSERT' then
    insert into public.staff_status_moments (status_id, staff_id, applies_from, applies_until)
    values (
      new.id,
      new.staff_id,
      public.staff_status_moment(new.staff_id, new.valid_from, moment),
      case when new.valid_until is null then null
        else public.staff_status_moment(new.staff_id, new.valid_until, moment) end
    );
  elsif new.valid_until is distinct from old.valid_until then
    update public.staff_status_moments m
    set applies_until = greatest(
      m.applies_from,
      public.staff_status_moment(new.staff_id, new.valid_until, moment)
    )
    where m.status_id = new.id;
  end if;
  return new;
end
$$;

revoke execute on function staff_status_moments_write() from public;

create trigger staff_status_moments_write
  after insert or update of valid_until on staff_statuses
  for each row execute function staff_status_moments_write();

-- The rows written before this migration: their days' starts.
insert into staff_status_moments (status_id, staff_id, applies_from, applies_until)
select st.id, st.staff_id,
  staff_status_moment(st.staff_id, st.valid_from, null),
  case when st.valid_until is null then null
    else staff_status_moment(st.staff_id, st.valid_until, null) end
from staff_statuses st;

-- Every lock of an account as a span (decision 5, Look first): the unlock
-- empties `accounts.locked_at` (0008), and a lesson that started while the
-- account was locked keeps its state after the unlock. School-wide, as
-- `accounts`.
create table account_lock_spans (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  locked_at timestamptz not null,
  -- Null: locked now.
  unlocked_at timestamptz,
  constraint account_lock_spans_range_check check (
    unlocked_at is null or unlocked_at >= locked_at
  ),
  constraint account_lock_spans_no_overlap exclude using gist (
    account_id with =,
    tstzrange(locked_at, unlocked_at) with &&
  )
);

grant select on account_lock_spans to sodiq_app;

-- Opens a span at a lock and closes the open one at an unlock (correction 1):
-- for the application at `app.now`, a write without it refused; for the
-- migrator at the start of the current day (Asia/Tashkent), never before the
-- lock.
create function account_lock_spans_write() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if new.locked_at is not distinct from old.locked_at then
    return new;
  end if;
  if session_user is distinct from current_user then
    moment := nullif(current_setting('app.now', true), '')::timestamptz;
    if moment is null then
      raise exception 'lock_span_needs_moment'
        using errcode = 'check_violation', constraint = 'lock_span_needs_moment';
    end if;
  else
    moment := coalesce(
      nullif(current_setting('app.now', true), '')::timestamptz,
      date_trunc('day', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'
    );
  end if;
  if old.locked_at is not null then
    update public.account_lock_spans s
    set unlocked_at = greatest(s.locked_at, moment)
    where s.account_id = new.id and s.unlocked_at is null;
  end if;
  if new.locked_at is not null then
    insert into public.account_lock_spans (account_id, locked_at)
    values (new.id, new.locked_at);
  end if;
  return new;
end
$$;

revoke execute on function account_lock_spans_write() from public;

create trigger account_lock_spans_write
  after update of locked_at on accounts
  for each row execute function account_lock_spans_write();

-- The accounts locked now.
insert into account_lock_spans (account_id, locked_at)
select a.id, a.locked_at from accounts a where a.locked_at is not null;

-- Every span in which a person cannot teach that meets [range_from,
-- range_until) (null: no end): the live absences, the inactive and left
-- statuses, the locks of the person's account. Ids, causes and moments only,
-- past the membership filter (decision 3, Look first), so that a branch
-- whose link to the person was removed while it still holds the person's
-- lessons reads the same state as every other.
create function teachers_away(
  staff_ids uuid[], range_from timestamptz, range_until timestamptz
)
returns table (
  staff_id uuid, cause text, absence_id uuid,
  applies_from timestamptz, applies_until timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select * from (
    select a.staff_id, 'absence'::text, a.id, a.applies_from, a.applies_until
    from public.absences a
    where a.staff_id = any (teachers_away.staff_ids)
      and a.withdrawn_at is null
    union all
    select m.staff_id, st.status, null::uuid, m.applies_from, m.applies_until
    from public.staff_status_moments m
    join public.staff_statuses st on st.id = m.status_id
    where m.staff_id = any (teachers_away.staff_ids)
      and st.status in ('inactive', 'left')
      and (m.applies_until is null or m.applies_until > m.applies_from)
    union all
    select s.id, 'locked'::text, null::uuid, l.locked_at, l.unlocked_at
    from public.staff s
    join public.account_lock_spans l on l.account_id = s.account_id
    where s.id = any (teachers_away.staff_ids)
      and (l.unlocked_at is null or l.unlocked_at > l.locked_at)
  ) spans (staff_id, cause, absence_id, applies_from, applies_until)
  where (teachers_away.range_until is null or spans.applies_from < teachers_away.range_until)
    and (spans.applies_until is null or spans.applies_until > teachers_away.range_from)
  order by spans.staff_id, spans.applies_from
$$;

revoke execute on function teachers_away(uuid[], timestamptz, timestamptz) from public;
grant execute on function teachers_away(uuid[], timestamptz, timestamptz) to sodiq_app;
