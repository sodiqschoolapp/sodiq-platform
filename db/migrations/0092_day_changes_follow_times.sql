-- 0092 Stored one-day changes and bulk cancels follow their lessons to the
-- new times of a day template change (task 5.6b-4b, pull request #178,
-- decision 1 and review correction 1).
--
-- docs/spec/06-timetable.md, What a change does to existing data: "Day
-- template changed (lengths, breaks, order): lessons already held keep the
-- times they were held at; lessons from the start date take the new times."
-- docs/spec/edge-cases/time-dates-calendar.md, "A slot type's length or a day
-- template is changed mid-year": "Held lessons keep their times." The From
-- line of 5.6b-4a: a stored change follows its lesson (a cancel stays a
-- cancel, a room change stays, a move goes to the new times of its lesson
-- number).
--
-- The stored one-day changes (0085) and bulk cancels (0086) are matched to
-- their lessons by their times. A change of the day templates from a date
-- moves the times of the lessons of the dates after today it writes, so it
-- moves the stored times of those dates with them, by the lesson number in
-- the day. These rows are data in force, not history (0085); the audit entry
-- of the template change keeps the times before and after.
--
-- Only the time columns may change (the column grants), and only on a side
-- whose date is after today in the branch's time zone, to times on that same
-- date; without a moment of the transaction no time changes (as
-- `lesson_block_quarter_fixed` of 0059). The other checks of 0085 and 0086
-- (start before end) stay.

-- A time of a stored row may move on `day`: after today, and staying on it.
create function day_change_time_movable(
  branch uuid,
  day date,
  old_starts timestamptz,
  old_ends timestamptz,
  new_starts timestamptz,
  new_ends timestamptz
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  zone text;
  moment timestamptz;
begin
  if new_starts is not distinct from old_starts and new_ends is not distinct from old_ends then
    return true;
  end if;
  select b.time_zone into zone from branches b where b.id = branch;
  moment := class_tutors_moment();
  if zone is null or moment is null then
    return false;
  end if;
  return day > (moment at time zone zone)::date
    and (new_starts at time zone zone)::date = day
    and (new_ends at time zone zone)::date = day;
end;
$$;

create function lesson_day_changes_times() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not day_change_time_movable(
      new.branch_id, old.from_date,
      old.from_starts_at, old.from_ends_at, new.from_starts_at, new.from_ends_at)
    or not day_change_time_movable(
      new.branch_id, old.to_date,
      old.to_starts_at, old.to_ends_at, new.to_starts_at, new.to_ends_at) then
    raise exception 'day_change_time_fixed'
      using errcode = 'check_violation', constraint = 'day_change_time_fixed';
  end if;
  return new;
end;
$$;

create trigger lesson_day_changes_times
  before update on lesson_day_changes
  for each row execute function lesson_day_changes_times();

create function bulk_cancel_spans_times() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  day date;
begin
  select c.cancel_date into day
    from bulk_cancels c where c.id = old.bulk_cancel_id and c.branch_id = old.branch_id;
  if day is null or not day_change_time_movable(
      new.branch_id, day, old.starts_at, old.ends_at, new.starts_at, new.ends_at) then
    raise exception 'day_change_time_fixed'
      using errcode = 'check_violation', constraint = 'day_change_time_fixed';
  end if;
  return new;
end;
$$;

create trigger bulk_cancel_spans_times
  before update on bulk_cancel_spans
  for each row execute function bulk_cancel_spans_times();

create function bulk_cancel_blocks_times() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not day_change_time_movable(
      new.branch_id, old.lesson_date, old.starts_at, old.ends_at, new.starts_at, new.ends_at) then
    raise exception 'day_change_time_fixed'
      using errcode = 'check_violation', constraint = 'day_change_time_fixed';
  end if;
  return new;
end;
$$;

create trigger bulk_cancel_blocks_times
  before update on bulk_cancel_blocks
  for each row execute function bulk_cancel_blocks_times();

grant update (from_starts_at, from_ends_at, to_starts_at, to_ends_at)
  on lesson_day_changes to sodiq_app;
grant update (starts_at, ends_at) on bulk_cancel_spans to sodiq_app;
grant update (starts_at, ends_at) on bulk_cancel_blocks to sodiq_app;
