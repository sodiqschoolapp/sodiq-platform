-- 0123 Exemptions (task 8.5, pull request #223).
--
-- docs/spec/07-journal.md, Exemptions: "An exemption is granted by the
-- Academic Vice Principal; it is not a mark the teacher chooses. While it
-- lasts, the student is out of the journal: their cells are closed". Kind
-- (temporary, full), scope (all subjects or chosen ones), dates (whole days,
-- or chosen lesson slots of one day), reason and document.
-- docs/spec/edge-cases/exemptions.md, every row; edge/00-definitions,
-- Expected student: "... and is not exempt for that lesson".
--
-- The plan approved on pull request #223 with corrections 1 to 3; decisions 1
-- to 21. The moments compared are the transaction's (`app.now`, the injected
-- clock); start and end are school dates of the branch (decision 9).

-- ---------------------------------------------------------------------------
-- The exemptions.

create table exemptions (
  id uuid primary key default uuidv7(),
  -- The branch of the lessons it covers; it stays there when the student
  -- moves to another branch (decision 3), as a reason of absence does (0113).
  branch_id uuid not null references branches (id),
  -- The key on the id only, as journal_cells: no action, a student with an
  -- exemption is not deleted (edge/students-classes-groups, "A student is
  -- created twice by mistake").
  student_id uuid not null,
  year_id uuid not null,
  -- The exemptions of one form share it (edge/exemptions, "one form creates
  -- one exemption per chosen student, as a batch").
  batch_id uuid not null,
  kind text not null constraint exemptions_kind_check check (kind in ('temporary', 'full')),
  all_subjects boolean not null,
  start_date date not null,
  end_date date not null,
  -- A slot exemption: the local clock time of one day (decision 4).
  start_time time,
  end_time time,
  category text not null constraint exemptions_category_check check (
    category in ('illness', 'competition', 'family', 'school_event', 'other')
  ),
  detail text not null constraint exemptions_detail_check check (
    detail = btrim(detail) and length(detail) between 1 and 1000
  ),
  -- The document in the object store (decision 17): key, media type, name.
  document_key text,
  document_type text,
  document_name text constraint exemptions_document_name_check check (
    length(document_name) between 1 and 200
  ),
  granted_by uuid not null references accounts (id),
  assignment_id uuid references assignments (id),
  -- The transaction's moment, written by exemptions_write.
  granted_at timestamptz not null,
  -- "Void, entered in error" with a reason; a leaving or a branch move voids
  -- one that starts after its date (decision 14).
  voided_at timestamptz,
  voided_by uuid references accounts (id),
  void_cause text constraint exemptions_void_cause_check check (
    void_cause in ('error', 'leaving', 'branch_move')
  ),
  void_reason text constraint exemptions_void_reason_check check (
    void_reason = btrim(void_reason) and length(void_reason) between 1 and 500
  ),
  -- How the end was last set before its first one: null while it is the end
  -- it was entered with.
  end_cause text constraint exemptions_end_cause_check check (
    end_cause in ('end', 'leaving', 'branch_move')
  ),
  -- The leaving (the inactive row of student_statuses) that ended or voided
  -- it, with the end it cut, given back by the leaving's cancel or undo.
  leaving_id uuid,
  end_before_leaving date,
  -- The exemption of the sending branch a confirmed move offer copied.
  moved_from_id uuid,
  version integer not null,
  changed_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint exemptions_student_fkey foreign key (student_id) references students (id),
  constraint exemptions_year_fkey foreign key (year_id, branch_id)
    references academic_years (id, branch_id),
  constraint exemptions_id_branch_key unique (id, branch_id),
  constraint exemptions_dates_check check (start_date <= end_date),
  -- edge/exemptions, "Full exemption for chosen slots of one day": "A full
  -- exemption is always whole days. An exemption for chosen slots is
  -- temporary and covers every subject in that time."
  constraint exemptions_slots_check check (
    (start_time is null and end_time is null)
    or (
      start_time is not null and end_time is not null and start_time < end_time
      and start_date = end_date and kind = 'temporary' and all_subjects
    )
  ),
  constraint exemptions_document_check check (
    (document_key is null) = (document_type is null)
    and (document_key is null) = (document_name is null)
  ),
  constraint exemptions_void_check check (
    (voided_at is null) = (void_cause is null)
    and (voided_at is null) = (voided_by is null)
    and (void_cause = 'error') = (void_reason is not null)
  ),
  constraint exemptions_leaving_check check (
    (leaving_id is null) = (end_before_leaving is null)
  )
);

create index exemptions_student_idx on exemptions (student_id);
create index exemptions_branch_dates_idx on exemptions (branch_id, start_date, end_date);
create index exemptions_batch_idx on exemptions (batch_id);
create index exemptions_leaving_idx on exemptions (leaving_id) where leaving_id is not null;

alter table exemptions enable row level security;
create policy branch_filter on exemptions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on exemptions to sodiq_app;
grant insert (
  id, branch_id, student_id, year_id, batch_id, kind, all_subjects, start_date, end_date,
  start_time, end_time, category, detail, document_key, document_type, document_name,
  granted_by, assignment_id, granted_at, moved_from_id, version, changed_at
) on exemptions to sodiq_app;
grant update (
  student_id, kind, all_subjects, start_date, end_date, start_time, end_time, category, detail,
  document_key, document_type, document_name, voided_at, voided_by, void_cause, void_reason,
  end_cause, leaving_id, end_before_leaving
) on exemptions to sodiq_app;

-- The chosen subjects; none when all subjects are covered.
create table exemption_subjects (
  branch_id uuid not null references branches (id),
  exemption_id uuid not null,
  subject_id uuid not null references subjects (id),
  constraint exemption_subjects_pkey primary key (exemption_id, subject_id),
  constraint exemption_subjects_exemption_fkey foreign key (exemption_id, branch_id)
    references exemptions (id, branch_id)
);

create index exemption_subjects_subject_idx on exemption_subjects (subject_id);

alter table exemption_subjects enable row level security;
create policy branch_filter on exemption_subjects for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Changed only before the start (exemptions_subjects_guard).
grant select, insert, delete on exemption_subjects to sodiq_app;

-- ---------------------------------------------------------------------------
-- The time each exemption covers, per subject key, for the overlap rule:
-- "Two exemptions conflict only when their dates overlap and both cover all
-- subjects, or both name the same subject" (edge/exemptions, row 1; the time
-- range is the finer rule, decision 7). The nil uuid stands for all subjects.
-- Written only by the triggers below. An exclusion constraint sees every row
-- whatever the row filter, so two branches' exemptions of one student meet.

create table exemption_spans (
  branch_id uuid not null references branches (id),
  exemption_id uuid not null,
  student_id uuid not null,
  subject_key uuid not null,
  -- Local time of the branch: whole days from 00:00 of the start to 00:00
  -- after the end, a slot exemption its own range of the day.
  span tsrange not null,
  live boolean not null,
  constraint exemption_spans_pkey primary key (exemption_id, subject_key),
  constraint exemption_spans_exemption_fkey foreign key (exemption_id, branch_id)
    references exemptions (id, branch_id),
  constraint exemption_spans_no_overlap exclude using gist (
    student_id with =, subject_key with =, span with &&
  ) where (live)
);

create index exemption_spans_student_idx on exemption_spans using gist (student_id, span);

alter table exemption_spans enable row level security;
create policy branch_filter on exemption_spans for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert, delete on exemption_spans to sodiq_app;

create trigger exemption_spans_direct
  before insert or update or delete on exemption_spans
  for each row execute function timetable_trigger_only('exemption_spans_direct');

create function exemption_span_of(e exemptions) returns tsrange
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when e.start_time is null then
      tsrange(e.start_date::timestamp, (e.end_date + 1)::timestamp, '[)')
    else
      tsrange(e.start_date + e.start_time, e.start_date + e.end_time, '[)')
  end
$$;

create function exemption_spans_rebuild(exemption_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  delete from exemption_spans s where s.exemption_id = exemption_ref;
  insert into exemption_spans (branch_id, exemption_id, student_id, subject_key, span, live)
    select e.branch_id, e.id, e.student_id, '00000000-0000-0000-0000-000000000000'::uuid,
      exemption_span_of(e), e.voided_at is null
    from exemptions e
    where e.id = exemption_ref and e.all_subjects
    union all
    select e.branch_id, e.id, e.student_id, x.subject_id, exemption_span_of(e), e.voided_at is null
    from exemptions e
    join exemption_subjects x on x.exemption_id = e.id
    where e.id = exemption_ref and not e.all_subjects;
end;
$$;

create function exemptions_spans() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform exemption_spans_rebuild(new.id);
  return null;
end;
$$;

create trigger exemptions_spans
  after insert or update on exemptions
  for each row execute function exemptions_spans();

create function exemption_subjects_spans() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform exemption_spans_rebuild(coalesce(new.exemption_id, old.exemption_id));
  return null;
end;
$$;

create trigger exemption_subjects_spans
  after insert or delete on exemption_subjects
  for each row execute function exemption_subjects_spans();

-- ---------------------------------------------------------------------------
-- The writes of an exemption. Runs as the invoker.
--
-- - The version, the moment and the grant's moment are the transaction's.
-- - Both dates inside its year, in the branch; a full one is entered to the
--   year's last day ("Full: from a date to the end of the academic year, or
--   until cancelled"), and later only End and Void shorten it.
-- - A closed year refuses every write.
-- - Before the start date (branch time) every field changes; from the start
--   only the end date, the document and the void (edge/exemptions, "After it
--   starts, only the end date changes; anything else is 'void and enter a
--   new one'"). A voided exemption is final.
-- - The student changes only through a merge written in this transaction.

create function exemption_today(branch_ref uuid, moment timestamptz) returns date
language sql
stable
set search_path = pg_catalog, public
as $$
  select (moment at time zone b.time_zone)::date from branches b where b.id = branch_ref
$$;

create function exemptions_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  year_row academic_years;
  today date;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'exemption_moment'
      using errcode = 'check_violation', constraint = 'exemption_moment';
  end if;
  select * into year_row from academic_years y
    where y.id = new.year_id and y.branch_id = new.branch_id
    for share;
  if year_row.status = 'closed' then
    raise exception 'exemption_closed_year'
      using errcode = 'check_violation', constraint = 'exemption_closed_year';
  end if;
  if new.start_date < year_row.start_date or new.end_date > year_row.end_date then
    raise exception 'exemption_outside_year'
      using errcode = 'check_violation', constraint = 'exemption_outside_year';
  end if;
  today := exemption_today(new.branch_id, moment);
  if tg_op = 'INSERT' then
    new.version := 1;
    new.granted_at := moment;
    if new.kind = 'full' and new.end_date <> year_row.end_date then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
  else
    -- A void is final, but the void of a leaving is given back by its cancel
    -- or undo (decision 14): void and leaving fields only.
    if old.voided_at is not null
      and (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id')
      and not (
        old.void_cause = 'leaving' and new.voided_at is null and new.leaving_id is null
        and (to_jsonb(new) - array['student_id', 'voided_at', 'voided_by', 'void_cause', 'leaving_id', 'end_before_leaving'])
          = (to_jsonb(old) - array['student_id', 'voided_at', 'voided_by', 'void_cause', 'leaving_id', 'end_before_leaving'])
      ) then
      raise exception 'exemption_voided'
        using errcode = 'check_violation', constraint = 'exemption_voided';
    end if;
    if new.student_id is distinct from old.student_id
      and not student_merge_here(old.student_id, new.student_id) then
      raise exception 'exemption_student'
        using errcode = 'check_violation', constraint = 'exemption_student';
    end if;
    if old.start_date <= today and (
      new.kind, new.all_subjects, new.start_date, new.start_time, new.end_time,
      new.category, new.detail
    ) is distinct from (
      old.kind, old.all_subjects, old.start_date, old.start_time, old.end_time,
      old.category, old.detail
    ) then
      raise exception 'exemption_started'
        using errcode = 'check_violation', constraint = 'exemption_started';
    end if;
    if new.kind = 'full' and old.start_date > today and new.end_date <> year_row.end_date then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
    if new.kind = 'full' and old.start_date <= today and new.end_date > old.end_date
      and new.end_date <> year_row.end_date then
      raise exception 'exemption_full_end'
        using errcode = 'check_violation', constraint = 'exemption_full_end';
    end if;
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  return new;
end;
$$;

create trigger exemptions_write
  before insert or update on exemptions
  for each row execute function exemptions_write();

-- The chosen subjects change only before the start, of an exemption of
-- chosen subjects; at the commit, one of chosen subjects names at least one.
create function exemption_subjects_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent exemptions;
begin
  select * into parent from exemptions e
    where e.id = coalesce(new.exemption_id, old.exemption_id)
    for update;
  if parent.all_subjects or parent.voided_at is not null
    or (tg_op = 'DELETE' and parent.start_date <= exemption_today(parent.branch_id, class_tutors_moment()))
    or (tg_op = 'INSERT' and parent.version > 1
      and parent.start_date <= exemption_today(parent.branch_id, class_tutors_moment())) then
    raise exception 'exemption_subjects_state'
      using errcode = 'check_violation', constraint = 'exemption_subjects_state';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.branch_id := parent.branch_id;
  return new;
end;
$$;

create trigger exemption_subjects_guard
  before insert or delete on exemption_subjects
  for each row execute function exemption_subjects_guard();

create function exemptions_scope_present() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from exemptions e
    where e.id = new.id and not e.all_subjects
      and not exists (select 1 from exemption_subjects x where x.exemption_id = e.id)
  ) then
    raise exception 'exemption_subjects_missing'
      using errcode = 'check_violation', constraint = 'exemption_subjects_missing';
  end if;
  if exists (
    select 1 from exemptions e
    where e.id = new.id and e.all_subjects
      and exists (select 1 from exemption_subjects x where x.exemption_id = e.id)
  ) then
    raise exception 'exemption_subjects_state'
      using errcode = 'check_violation', constraint = 'exemption_subjects_state';
  end if;
  return null;
end;
$$;

create constraint trigger exemptions_scope_present
  after insert or update on exemptions
  deferrable initially deferred
  for each row execute function exemptions_scope_present();

-- ---------------------------------------------------------------------------
-- "Leave it as attended (the exemption skips it)" (07, Problem cases): the
-- lesson the late-entry choice kept. Cascades with the lesson: a lesson
-- removed has nothing left to skip (correction 2).

create table exemption_skips (
  branch_id uuid not null references branches (id),
  exemption_id uuid not null,
  lesson_id uuid not null,
  constraint exemption_skips_pkey primary key (exemption_id, lesson_id),
  constraint exemption_skips_exemption_fkey foreign key (exemption_id, branch_id)
    references exemptions (id, branch_id),
  constraint exemption_skips_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade
);

create index exemption_skips_lesson_idx on exemption_skips (lesson_id);

alter table exemption_skips enable row level security;
create policy branch_filter on exemption_skips for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on exemption_skips to sodiq_app;

-- The values "exempt and clear" removed (decision 2), given back when the
-- lesson stops being covered by every exemption (edge/exemptions, row 4:
-- "Cells get back the mark they had before"). `given_back_at` set once. A
-- cell or lesson removed takes its rows with it: nothing is left to give
-- back, and its history keeps the values (correction 2).

create table exemption_clears (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  exemption_id uuid not null,
  cell_id uuid not null references journal_cells (id) on delete cascade,
  lesson_id uuid not null,
  student_id uuid not null,
  mark smallint,
  score integer,
  -- The cell's version the clear wrote.
  cleared_version integer not null,
  given_back_at timestamptz,
  constraint exemption_clears_exemption_fkey foreign key (exemption_id, branch_id)
    references exemptions (id, branch_id),
  constraint exemption_clears_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  constraint exemption_clears_value_check check (mark is not null or score is not null),
  constraint exemption_clears_once unique (exemption_id, cell_id)
);

create index exemption_clears_cell_idx on exemption_clears (cell_id);
create index exemption_clears_lesson_idx on exemption_clears (lesson_id);

alter table exemption_clears enable row level security;
create policy branch_filter on exemption_clears for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on exemption_clears to sodiq_app;
grant insert (branch_id, exemption_id, cell_id, lesson_id, student_id, mark, score, cleared_version)
  on exemption_clears to sodiq_app;
grant update (given_back_at, student_id) on exemption_clears to sodiq_app;

-- The cells that reopened after a shorten or a void (edge/journal, Locks: "An
-- exemption is shortened and cells reopen in lessons that are already
-- locked": "Those cells open for 3 days, for those cells only. They are
-- optional"). Every reopened cell is stored; `open_until` is 00:00 branch time
-- after the third day following the day of the change (decision 5).

create table exemption_reopened_cells (
  branch_id uuid not null references branches (id),
  exemption_id uuid not null,
  lesson_id uuid not null,
  student_id uuid not null,
  open_until timestamptz not null,
  reopened_at timestamptz not null,
  constraint exemption_reopened_cells_pkey primary key (exemption_id, lesson_id, student_id, reopened_at),
  constraint exemption_reopened_cells_exemption_fkey foreign key (exemption_id, branch_id)
    references exemptions (id, branch_id),
  constraint exemption_reopened_cells_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  constraint exemption_reopened_cells_order_check check (reopened_at < open_until)
);

create index exemption_reopened_cells_lesson_idx on exemption_reopened_cells (lesson_id, student_id);

alter table exemption_reopened_cells enable row level security;
create policy branch_filter on exemption_reopened_cells for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on exemption_reopened_cells to sodiq_app;
grant insert (branch_id, exemption_id, lesson_id, student_id, open_until, reopened_at)
  on exemption_reopened_cells to sodiq_app;
grant update (student_id) on exemption_reopened_cells to sodiq_app;

create function exemption_reopened_cells_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' and new.reopened_at is distinct from class_tutors_moment() then
    raise exception 'exemption_moment'
      using errcode = 'check_violation', constraint = 'exemption_moment';
  end if;
  if tg_op = 'UPDATE' and not student_merge_here(old.student_id, new.student_id) then
    raise exception 'exemption_student'
      using errcode = 'check_violation', constraint = 'exemption_student';
  end if;
  return new;
end;
$$;

create trigger exemption_reopened_cells_write
  before insert or update on exemption_reopened_cells
  for each row execute function exemption_reopened_cells_write();

create function exemption_clears_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.student_id is distinct from old.student_id
      and not student_merge_here(old.student_id, new.student_id) then
      raise exception 'exemption_student'
        using errcode = 'check_violation', constraint = 'exemption_student';
    end if;
    if old.given_back_at is not null and new.given_back_at is distinct from old.given_back_at then
      raise exception 'exemption_clears_state'
        using errcode = 'check_violation', constraint = 'exemption_clears_state';
    end if;
    if new.given_back_at is not null and old.given_back_at is null
      and new.given_back_at is distinct from class_tutors_moment() then
      raise exception 'exemption_moment'
        using errcode = 'check_violation', constraint = 'exemption_moment';
    end if;
  end if;
  return new;
end;
$$;

create trigger exemption_clears_write
  before update on exemption_clears
  for each row execute function exemption_clears_write();

-- ---------------------------------------------------------------------------
-- An exemption offered to the receiving branch by a branch move
-- (edge/exemptions: "On a branch move it goes to the new branch's Academic
-- Vice Principal to confirm or drop"; decision 3, Look first): a copy of what
-- the receiving Academic Vice Principal needs to decide, with the dates
-- still to run.

create table exemption_move_offers (
  id uuid primary key default uuidv7(),
  -- The receiving branch.
  branch_id uuid not null references branches (id),
  move_id uuid not null references student_branch_moves (id),
  -- The sending branch's exemption; no key, it is another branch's row.
  source_id uuid not null,
  student_id uuid not null references students (id),
  kind text not null constraint exemption_move_offers_kind_check check (kind in ('temporary', 'full')),
  all_subjects boolean not null,
  subject_ids uuid[] not null,
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  category text not null,
  detail text not null,
  document_key text,
  document_type text,
  document_name text,
  offered_at timestamptz not null,
  decision text constraint exemption_move_offers_decision_check check (decision in ('confirm', 'drop')),
  decided_by uuid references accounts (id),
  decided_at timestamptz,
  -- The exemption the confirm wrote.
  exemption_id uuid,
  constraint exemption_move_offers_once unique (move_id, source_id),
  constraint exemption_move_offers_decided_check check (
    (decision is null) = (decided_at is null) and (decision is null) = (decided_by is null)
    and ((decision = 'confirm') = (exemption_id is not null))
  ),
  constraint exemption_move_offers_exemption_fkey foreign key (exemption_id, branch_id)
    references exemptions (id, branch_id)
);

create index exemption_move_offers_branch_idx on exemption_move_offers (branch_id, decision);
create index exemption_move_offers_student_idx on exemption_move_offers (student_id);

alter table exemption_move_offers enable row level security;
create policy branch_filter on exemption_move_offers for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on exemption_move_offers to sodiq_app;
grant insert (
  branch_id, move_id, source_id, student_id, kind, all_subjects, subject_ids, start_date, end_date,
  start_time, end_time, category, detail, document_key, document_type, document_name, offered_at
) on exemption_move_offers to sodiq_app;
grant update (decision, decided_by, decided_at, exemption_id, student_id) on exemption_move_offers to sodiq_app;

create function exemption_move_offers_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.offered_at is distinct from class_tutors_moment() then
      raise exception 'exemption_moment'
        using errcode = 'check_violation', constraint = 'exemption_moment';
    end if;
    return new;
  end if;
  if new.student_id is distinct from old.student_id then
    if not student_merge_here(old.student_id, new.student_id) then
      raise exception 'exemption_student'
        using errcode = 'check_violation', constraint = 'exemption_student';
    end if;
    return new;
  end if;
  if old.decision is not null or new.decided_at is distinct from class_tutors_moment() then
    raise exception 'exemption_move_offer_state'
      using errcode = 'check_violation', constraint = 'exemption_move_offer_state';
  end if;
  return new;
end;
$$;

create trigger exemption_move_offers_write
  before insert or update on exemption_move_offers
  for each row execute function exemption_move_offers_write();

-- ---------------------------------------------------------------------------
-- The file of a reason of absence (From 6.3, decision 10, Look first): the
-- same kind as the exemption's document.

alter table student_absence_reasons
  add column file_key text,
  add column file_type text,
  add column file_name text constraint student_absence_reasons_file_name_check check (
    length(file_name) between 1 and 200
  ),
  add constraint student_absence_reasons_file_check check (
    (file_key is null) = (file_type is null) and (file_key is null) = (file_name is null)
    and (file_key is null or category is not null)
  );

grant update (file_key, file_type, file_name) on student_absence_reasons to sodiq_app;

-- ---------------------------------------------------------------------------
-- Who is exempt for a lesson. Runs as the invoker.
--
-- An exemption of the student: live, its span overlapping the lesson's local
-- time in the branch time zone (edge/exemptions, row 3: "Any held lesson of
-- the student that overlaps it is exempt, including moved and substituted
-- lessons"), its scope holding the lesson's subject, and no skip of the
-- lesson. 'full' when one of them is full, else 'temporary' (row 1).

create function lesson_student_exemption_kind(lesson_ref uuid, student_ref uuid) returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case when bool_or(e.kind = 'full') then 'full' when count(*) > 0 then 'temporary' end
  from lessons l
  join branches b on b.id = l.branch_id
  join exemption_spans s
    on s.student_id = student_ref
    and s.live
    and s.subject_key in ('00000000-0000-0000-0000-000000000000'::uuid, l.subject_id)
    and s.span && tsrange(l.starts_at at time zone b.time_zone, l.ends_at at time zone b.time_zone, '[)')
  join exemptions e on e.id = s.exemption_id
  where l.id = lesson_ref
    and not exists (
      select 1 from exemption_skips k where k.exemption_id = e.id and k.lesson_id = l.id
    )
$$;

-- The students a kept block takes out of a held lesson (decision 12): the
-- members on the lesson's date of
-- - a class a bulk cancel chose, when the block was kept (`keep`) and that
--   class's time overlaps the lesson (task 5.6a-3);
-- - a class a standing exam keeps out of the block, while the exam seats it
--   and overlaps the lesson (task 5.6c-1);
-- - the grade that is off of a two-grade group's block kept on a day off
--   (task 5.6b-3).
-- A lesson whose members all are of those is fed by them alone: a bulk cancel
-- kept it held for its data (From 6.1b-2), and nobody in it is taken out.

create function lesson_kept_out_students(lesson_ref uuid) returns setof uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  with lesson as (
    select l.*, b.time_zone from lessons l join branches b on b.id = l.branch_id
    where l.id = lesson_ref and l.cancel_cause is null
  ),
  members as (
    select m.student_id from lesson l
      join class_memberships m on m.class_id = l.class_id
      where m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
    union
    select m.student_id from lesson l
      join group_memberships m on m.group_id = l.group_id
      where m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
  ),
  class_of as (
    select x.student_id, m.class_id, c.grade
    from members x
    cross join lesson l
    join class_memberships m on m.student_id = x.student_id
      and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
    join classes c on c.id = m.class_id
  ),
  out_classes as (
    select sp.class_id from lesson l
      join bulk_cancel_blocks k on k.block_id = l.block_id and k.lesson_date = l.lesson_date
        and k.choice = 'keep'
      join bulk_cancel_spans sp on sp.bulk_cancel_id = k.bulk_cancel_id
        and sp.starts_at < l.ends_at and l.starts_at < sp.ends_at
    union
    select o.class_id from lesson l
      join lesson_block_class_outs o on o.block_id = l.block_id
      join exams x on x.id = o.exam_id and x.cancel_cause is null
        and x.starts_at < l.ends_at and l.starts_at < x.ends_at
      where exists (
        select 1 from exam_room_classes r where r.exam_id = x.id and r.class_id = o.class_id
      )
  ),
  off_grades as (
    select e.grade_from, e.grade_to from lesson l
      join calendar_group_block_groups g on g.group_id = l.group_id
        and g.lesson_date = l.lesson_date
        and g.start_minutes = extract(
          epoch from ((l.starts_at at time zone l.time_zone) - l.lesson_date::timestamp)
        ) / 60
      join calendar_group_blocks k on k.id = g.block_id and k.choice = 'keep'
      join calendar_entries e on e.id = k.calendar_entry_id
  ),
  taken as (
    select c.student_id from class_of c where c.class_id in (select class_id from out_classes)
    union
    select c.student_id from class_of c
      join off_grades o on c.grade between coalesce(o.grade_from, 0) and coalesce(o.grade_to, 99)
  )
  select t.student_id from taken t
  where exists (select 1 from members m where m.student_id not in (select student_id from taken))
$$;

-- The mark shown for a student's lesson (07, Entering data: 4 temporarily
-- exempt, 5 fully exempt), or null: never stored (task 6.1a, decision 4).
create function lesson_student_exemption(lesson_ref uuid, student_ref uuid) returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    lesson_student_exemption_kind(lesson_ref, student_ref),
    case when student_ref in (select lesson_kept_out_students(lesson_ref)) then 'temporary' end
  )
$$;

grant execute on function exemption_span_of(exemptions) to sodiq_app;
grant execute on function exemption_today(uuid, timestamptz) to sodiq_app;
grant execute on function lesson_student_exemption_kind(uuid, uuid) to sodiq_app;
grant execute on function lesson_kept_out_students(uuid) to sodiq_app;
grant execute on function lesson_student_exemption(uuid, uuid) to sodiq_app;

-- edge/00-definitions, Expected student: "A student who is a member of the
-- class or group on the lesson's date and is not exempt for that lesson".
-- Same signature as 0108: lesson_expected_students and the closed-cell check
-- of journal_cells_write follow.
create or replace function lesson_student_expected(lesson_ref uuid, student_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from lessons l
    where l.id = lesson_ref
      and (
        exists (
          select 1 from class_memberships m
          where l.class_id is not null
            and m.class_id = l.class_id
            and m.student_id = student_ref
            and m.valid_from <= l.lesson_date
            and l.lesson_date < m.valid_until
        )
        or exists (
          select 1 from group_memberships m
          where l.group_id is not null
            and m.group_id = l.group_id
            and m.student_id = student_ref
            and m.valid_from <= l.lesson_date
            and l.lesson_date < m.valid_until
        )
      )
  )
  and lesson_student_exemption(lesson_ref, student_ref) is null;
$$;

-- ---------------------------------------------------------------------------
-- A reopened cell of a locked lesson takes a person's write as a late entry
-- until its `open_until`, for that cell only (decision 5). Same name as 0122;
-- the rest of the guard is unchanged.

create function exemption_reopened_open(lesson_ref uuid, student_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from exemption_reopened_cells r
    where r.lesson_id = lesson_ref and r.student_id = student_ref
      and r.reopened_at <= class_tutors_moment() and class_tutors_moment() < r.open_until
  )
$$;

grant execute on function exemption_reopened_open(uuid, uuid) to sodiq_app;

create or replace function journal_cells_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lock_at timestamptz;
begin
  if tg_op = 'DELETE' then
    -- Only the clearing of an empty lesson and the works triggers delete a cell (0108, 0119).
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  lock_at := journal_lesson_lock(new.lesson_id);
  if new.changed_how in ('entry', 'offline_entry', 'not_held', 'undo')
    and coalesce(journal_correction_reason(), '') = ''
    and lock_at is not null and class_tutors_moment() >= lock_at
    and exemption_reopened_open(new.lesson_id, new.student_id) then
    new.changed_how := case when new.changed_how = 'undo' then 'undo' else 'late_entry' end;
    return new;
  end if;
  new.changed_how := journal_edit_judge(
    new.branch_id, lock_at, new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, null, null
  );
  return new;
end;
$$;
