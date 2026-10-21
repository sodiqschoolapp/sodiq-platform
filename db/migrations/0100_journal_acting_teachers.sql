-- 0100 The acting teacher of a vacancy's journal (task 5.7a-3c, pull request
-- #190).
--
-- docs/spec/edge-cases/timetable.md, After publishing, "A vacancy lasts a
-- quarter: who writes the plan and grades?": "The Academic Vice Principal
-- names an acting teacher for the journal for a period, as a substitute per
-- journal for an open-ended absence. For that period the acting teacher owns
-- the plan, adds works, enters the rating exam and is counted in the
-- discipline report; the vacancy is counted for nothing. ... When the vacancy
-- is filled, the hired teacher becomes the owner from that date."
--
-- The plan approved on pull request #190: decisions 2 (the period counts only
-- on the days the journal's row in the published version in force names the
-- vacancy, read on each request, so the fill ends it with no write), 4
-- (school dates, half-open, from today at the earliest, a withdrawn period
-- kept as an empty range), 6 (one acting teacher of a journal on a day), and
-- correction 1 (an empty period is made only by the withdraw). The kinds of
-- the vacancy and the person and their branch links are the route's checks
-- (spec review of the plan, should-fix 3).

create table journal_acting_teachers (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  journal_id uuid not null,
  vacancy_id uuid not null references staff (id),
  person_id uuid not null references staff (id),
  valid_from date not null,
  -- The first day the person no longer owns the journal (half-open, review
  -- correction 2); null while open-ended. Equal to `valid_from` for a
  -- withdrawn period.
  valid_until date,
  -- Who ended it: the end route (`ended`) or a withdraw (`withdrawn`); null
  -- for an end typed at naming (spec review of the plan, should-fix 1).
  end_cause text constraint journal_acting_teachers_end_cause_check check (
    end_cause in ('ended', 'withdrawn')
  ),
  given_by uuid not null references accounts (id),
  ended_by uuid references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_acting_teachers_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint journal_acting_teachers_people_check check (vacancy_id <> person_id),
  constraint journal_acting_teachers_range_check check (
    valid_until is null or valid_until >= valid_from
  ),
  constraint journal_acting_teachers_end_cause_needed check (
    end_cause is null or valid_until is not null
  ),
  constraint journal_acting_teachers_ended_by_check check (
    (ended_by is null) = (end_cause is null)
  ),
  -- One acting teacher of a journal on a day; an empty range (a withdrawn
  -- period) meets nothing.
  constraint journal_acting_one exclude using gist (
    journal_id with =,
    daterange(valid_from, valid_until) with &&
  )
);

create index journal_acting_teachers_journal_idx on journal_acting_teachers (journal_id);
create index journal_acting_teachers_vacancy_idx on journal_acting_teachers (branch_id, vacancy_id);

alter table journal_acting_teachers enable row level security;
create policy branch_filter on journal_acting_teachers for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_acting_teachers to sodiq_app;
grant insert (branch_id, journal_id, vacancy_id, person_id, valid_from, valid_until, given_by)
  on journal_acting_teachers to sodiq_app;
grant update (valid_until, end_cause, ended_by) on journal_acting_teachers to sodiq_app;

-- Today in the branch's time zone from the moment of the transaction
-- (`app.now`, set from the injected clock); null without one.
create function journal_acting_today(branch uuid) returns date
language sql
stable
set search_path = pg_catalog, public
as $$
  select (class_tutors_moment() at time zone b.time_zone)::date
  from branches b
  where b.id = branch
$$;

-- A new period starts today or later and is not empty (correction 1); a
-- change only ends it earlier, on today or later, and an end already passed
-- is final. Not in a closed year. Runs as the invoker.
create function journal_acting_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  today date;
  year_id uuid;
begin
  select j.academic_year_id into year_id
    from journals j where j.id = new.journal_id and j.branch_id = new.branch_id;
  if found then
    perform class_year_open(year_id);
  end if;
  if current_user <> 'sodiq_app' then
    return new;
  end if;
  today := journal_acting_today(new.branch_id);
  if today is null then
    raise exception 'journal_acting_needs_moment'
      using errcode = 'check_violation', constraint = 'journal_acting_needs_moment';
  end if;
  if tg_op = 'INSERT' then
    if new.valid_from < today then
      raise exception 'journal_acting_start_past'
        using errcode = 'check_violation', constraint = 'journal_acting_start_past';
    end if;
    if new.valid_until is not null and new.valid_until <= new.valid_from then
      raise exception 'journal_acting_empty'
        using errcode = 'check_violation', constraint = 'journal_acting_empty';
    end if;
    return new;
  end if;
  if old.valid_until is not null and old.valid_until <= today then
    raise exception 'journal_acting_end_final'
      using errcode = 'check_violation', constraint = 'journal_acting_end_final';
  end if;
  if new.valid_until is null
    or (old.valid_until is not null and new.valid_until > old.valid_until) then
    raise exception 'journal_acting_end_later'
      using errcode = 'check_violation', constraint = 'journal_acting_end_later';
  end if;
  if new.valid_until < today then
    raise exception 'journal_acting_end_past'
      using errcode = 'check_violation', constraint = 'journal_acting_end_past';
  end if;
  return new;
end;
$$;

create trigger journal_acting_check
  before insert or update on journal_acting_teachers
  for each row execute function journal_acting_check();
