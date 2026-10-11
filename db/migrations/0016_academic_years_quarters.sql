-- 0016 Academic years, quarters and the go-live date of a branch (task 1.3).
--
-- docs/spec/03-school-setup.md, the setup table: Academic year ("Start and end
-- date. Status: planned, current, closed. Exactly one current year per
-- branch."; owner: Super Admin) and Quarters ("Four per year, each with start
-- and end. No overlaps, no gaps inside teaching time. Months are derived from
-- dates."; owner: Academic Vice Principal).
-- docs/spec/edge-cases/developer-rules.md, "One current year": "A partial
-- unique index on (branch) where status is current."
-- docs/spec/edge-cases/time-dates-calendar.md, "Vacations between quarters":
-- "They are the gaps between quarter dates."
-- docs/spec/edge-cases/academic-year.md, "In August the school must prepare
-- next year": "'Start year' is one action by the Super Admin, available only
-- after 'Close the year' was carried out for the previous year"; "The school
-- goes live in the middle of the year": "The Super Admin sets a start date for
-- each branch."
--
-- The owner's answers 1 to 8 for task 1.3 (docs/decisions.md, "Decided ahead
-- for tasks 1.3 to 1.6") and the plan approved on pull request #44: a year
-- starts in one calendar year and ends in the next, in less than a year
-- (decision 1); quarters are created undated with their year and dated one at
-- a time (answer 4, decision 2); dated quarters lie inside their year, in
-- order, without overlap, and the gaps between them are the vacations
-- (answer 5); statuses move planned -> current -> closed, and no year sits
-- before one already started (answer 6, decision 13).
--
-- Every refusal raised here names a constraint, which the API maps to an
-- error code (apps/api/src/modules/setup/setup-refusals.ts).

-- Years. A branch table: branch_id and the one policy of 0002.
create table academic_years (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  start_date date not null,
  end_date date not null,
  -- A year always begins planned: the application inserts no status (see the
  -- grants), and only "Start year" makes it current.
  status text not null default 'planned' constraint academic_years_status_check check (
    status in ('planned', 'current', 'closed')
  ),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  -- The name is "<start year>-<end year>" (answer 1): a year ends in the
  -- calendar year after the one it starts in, and lasts less than a year.
  -- The same rule as academicYearRecordSchema of packages/shared.
  constraint academic_years_dates_check check (
    extract(year from end_date) = extract(year from start_date) + 1
    and end_date < (start_date + interval '1 year')::date
  ),
  -- So that a quarter can reference the year together with the branch.
  constraint academic_years_id_branch_key unique (id, branch_id),
  -- The years of a branch do not overlap (answer 6). Both ends are school days
  -- of the year, so the range is closed at both ends.
  constraint academic_years_no_overlap exclude using gist (
    branch_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);

-- docs/spec/edge-cases/developer-rules.md, "One current year".
create unique index academic_years_one_current_idx
  on academic_years (branch_id) where status = 'current';

alter table academic_years enable row level security;
create policy branch_filter on academic_years for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The order of the years of a branch, for every user, the migrator included.
-- Not SECURITY DEFINER: it runs with the rights of the caller, so the branch
-- filter applies to what it reads (the rows of the year's own branch).
--
-- - A closed year changes nothing (academic_years_closed).
-- - The status moves only planned -> current -> closed (academic_years_status_order).
-- - A planned or current year starts after every closed year of the branch,
--   and a planned year after the current one (academic_years_out_of_order):
--   a year behind one already started could never become current.
-- - A year that is or becomes current has no earlier year that is not closed
--   (academic_years_earlier_open): "Start year ... available only after
--   'Close the year' was carried out for the previous year".
create function academic_years_guard() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'closed' and new is distinct from old then
      raise exception 'academic_years_closed'
        using errcode = 'check_violation', constraint = 'academic_years_closed';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'planned' and new.status = 'current')
      or (old.status = 'current' and new.status = 'closed')
    ) then
      raise exception 'academic_years_status_order'
        using errcode = 'check_violation', constraint = 'academic_years_status_order';
    end if;
    -- Nothing below depends on a change that leaves dates and status alone.
    if new.start_date = old.start_date and new.end_date = old.end_date
      and new.status = old.status then
      return new;
    end if;
  end if;

  if new.status in ('planned', 'current') and exists (
    select 1 from academic_years other
    where other.branch_id = new.branch_id
      and other.id <> new.id
      and other.start_date > new.start_date
      and (other.status = 'closed' or (other.status = 'current' and new.status = 'planned'))
  ) then
    raise exception 'academic_years_out_of_order'
      using errcode = 'check_violation', constraint = 'academic_years_out_of_order';
  end if;

  if new.status = 'current' and exists (
    select 1 from academic_years other
    where other.branch_id = new.branch_id
      and other.id <> new.id
      and other.start_date < new.start_date
      and other.status <> 'closed'
  ) then
    raise exception 'academic_years_earlier_open'
      using errcode = 'check_violation', constraint = 'academic_years_earlier_open';
  end if;

  return new;
end
$$;

create trigger academic_years_guard
  before insert or update on academic_years
  for each row execute function academic_years_guard();

-- The application creates a year with its dates (always planned), changes its
-- dates and its status; nothing removes a year.
grant select on academic_years to sodiq_app;
grant insert (branch_id, start_date, end_date) on academic_years to sodiq_app;
grant update (start_date, end_date, status) on academic_years to sodiq_app;

-- Quarters. Four per year, created with it, undated until the Academic Vice
-- Principal dates them (answer 4).
create table quarters (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  academic_year_id uuid not null,
  number smallint not null constraint quarters_number_check check (number between 1 and 4),
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  -- Both dates or neither; a quarter may be one day long (decision 2).
  -- "is not null" is said: a check that comes out null would pass.
  constraint quarters_dates_check check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and start_date <= end_date)
  ),
  -- A quarter belongs to a year of its own branch, whatever the application does.
  constraint quarters_year_fkey foreign key (academic_year_id, branch_id)
    references academic_years (id, branch_id),
  -- With branch_id, as every unique constraint on a branch table.
  constraint quarters_number_key unique (branch_id, academic_year_id, number),
  -- No overlap (the build plan's "done when"). Deferred: the four quarters are
  -- saved together, and a constraint checked row by row would refuse a valid
  -- end state (Q1's end moved past Q2's old start before Q2 moves). An undated
  -- quarter is left out: daterange(null, null) would overlap everything.
  constraint quarters_no_overlap exclude using gist (
    branch_id with =,
    academic_year_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (start_date is not null) deferrable initially deferred
);

alter table quarters enable row level security;
create policy branch_filter on quarters for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- No quarter of a closed year changes (the year is frozen with its quarters).
create function quarters_closed_year_guard() returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from academic_years
    where id = new.academic_year_id and status = 'closed'
  ) then
    raise exception 'academic_years_closed'
      using errcode = 'check_violation', constraint = 'academic_years_closed';
  end if;
  return new;
end
$$;

create trigger quarters_closed_year_guard
  before insert or update on quarters
  for each row execute function quarters_closed_year_guard();

-- At the end of the transaction, for the year of the changed row: exactly four
-- quarters numbered 1 to 4 (academic_year_quarters_count); every dated quarter
-- inside the year's dates (quarters_outside_year); the dated quarters in
-- number order, each ending before the next dated one starts (quarters_order).
-- The year row is taken for share first, so that a change of the year's dates
-- and a save of its quarters cannot both pass on what the other has not yet
-- committed; the quarters are read without a lock, in number order (a lock on
-- them after the year's could deadlock with a save that holds them).
create function academic_year_quarters_check() returns trigger
language plpgsql
as $$
declare
  year_id uuid;
  year_start date;
  year_end date;
  quarter record;
  expected smallint := 0;
  previous_end date;
begin
  if tg_table_name = 'quarters' then
    year_id := new.academic_year_id;
  else
    year_id := new.id;
  end if;

  select start_date, end_date into year_start, year_end
    from academic_years where id = year_id for share;

  for quarter in
    select number, start_date, end_date from quarters
    where academic_year_id = year_id
    order by number
  loop
    expected := expected + 1;
    if quarter.number <> expected then
      raise exception 'academic_year_quarters_count'
        using errcode = 'check_violation', constraint = 'academic_year_quarters_count';
    end if;
    if quarter.start_date is not null then
      if quarter.start_date < year_start or quarter.end_date > year_end then
        raise exception 'quarters_outside_year'
          using errcode = 'check_violation', constraint = 'quarters_outside_year';
      end if;
      if previous_end is not null and quarter.start_date <= previous_end then
        raise exception 'quarters_order'
          using errcode = 'check_violation', constraint = 'quarters_order';
      end if;
      previous_end := quarter.end_date;
    end if;
  end loop;

  if expected <> 4 then
    raise exception 'academic_year_quarters_count'
      using errcode = 'check_violation', constraint = 'academic_year_quarters_count';
  end if;
  return null;
end
$$;

create constraint trigger academic_year_quarters_check
  after insert or update on quarters
  deferrable initially deferred
  for each row execute function academic_year_quarters_check();

create constraint trigger academic_year_quarters_check
  after insert or update of start_date, end_date on academic_years
  deferrable initially deferred
  for each row execute function academic_year_quarters_check();

-- The application creates the four quarters with their year and changes their
-- dates; it never moves a quarter to another year or renumbers it.
grant select on quarters to sodiq_app;
grant insert (branch_id, academic_year_id, number, start_date, end_date) on quarters to sodiq_app;
grant update (start_date, end_date) on quarters to sodiq_app;

-- The go-live start date of the branch (answer 7): null until the Super Admin
-- sets it. "Inside a planned or current year" is checked by the API under a
-- lock of the branch row, because the rule reads the status at the moment of
-- the change; a year that later closes keeps it.
alter table branches add column go_live_date date;

grant update (go_live_date) on branches to sodiq_app;
