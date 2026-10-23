-- 0117 The plan window and edit requests (task 7.2, pull request #215).
--
-- docs/spec/09-lesson-plans.md, The plan window: "The Academic Vice
-- Principal opens a window for a quarter: a start date and an end date."
-- "When the window ends, every plan is locked." "The Academic Vice Principal
-- can extend the window for one teacher." Editing after the window: "The
-- teacher sends an edit request: which lessons, and the reason." "When
-- approving, the approver sets how many days the chosen lessons stay open for
-- editing." "If the item of a lesson already held is changed, it carries an
-- 'edited after the lesson' mark." docs/spec/edge-cases/lesson-plans.md, The
-- window and requests: "There is one window per quarter and branch. It ends
-- no later than the quarter's last day." "A window ends at 23:59 of its last
-- day, branch time." "There are two kinds of request. 'Text' ... 'Re-plan'."
-- "The days are school days, from 1 to 10." "A plan record exists for every
-- journal and quarter that needs one, from the moment the journal exists."
--
-- The plan approved on pull request #215 with corrections 1 to 5. The
-- window and an extension are stored as moments (CLAUDE.md, "State from
-- stored moments"), written by the route from the injected clock's zone;
-- the dates are kept for display. Nothing here flips a state on a timer.

-- ---------------------------------------------------------------------------
-- The window: one per quarter and branch, never deleted.

create table lesson_plan_windows (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  quarter_id uuid not null,
  start_date date not null,
  end_date date not null,
  -- 00:00 of the start date and the end of the end date, branch time.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The transaction's moment of the opening (the injected clock).
  opened_at timestamptz not null,
  opened_by uuid not null references accounts (id),
  constraint lesson_plan_windows_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint lesson_plan_windows_quarter_key unique (branch_id, quarter_id),
  constraint lesson_plan_windows_id_branch_key unique (id, branch_id),
  constraint lesson_plan_windows_dates_check check (start_date <= end_date),
  constraint lesson_plan_windows_moments_check check (starts_at < ends_at)
);

alter table lesson_plan_windows enable row level security;
create policy branch_filter on lesson_plan_windows for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_windows to sodiq_app;
grant insert (id, branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at,
  opened_by) on lesson_plan_windows to sodiq_app;
grant update (start_date, end_date, starts_at, ends_at) on lesson_plan_windows to sodiq_app;

-- The window lies inside its quarter, which is dated (`edge`: "It ends no
-- later than the quarter's last day"). Runs as the invoker.
create function lesson_plan_windows_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  first_day date;
  last_day date;
begin
  select q.start_date, q.end_date into first_day, last_day
    from quarters q where q.id = new.quarter_id and q.branch_id = new.branch_id;
  if first_day is null or last_day is null or new.end_date > last_day then
    raise exception 'lesson_plan_window_quarter'
      using errcode = 'check_violation', constraint = 'lesson_plan_window_quarter';
  end if;
  return new;
end;
$$;

create trigger lesson_plan_windows_check
  before insert or update on lesson_plan_windows
  for each row execute function lesson_plan_windows_check();

-- A later end date for one teacher, given before the window ended for them
-- (`edge`: "Before the window ends, an extension is simply a later end date
-- for that teacher"). The latest row of a window and person is in force.
-- After the end an extension is a request (kind `extension`, below).
create table lesson_plan_window_extensions (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  window_id uuid not null,
  staff_id uuid not null references staff (id),
  end_date date not null,
  ends_at timestamptz not null,
  -- The transaction's moment (the injected clock).
  granted_at timestamptz not null,
  granted_by uuid not null references accounts (id),
  constraint lesson_plan_window_extensions_window_fkey foreign key (window_id, branch_id)
    references lesson_plan_windows (id, branch_id)
);

create index lesson_plan_window_extensions_window_idx
  on lesson_plan_window_extensions (window_id, staff_id);

alter table lesson_plan_window_extensions enable row level security;
create policy branch_filter on lesson_plan_window_extensions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_window_extensions to sodiq_app;
grant insert (id, branch_id, window_id, staff_id, end_date, ends_at, granted_at, granted_by)
  on lesson_plan_window_extensions to sodiq_app;

-- ---------------------------------------------------------------------------
-- The requests (0115 stored the prepared ones only; 7.1b decision 2). The
-- checks of 0115 are replaced because the requirement grew (decision 3 of
-- the review, Look first): three kinds, five statuses.

alter table lesson_plan_requests drop constraint lesson_plan_requests_kind_check;
alter table lesson_plan_requests add constraint lesson_plan_requests_kind_check
  check (kind in ('text', 'replan', 'extension'));
alter table lesson_plan_requests drop constraint lesson_plan_requests_status_check;
alter table lesson_plan_requests add constraint lesson_plan_requests_status_check
  check (status in ('prepared', 'sent', 'approved', 'refused', 'void'));

-- The Re-plan part: from this lesson's date to the quarter's end. A Text
-- request and an extension have none.
alter table lesson_plan_requests alter column from_date drop not null;

alter table lesson_plan_requests
  add column reason text not null default ''
    constraint lesson_plan_requests_reason_check check (length(reason) <= 1000),
  -- The account that sent it; null while prepared.
  add column requested_by uuid references accounts (id),
  add column sent_at timestamptz,
  add column decided_by uuid references accounts (id),
  add column decided_at timestamptz,
  add column decision_reason text not null default ''
    constraint lesson_plan_requests_decision_reason_check check (length(decision_reason) <= 1000),
  -- School days, 1 to 10 (`edge`); null for an extension, which names its end.
  add column days integer
    constraint lesson_plan_requests_days_check check (days between 1 and 10),
  -- The end of the open period: the end of the last school day, branch time.
  add column open_until timestamptz,
  -- The teacher's "finished", or the end of the period by a change of owner.
  add column finished_at timestamptz;

alter table lesson_plan_requests add constraint lesson_plan_requests_kind_from_check check (
  (kind = 'replan') = (from_date is not null)
);

alter table lesson_plan_requests add constraint lesson_plan_requests_state_check check (
  case status
    when 'prepared' then requested_by is null and sent_at is null and decided_by is null
      and open_until is null and kind = 'replan'
    when 'sent' then sent_at is not null and decided_by is null and open_until is null
    when 'approved' then decided_by is not null and decided_at is not null
      and open_until is not null and (days is not null or kind = 'extension')
    when 'refused' then decided_by is not null and decided_at is not null and open_until is null
    else true
  end
);

grant insert (reason, requested_by, sent_at, decided_by, decided_at, decision_reason, days,
  open_until, finished_at) on lesson_plan_requests to sodiq_app;
grant update (status, reason, requested_by, sent_at, decided_by, decided_at,
  decision_reason, days, open_until, finished_at) on lesson_plan_requests to sodiq_app;

-- The lessons a request names for Text (`09`: "which lessons"; `edge`:
-- "History and requests refer to dates"). The approver can untick one with
-- a reason.
create table lesson_plan_request_lessons (
  branch_id uuid not null references branches (id),
  request_id uuid not null,
  -- No key: a lesson removed leaves the line; its date stays.
  lesson_id uuid not null,
  lesson_date date not null,
  approved boolean not null default true,
  untick_reason text not null default ''
    constraint lesson_plan_request_lessons_reason_check check (length(untick_reason) <= 1000),
  constraint lesson_plan_request_lessons_request_fkey foreign key (request_id, branch_id)
    references lesson_plan_requests (id, branch_id),
  primary key (branch_id, request_id, lesson_id)
);

alter table lesson_plan_request_lessons enable row level security;
create policy branch_filter on lesson_plan_request_lessons for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on lesson_plan_request_lessons to sodiq_app;
grant insert (branch_id, request_id, lesson_id, lesson_date, approved, untick_reason)
  on lesson_plan_request_lessons to sodiq_app;
grant update (approved, untick_reason) on lesson_plan_request_lessons to sodiq_app;

-- The event of a cause (`09`, Approving together: "all requests caused by
-- one event"): one id per transaction that prepared or added to requests.
-- The rows of 0115 take one event per branch and moment.
alter table lesson_plan_request_causes add column event_id uuid;

update lesson_plan_request_causes c
set event_id = md5(c.branch_id::text || '|' || c.at::text)::uuid;

alter table lesson_plan_request_causes alter column event_id set not null;

create index lesson_plan_request_causes_event_idx on lesson_plan_request_causes (event_id);

grant insert (event_id) on lesson_plan_request_causes to sodiq_app;

-- A journal made after its quarter's window ended (`edge`: "A teacher is
-- hired in week 5, or a subject is added mid-quarter"), and the request of
-- the window's end (`edge`: "When the window ends, a request is prepared
-- for every incomplete plan"), stored when it is sent or decided.
alter table lesson_plan_request_causes drop constraint lesson_plan_request_causes_kind_check;
alter table lesson_plan_request_causes add constraint lesson_plan_request_causes_kind_check check (
  kind in ('not_covered', 'rows_added', 'moved_back', 'owner_changed', 'journal_added',
    'window_end')
);

-- ---------------------------------------------------------------------------
-- "Edited after the lesson", per journal (the row is per journal since 0116).

alter table lesson_plan_places
  add column edited_after_lesson boolean not null default false;

grant update (edited_after_lesson) on lesson_plan_places to sodiq_app;

-- ---------------------------------------------------------------------------
-- A plan record for every journal of a graded subject and every quarter of
-- its year, from the moment the journal exists (review decision 21). A
-- journal and quarter that already has one keeps it. The journal is marked,
-- so the follow lays the new plans before the commit (0115). Runs as the
-- invoker.

create function lesson_plan_records_of_journal() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  quarter record;
  plan uuid;
begin
  if (select s.journal_type from subjects s where s.id = new.subject_id) is distinct from 'graded' then
    return null;
  end if;
  for quarter in
    select q.id from quarters q
    where q.academic_year_id = new.academic_year_id and q.branch_id = new.branch_id
    order by q.number
  loop
    if not exists (
      select 1 from lesson_plan_journals l
      where l.journal_id = new.id and l.quarter_id = quarter.id
    ) then
      insert into lesson_plans (branch_id, quarter_id, subject_id)
      values (new.branch_id, quarter.id, new.subject_id)
      returning id into plan;
      insert into lesson_plan_journals (branch_id, plan_id, journal_id, quarter_id)
      values (new.branch_id, plan, new.id, quarter.id);
    end if;
  end loop;
  if lesson_history_applies() then
    insert into lesson_plan_follow_marks (branch_id, journal_id) values (new.branch_id, new.id);
  end if;
  return null;
end;
$$;

create trigger lesson_plan_records_of_journal
  after insert on journals
  for each row execute function lesson_plan_records_of_journal();

-- Every journal of a graded subject that exists now, in a year not closed.
do $$
declare
  link record;
  plan uuid;
begin
  for link in
    select j.id as journal_id, j.branch_id, j.subject_id, q.id as quarter_id
    from journals j
    join subjects s on s.id = j.subject_id and s.journal_type = 'graded'
    join academic_years y on y.id = j.academic_year_id and y.status <> 'closed'
    join quarters q on q.academic_year_id = j.academic_year_id and q.branch_id = j.branch_id
    where not exists (
      select 1 from lesson_plan_journals l where l.journal_id = j.id and l.quarter_id = q.id
    )
    order by j.id, q.number
  loop
    insert into lesson_plans (branch_id, quarter_id, subject_id)
    values (link.branch_id, link.quarter_id, link.subject_id)
    returning id into plan;
    insert into lesson_plan_journals (branch_id, plan_id, journal_id, quarter_id)
    values (link.branch_id, plan, link.journal_id, link.quarter_id);
  end loop;
end;
$$;
