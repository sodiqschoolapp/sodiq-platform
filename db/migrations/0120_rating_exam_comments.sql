-- 0120 The rating exam, comments and the switches of a subject per quarter
-- (task 8.2, pull request #218).
--
-- edge/calculation, "'Rating exam' is switched off, or a subject becomes
-- attendance only, in week 5": "These switches are stored per quarter. They
-- are free before the quarter's first lesson. In a started quarter the change
-- is refused while scores exist." edge/calculation, "The rating exam": "One
-- column per rating journal and quarter, with an exam date set by the teacher
-- or the Academic Vice Principal. Whole numbers from 0 to 100. ... Each
-- student has a score, 'did not sit' (counts 0, set by the teacher) or
-- 'exempt' (set only by the Academic Vice Principal). A late sitting or a
-- retake replaces the score with a required reason; history is kept." "The
-- exam is not held for one group this quarter": "The Academic Vice Principal
-- marks the exam 'not held' for that journal and quarter." 07, Entering data,
-- Comments: "A comment can be attached to any attendance mark or score, and a
-- general note to a student for a lesson. Each comment is either 'staff only'
-- or 'visible to parents'." edge/00-definitions, Data on a lesson: "... or a
-- comment entered by a person." edge/developer-rules, History and audit.
--
-- The plan approved on pull request #218 with corrections 1 to 4: decisions
-- 1 to 18.

-- ---------------------------------------------------------------------------
-- The switches of a subject per quarter (decisions 1, 16 and 17): a log of
-- every change of the subject's switches and rounds, written only by the
-- trigger on `subjects`. A quarter reads the newest change that reaches it
-- (`subject_quarter_switches`). The quarter a change takes effect from is
-- carried by `subjects.switches_from`, written in the same update
-- (correction 2).

alter table subjects
  add column switches_from smallint constraint subjects_switches_from_check check (
    switches_from between 1 and 4
  );

grant update (switches_from) on subjects to sodiq_app;

create table subject_switches (
  id uuid primary key default uuidv7(),
  subject_id uuid not null references subjects (id),
  journal_type text not null,
  rating_exam boolean not null,
  weights_round integer not null,
  rating_round integer not null,
  -- The quarter of the change day's year the change takes effect from; null
  -- for the first row of a subject, which reaches every quarter.
  from_quarter smallint constraint subject_switches_from_quarter_check check (
    from_quarter between 1 and 4
  ),
  -- The transaction's moment (the injected clock); -infinity for the first
  -- row of a subject.
  changed_at timestamptz not null,
  written_xact xid8 not null default pg_current_xact_id()
);

create index subject_switches_subject_idx on subject_switches (subject_id, changed_at);

-- The trigger runs as the writer; a direct insert is refused by the depth
-- guard of 0058. No update, no delete.
grant select, insert on subject_switches to sodiq_app;

create trigger subject_switches_direct
  before insert on subject_switches
  for each row execute function timetable_trigger_only('subject_switches_direct');

insert into subject_switches (subject_id, journal_type, rating_exam, weights_round, rating_round, changed_at)
  select id, journal_type, rating_exam, weights_round, rating_round, '-infinity'
  from subjects;

-- A change of the switches names the quarter it takes effect from; the
-- rounds alone (a weights round of a change back to graded) go with it.
create function subjects_switches_log() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if tg_op = 'INSERT' then
    insert into subject_switches (
      subject_id, journal_type, rating_exam, weights_round, rating_round, changed_at
    ) values (
      new.id, new.journal_type, new.rating_exam, new.weights_round, new.rating_round, '-infinity'
    );
    return null;
  end if;
  if new.journal_type = old.journal_type and new.rating_exam = old.rating_exam
    and new.weights_round = old.weights_round and new.rating_round = old.rating_round then
    return null;
  end if;
  moment := class_tutors_moment();
  if moment is null and session_user <> 'sodiq_app' then
    -- A change by the migrator outside a request (a data fix, a test fixture):
    -- a row that reaches every quarter, as the first row of a subject.
    insert into subject_switches (
      subject_id, journal_type, rating_exam, weights_round, rating_round, changed_at
    ) values (
      new.id, new.journal_type, new.rating_exam, new.weights_round, new.rating_round, '-infinity'
    );
    return null;
  end if;
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if new.switches_from is null then
    raise exception 'subject_switches_from'
      using errcode = 'check_violation', constraint = 'subject_switches_from';
  end if;
  insert into subject_switches (
    subject_id, journal_type, rating_exam, weights_round, rating_round, from_quarter, changed_at
  ) values (
    new.id, new.journal_type, new.rating_exam, new.weights_round, new.rating_round,
    new.switches_from, moment
  );
  return null;
end;
$$;

create trigger subjects_switches_log
  after insert or update of journal_type, rating_exam, weights_round, rating_round on subjects
  for each row execute function subjects_switches_log();

-- The switches in force in a quarter: the newest change whose day (in the
-- quarter's branch time) is on or before the quarter's last day, and that
-- reaches the quarter's number in the year of that day (or the quarter's
-- year starts after that day). An undated quarter is reached by every
-- change of its number. Run as the invoker: the log is school-wide.
create function subject_quarter_switches(subject_ref uuid, quarter_ref uuid)
returns table (
  journal_type text,
  rating_exam boolean,
  weights_round integer,
  rating_round integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select s.journal_type, s.rating_exam, s.weights_round, s.rating_round
  from quarters q
  join academic_years y on y.id = q.academic_year_id
  join branches b on b.id = q.branch_id
  join subject_switches s on s.subject_id = subject_ref
  where q.id = quarter_ref
    and (
      s.changed_at = '-infinity'
      or (
        (q.end_date is null or (s.changed_at at time zone b.time_zone)::date <= q.end_date)
        and (
          s.from_quarter is null
          or q.number >= s.from_quarter
          or y.start_date > (s.changed_at at time zone b.time_zone)::date
        )
      )
    )
  order by s.changed_at desc, s.id desc
  limit 1
$$;

grant execute on function subject_quarter_switches(uuid, uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The rounds of a quarterly distribution are those of the quarter's switches
-- (correction 1): an open quarter that a later change does not reach keeps
-- its rounds, and its weights can still be saved. The daily distribution
-- keeps the subject's current round (0022). The subject row is read FOR
-- SHARE, as before.

create function subject_quarter_weights_switch_rounds() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  switches record;
begin
  perform 1 from subjects where id = new.subject_id for share;
  select * into switches from subject_quarter_switches(new.subject_id, new.quarter_id);
  if new.weights_round is distinct from switches.weights_round then
    raise exception 'subject_weights_current_round'
      using errcode = 'check_violation', constraint = 'subject_weights_current_round';
  end if;
  if new.rating_round is distinct from switches.rating_round then
    raise exception 'subject_quarter_weights_current_rating_round'
      using errcode = 'check_violation',
        constraint = 'subject_quarter_weights_current_rating_round';
  end if;
  return new;
end;
$$;

drop trigger subject_quarter_weights_current_round on subject_quarter_weights;
drop trigger subject_quarter_weights_current_rating_round on subject_quarter_weights;

create trigger subject_quarter_weights_switch_rounds
  before insert or update on subject_quarter_weights
  for each row execute function subject_quarter_weights_switch_rounds();

-- ---------------------------------------------------------------------------
-- The rating exam of a journal in a quarter (decisions 4, 5 and 7): its
-- hand-set date and "not held", written at the first write.

create table journal_rating_exams (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  journal_id uuid not null,
  quarter_id uuid not null,
  -- Set by hand; a standing linked exam's date comes first
  -- (`journal_rating_date`).
  exam_date date,
  not_held boolean not null default false,
  -- Written by journal_rating_exams_write: 1 on insert, one more on every update.
  version integer not null,
  changed_by uuid not null references accounts (id),
  changed_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_rating_exams_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id),
  constraint journal_rating_exams_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint journal_rating_exams_key unique (branch_id, journal_id, quarter_id),
  constraint journal_rating_exams_id_branch_key unique (id, branch_id)
);

create index journal_rating_exams_quarter_idx on journal_rating_exams (quarter_id);

alter table journal_rating_exams enable row level security;
create policy branch_filter on journal_rating_exams for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_rating_exams to sodiq_app;
grant insert (id, branch_id, journal_id, quarter_id, exam_date, not_held, version, changed_by, changed_at)
  on journal_rating_exams to sodiq_app;
grant update (exam_date, not_held, changed_by) on journal_rating_exams to sodiq_app;

-- The date of the one standing rating exam linking the journal in the
-- quarter (5.6c-3b), or null.
create function journal_rating_linked_date(journal_ref uuid, quarter_ref uuid) returns date
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.exam_date
  from exam_rating_journals r
  join exams e on e.id = r.exam_id
  join quarters q on q.id = quarter_ref
  where r.journal_id = journal_ref
    and r.linked
    and e.rating_exam
    and e.cancel_cause is null
    and e.exam_date between q.start_date and q.end_date
  order by e.exam_date, e.id
  limit 1
$$;

grant execute on function journal_rating_linked_date(uuid, uuid) to sodiq_app;

-- The date in force of a journal's rating exam in a quarter (decision 5):
-- a standing linked exam's date, else the hand-set date.
create function journal_rating_date(journal_ref uuid, quarter_ref uuid) returns date
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    journal_rating_linked_date(journal_ref, quarter_ref),
    (
      select x.exam_date from journal_rating_exams x
      where x.journal_id = journal_ref and x.quarter_id = quarter_ref
    )
  )
$$;

grant execute on function journal_rating_date(uuid, uuid) to sodiq_app;

-- Whether the subject of a journal has the rating exam in a quarter.
create function journal_rating_on(journal_ref uuid, quarter_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select s.journal_type = 'graded' and s.rating_exam
      from journals j
      cross join lateral subject_quarter_switches(j.subject_id, quarter_ref) s
      where j.id = journal_ref
    ),
    false
  )
$$;

grant execute on function journal_rating_on(uuid, uuid) to sodiq_app;

create function journal_rating_exams_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  quarter_row quarters;
  journal_year uuid;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  select * into quarter_row from quarters q where q.id = new.quarter_id for share;
  select j.academic_year_id into journal_year from journals j where j.id = new.journal_id;
  if journal_year is distinct from quarter_row.academic_year_id then
    raise exception 'journal_rating_quarter'
      using errcode = 'check_violation', constraint = 'journal_rating_quarter';
  end if;
  if new.exam_date is not null and (
    quarter_row.start_date is null
    or new.exam_date < quarter_row.start_date
    or new.exam_date > quarter_row.end_date
  ) then
    raise exception 'journal_rating_date_quarter'
      using errcode = 'check_violation', constraint = 'journal_rating_date_quarter';
  end if;
  if not journal_rating_on(new.journal_id, new.quarter_id) then
    raise exception 'journal_rating_switch_off'
      using errcode = 'check_violation', constraint = 'journal_rating_switch_off';
  end if;
  return new;
end;
$$;

create trigger journal_rating_exams_write
  before insert or update on journal_rating_exams
  for each row execute function journal_rating_exams_write();

-- ---------------------------------------------------------------------------
-- The entry of a student (decisions 5, 8 and 9).

create table journal_rating_entries (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  rating_exam_id uuid not null,
  -- No action (From 2.4b-1): a student with an entry is never deleted.
  student_id uuid not null,
  -- Null once cleared.
  kind text constraint journal_rating_entries_kind_check check (
    kind in ('score', 'did_not_sit', 'exempt')
  ),
  score smallint constraint journal_rating_entries_score_check check (score between 0 and 100),
  -- Required on every write over an entry (decision 9); null on a first entry.
  reason text constraint journal_rating_entries_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  version integer not null,
  changed_by uuid not null references accounts (id),
  changed_how text not null constraint journal_rating_entries_changed_how_check check (
    changed_how in ('entry', 'late_entry', 'correction', 'undo')
  ),
  changed_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_rating_entries_score_kind_check check ((kind = 'score') = (score is not null)
    or (kind is null and score is null)),
  constraint journal_rating_entries_exam_fkey foreign key (rating_exam_id, branch_id)
    references journal_rating_exams (id, branch_id),
  constraint journal_rating_entries_student_fkey foreign key (student_id) references students (id),
  constraint journal_rating_entries_key unique (branch_id, rating_exam_id, student_id)
);

create index journal_rating_entries_student_idx on journal_rating_entries (student_id);

alter table journal_rating_entries enable row level security;
create policy branch_filter on journal_rating_entries for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_rating_entries to sodiq_app;
grant insert (id, branch_id, rating_exam_id, student_id, kind, score, reason, version, changed_by, changed_how, changed_at)
  on journal_rating_entries to sodiq_app;
grant update (kind, score, reason, changed_by, changed_how) on journal_rating_entries to sodiq_app;

create function journal_rating_entries_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  exam_row journal_rating_exams;
  journal_row journals;
  quarter_row quarters;
  in_force date;
  today date;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
    -- Every write over an entry needs its reason (decision 9).
    if new.reason is null then
      raise exception 'journal_rating_reason'
        using errcode = 'check_violation', constraint = 'journal_rating_reason';
    end if;
  end if;
  new.changed_at := moment;
  if new.kind is null then
    return new;
  end if;
  select * into exam_row from journal_rating_exams x where x.id = new.rating_exam_id for share;
  if exam_row.not_held then
    raise exception 'journal_rating_not_held'
      using errcode = 'check_violation', constraint = 'journal_rating_not_held';
  end if;
  if not journal_rating_on(exam_row.journal_id, exam_row.quarter_id) then
    raise exception 'journal_rating_switch_off'
      using errcode = 'check_violation', constraint = 'journal_rating_switch_off';
  end if;
  in_force := journal_rating_date(exam_row.journal_id, exam_row.quarter_id);
  if in_force is null then
    raise exception 'journal_rating_no_date'
      using errcode = 'check_violation', constraint = 'journal_rating_no_date';
  end if;
  select (moment at time zone b.time_zone)::date into today
    from branches b where b.id = new.branch_id;
  if today < in_force then
    raise exception 'journal_rating_not_yet'
      using errcode = 'check_violation', constraint = 'journal_rating_not_yet';
  end if;
  select * into journal_row from journals j where j.id = exam_row.journal_id;
  select * into quarter_row from quarters q where q.id = exam_row.quarter_id;
  perform 1 from class_memberships m
    where journal_row.class_id is not null
      and m.class_id = journal_row.class_id
      and m.student_id = new.student_id
    for share;
  perform 1 from group_memberships m
    where journal_row.group_id is not null
      and m.group_id = journal_row.group_id
      and m.student_id = new.student_id
    for share;
  -- A member on any day from the date in force to the quarter's end (decision 8).
  if not exists (
    select 1 from class_memberships m
    where journal_row.class_id is not null
      and m.class_id = journal_row.class_id
      and m.student_id = new.student_id
      and m.valid_from <= quarter_row.end_date
      and m.valid_until > in_force
      and m.valid_from < m.valid_until
    union all
    select 1 from group_memberships m
    where journal_row.group_id is not null
      and m.group_id = journal_row.group_id
      and m.student_id = new.student_id
      and m.valid_from <= quarter_row.end_date
      and m.valid_until > in_force
      and m.valid_from < m.valid_until
  ) then
    raise exception 'journal_rating_not_member'
      using errcode = 'check_violation', constraint = 'journal_rating_not_member';
  end if;
  return new;
end;
$$;

create trigger journal_rating_entries_write
  before insert or update on journal_rating_entries
  for each row execute function journal_rating_entries_write();

-- ---------------------------------------------------------------------------
-- The history of the rating exam: its date, "not held" and every entry,
-- written only by the triggers below, append-only and partitioned by month.

create table journal_rating_history (
  id uuid not null default uuidv7(),
  branch_id uuid not null references branches (id),
  rating_exam_id uuid not null,
  journal_id uuid not null,
  quarter_id uuid not null,
  -- Null for a line of the exam row (date, "not held").
  student_id uuid,
  entry_id uuid,
  version integer not null,
  date_before date,
  date_after date,
  not_held_before boolean,
  not_held_after boolean,
  kind_before text,
  kind_after text,
  score_before smallint,
  score_after smallint,
  reason text,
  changed_by uuid not null,
  changed_how text not null,
  changed_at timestamptz not null,
  written_xact xid8 not null default pg_current_xact_id(),
  primary key (id, changed_at)
) partition by range (changed_at);

create index journal_rating_history_exam_idx on journal_rating_history (rating_exam_id, student_id);
create index journal_rating_history_student_idx on journal_rating_history (student_id);
create index journal_rating_history_branch_idx on journal_rating_history (branch_id, changed_at);
create index journal_rating_history_xact_idx on journal_rating_history (written_xact);

alter table journal_rating_history enable row level security;
create policy branch_filter on journal_rating_history for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- Comments (decision 10): one per target, cleared and never deleted by the
-- application, with history.

create table journal_comments (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- No action (From 2.4b-1): a student with a comment is never deleted.
  student_id uuid not null,
  target text not null constraint journal_comments_target_check check (
    target in ('mark', 'work', 'note', 'rating')
  ),
  -- The lesson of a mark, a work number or a note; null for a rating entry.
  lesson_id uuid,
  work_id uuid,
  rating_exam_id uuid,
  -- Null once cleared.
  body text constraint journal_comments_body_check check (length(btrim(body)) between 1 and 1000),
  visibility text not null constraint journal_comments_visibility_check check (
    visibility in ('staff', 'parents')
  ),
  version integer not null,
  changed_by uuid not null references accounts (id),
  changed_how text not null constraint journal_comments_changed_how_check check (
    changed_how in ('entry', 'restored')
  ),
  changed_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_comments_keys_check check (
    case target
      when 'mark' then lesson_id is not null and work_id is null and rating_exam_id is null
      when 'note' then lesson_id is not null and work_id is null and rating_exam_id is null
      when 'work' then lesson_id is not null and work_id is not null and rating_exam_id is null
      else lesson_id is null and work_id is null and rating_exam_id is not null
    end
  ),
  constraint journal_comments_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id),
  -- A work moves with its homework to the check lesson (8.1); its comments follow.
  constraint journal_comments_work_fkey foreign key (work_id, lesson_id)
    references journal_works (id, lesson_id) on update cascade,
  constraint journal_comments_rating_fkey foreign key (rating_exam_id, branch_id)
    references journal_rating_exams (id, branch_id),
  constraint journal_comments_student_fkey foreign key (student_id) references students (id),
  constraint journal_comments_key unique nulls not distinct (
    branch_id, student_id, target, lesson_id, work_id, rating_exam_id
  )
);

create index journal_comments_lesson_idx on journal_comments (lesson_id);
create index journal_comments_student_idx on journal_comments (student_id);
create index journal_comments_work_idx on journal_comments (work_id) where work_id is not null;
create index journal_comments_rating_idx on journal_comments (rating_exam_id)
  where rating_exam_id is not null;

alter table journal_comments enable row level security;
create policy branch_filter on journal_comments for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Delete only through a forced delete of the lesson (below).
grant select, delete on journal_comments to sodiq_app;
grant insert (id, branch_id, student_id, target, lesson_id, work_id, rating_exam_id, body, visibility, version, changed_by, changed_how, changed_at)
  on journal_comments to sodiq_app;
grant update (body, visibility, changed_by, changed_how) on journal_comments to sodiq_app;

create function journal_comments_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if tg_op = 'INSERT' and new.changed_how = 'restored' then
    if not forced_restore_names('lesson', new.lesson_id) then
      raise exception 'journal_comment_restore'
        using errcode = 'check_violation', constraint = 'journal_comment_restore';
    end if;
    return new;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    if new.lesson_id is not distinct from old.lesson_id
      and new.body is not distinct from old.body
      and new.visibility = old.visibility then
      -- A move of the work's lesson only (on update cascade).
      return new;
    end if;
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  if new.body is null then
    return new;
  end if;
  if new.lesson_id is not null then
    if exists (select 1 from lessons l where l.id = new.lesson_id and l.cancel_cause is not null) then
      raise exception 'journal_cell_cancelled'
        using errcode = 'check_violation', constraint = 'journal_cell_cancelled';
    end if;
    if not lesson_student_expected(new.lesson_id, new.student_id) then
      raise exception 'journal_cell_not_member'
        using errcode = 'check_violation', constraint = 'journal_cell_not_member';
    end if;
  end if;
  return new;
end;
$$;

create trigger journal_comments_write
  before insert or update on journal_comments
  for each row execute function journal_comments_write();

-- A comment is deleted only by a forced delete of its lesson (the store row
-- of this transaction names it).
create function journal_comments_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.lesson_id is null or not exists (
    select 1 from forced_deletes f
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
  ) then
    raise exception 'journal_comment_delete'
      using errcode = 'check_violation', constraint = 'journal_comment_delete';
  end if;
  return old;
end;
$$;

create trigger journal_comments_delete
  before delete on journal_comments
  for each row execute function journal_comments_delete();

create table journal_comment_history (
  id uuid not null default uuidv7(),
  branch_id uuid not null references branches (id),
  -- No key: the history outlives the comment.
  comment_id uuid not null,
  student_id uuid not null,
  target text not null,
  lesson_id uuid,
  work_id uuid,
  rating_exam_id uuid,
  version integer not null,
  body_before text,
  body_after text,
  visibility_before text,
  visibility_after text,
  changed_by uuid not null,
  changed_how text not null constraint journal_comment_history_changed_how_check check (
    changed_how in ('entry', 'restored', 'forced_delete')
  ),
  changed_at timestamptz not null,
  written_xact xid8 not null default pg_current_xact_id(),
  primary key (id, changed_at)
) partition by range (changed_at);

create index journal_comment_history_comment_idx on journal_comment_history (comment_id, version);
create index journal_comment_history_student_idx on journal_comment_history (student_id);
create index journal_comment_history_branch_idx on journal_comment_history (branch_id, changed_at);
create index journal_comment_history_xact_idx on journal_comment_history (written_xact);

alter table journal_comment_history enable row level security;
create policy branch_filter on journal_comment_history for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The month partitions of the two histories, each with the branch filter.
do $$
declare
  parent text;
  month date;
  suffix text;
  partition name;
begin
  foreach parent in array array['journal_rating_history', 'journal_comment_history'] loop
    for month in
      select generate_series(date '2026-10-01', date '2029-12-01', interval '1 month')::date
    loop
      suffix := to_char(month, 'YYYY_MM');
      execute format(
        'create table public.%I partition of public.%I for values from (%L) to (%L)',
        parent || '_' || suffix,
        parent,
        to_char(month, 'YYYY-MM-DD') || ' 00:00:00+00',
        to_char(month + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
      );
    end loop;
    execute format('create table public.%I partition of public.%I default', parent || '_default', parent);
    for partition in
      select c.relname
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class c on c.oid = i.inhrelid
      where i.inhparent = ('public.' || parent)::regclass
    loop
      execute format('alter table public.%I enable row level security', partition);
      execute format(
        'create policy branch_filter on public.%I for all to sodiq_app
           using (branch_id = any ((select public.app_branch_ids())::uuid[]))
           with check (branch_id = any ((select public.app_branch_ids())::uuid[]))',
        partition
      );
    end loop;
  end loop;
end
$$;

-- The triggers run as the writer; a direct insert is refused by the depth
-- guard of 0058. No update, no delete.
grant select, insert on journal_rating_history to sodiq_app;
grant select, insert on journal_comment_history to sodiq_app;

create trigger journal_rating_history_direct
  before insert on journal_rating_history
  for each row execute function timetable_trigger_only('journal_rating_history_direct');

create trigger journal_comment_history_direct
  before insert on journal_comment_history
  for each row execute function timetable_trigger_only('journal_comment_history_direct');

create function journal_rating_exams_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.exam_date is not distinct from old.exam_date
    and new.not_held = old.not_held then
    return null;
  end if;
  -- The row written at the first write of an entry, with no date and not
  -- "not held", changes nothing to show.
  if tg_op = 'INSERT' and new.exam_date is null and not new.not_held then
    return null;
  end if;
  insert into journal_rating_history (
    branch_id, rating_exam_id, journal_id, quarter_id, version, date_before, date_after,
    not_held_before, not_held_after, changed_by, changed_how, changed_at
  ) values (
    new.branch_id, new.id, new.journal_id, new.quarter_id, new.version,
    case when tg_op = 'UPDATE' then old.exam_date end, new.exam_date,
    case when tg_op = 'UPDATE' then old.not_held end, new.not_held,
    new.changed_by, 'entry', new.changed_at
  );
  return null;
end;
$$;

create trigger journal_rating_exams_history
  after insert or update on journal_rating_exams
  for each row execute function journal_rating_exams_history();

create function journal_rating_entries_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_row journal_rating_exams;
begin
  select * into exam_row from journal_rating_exams x where x.id = new.rating_exam_id;
  insert into journal_rating_history (
    branch_id, rating_exam_id, journal_id, quarter_id, student_id, entry_id, version,
    kind_before, kind_after, score_before, score_after, reason, changed_by, changed_how, changed_at
  ) values (
    new.branch_id, new.rating_exam_id, exam_row.journal_id, exam_row.quarter_id, new.student_id,
    new.id, new.version,
    case when tg_op = 'UPDATE' then old.kind end, new.kind,
    case when tg_op = 'UPDATE' then old.score end, new.score,
    new.reason, new.changed_by, new.changed_how, new.changed_at
  );
  return null;
end;
$$;

create trigger journal_rating_entries_history
  after insert or update on journal_rating_entries
  for each row execute function journal_rating_entries_history();

create function journal_comments_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  author uuid;
  moment timestamptz;
begin
  if tg_op = 'DELETE' then
    select f.deleted_by into author from forced_deletes f
      where f.created_xact = pg_current_xact_id()
        and f.record_type = 'lesson'
        and f.record_id = old.lesson_id
      limit 1;
    moment := class_tutors_moment();
    if moment is null then
      raise exception 'journal_cell_moment'
        using errcode = 'check_violation', constraint = 'journal_cell_moment';
    end if;
    insert into journal_comment_history (
      branch_id, comment_id, student_id, target, lesson_id, work_id, rating_exam_id, version,
      body_before, visibility_before, changed_by, changed_how, changed_at
    ) values (
      old.branch_id, old.id, old.student_id, old.target, old.lesson_id, old.work_id,
      old.rating_exam_id, old.version + 1, old.body, old.visibility, author, 'forced_delete', moment
    );
    return null;
  end if;
  if tg_op = 'UPDATE' and new.version = old.version then
    return null;
  end if;
  insert into journal_comment_history (
    branch_id, comment_id, student_id, target, lesson_id, work_id, rating_exam_id, version,
    body_before, body_after, visibility_before, visibility_after, changed_by, changed_how, changed_at
  ) values (
    new.branch_id, new.id, new.student_id, new.target, new.lesson_id, new.work_id,
    new.rating_exam_id, new.version,
    case when tg_op = 'UPDATE' then old.body end, new.body,
    case when tg_op = 'UPDATE' then old.visibility end, new.visibility,
    new.changed_by, new.changed_how, coalesce(class_tutors_moment(), new.changed_at)
  );
  return null;
end;
$$;

create trigger journal_comments_history
  after insert or update or delete on journal_comments
  for each row execute function journal_comments_history();

-- ---------------------------------------------------------------------------
-- Whether a change of a subject's switches from a quarter number would reach
-- a started quarter holding scores (decisions 2 and 3, Look first): counts
-- of quarters per kind, across every branch, no rows and no names. A quarter
-- is reached as `subject_quarter_switches` reads it; started from its first
-- day in branch time; not reached once ended.

create function subject_switch_blocked(
  subject_ref uuid,
  from_quarter smallint,
  moment timestamptz,
  type_changes boolean,
  rating_changes boolean
)
returns table (scores integer, exams integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with reached as (
    select q.id, q.branch_id, q.start_date, q.end_date
    from quarters q
    join academic_years y on y.id = q.academic_year_id
    join branches b on b.id = q.branch_id
    where q.start_date is not null
      and q.start_date <= (moment at time zone b.time_zone)::date
      and q.end_date >= (moment at time zone b.time_zone)::date
      and (q.number >= from_quarter or y.start_date > (moment at time zone b.time_zone)::date)
  ), journals_reached as (
    select j.id as journal_id, r.id as quarter_id, r.start_date, r.end_date
    from reached r
    join journals j on j.academic_year_id = (select q.academic_year_id from quarters q where q.id = r.id)
      and j.branch_id = r.branch_id
    where j.subject_id = subject_ref
  ), rating as (
    select distinct jr.quarter_id
    from journals_reached jr
    join journal_rating_exams x on x.journal_id = jr.journal_id and x.quarter_id = jr.quarter_id
    where x.not_held
      or exists (
        select 1 from journal_rating_entries e
        where e.rating_exam_id = x.id and e.kind is not null
      )
  ), works as (
    select distinct jr.quarter_id
    from journals_reached jr
    join journals j on j.id = jr.journal_id
    join lessons l on l.branch_id = j.branch_id and l.subject_id = j.subject_id
      and (l.class_id = j.class_id or l.group_id = j.group_id)
      and l.lesson_date between jr.start_date and jr.end_date
    join journal_works w on w.lesson_id = l.id
    where w.total is not null or w.not_held
      or exists (select 1 from journal_cells c where c.work_id = w.id and c.score is not null)
  ), linked as (
    select distinct jr.quarter_id
    from journals_reached jr
    join exam_rating_journals rj on rj.journal_id = jr.journal_id
    join exams e on e.id = rj.exam_id
    where e.rating_exam and e.cancel_cause is null
      and e.exam_date between jr.start_date and jr.end_date
  )
  select
    (
      select count(*)::int from (
        select quarter_id from rating where rating_changes or type_changes
        union
        select quarter_id from works where type_changes
      ) s
    ),
    (select count(*)::int from linked where rating_changes)
$$;

revoke all on function subject_switch_blocked(uuid, smallint, timestamptz, boolean, boolean) from public;
grant execute on function subject_switch_blocked(uuid, smallint, timestamptz, boolean, boolean) to sodiq_app;

-- ---------------------------------------------------------------------------
-- Data on a lesson (edge/00-definitions; From 6.1a): a comment with a body
-- on the lesson joins. Same name and signature as 0108.

create or replace function lesson_holds_data(lesson_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from journal_cells c
    where c.lesson_id = lesson_ref and (c.mark is not null or c.score is not null)
  )
  or exists (
    select 1 from journal_works w
    where w.lesson_id = lesson_ref and (w.total is not null or w.not_held)
  )
  or exists (
    select 1 from journal_comments m
    where m.lesson_id = lesson_ref and m.body is not null
  );
$$;

-- ---------------------------------------------------------------------------
-- Every line of the five histories has an audit entry of its transaction in
-- its branch (0108, correction 1). Same name and signature.

create or replace function lesson_history_unaudited(xact xid8) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select xact is not null and (
    exists (
      select 1 from lesson_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_cell_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_work_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_rating_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_comment_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- The days a shorter year cuts off hold no entry (From 3.6b-2; 8.1 decision
-- 16): the comments of a lesson cut off and the rating entries whose date in
-- force is cut off join the kind `entry`. Same name and result as 0119.

create or replace function year_cut_holds(year_id uuid, new_start date, new_end date)
returns table (
  kind text,
  row_id uuid,
  student_id uuid,
  holder_id uuid,
  valid_from date,
  valid_until date
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with year as (
    select y.start_date, y.end_date from academic_years y where y.id = year_id
  ), rows as (
    select 'class'::text as kind, m.id, m.student_id, m.class_id as holder_id,
      m.valid_from, m.valid_until, m.own_until
    from class_memberships m
    join classes c on c.id = m.class_id
    where c.academic_year_id = year_id
      and (m.valid_from < m.valid_until
        or (m.ended_by in ('leaving', 'transfer') and m.valid_from < m.own_until))
    union all
    select 'group'::text, m.id, m.student_id, m.group_id, m.valid_from, m.valid_until, m.own_until
    from group_memberships m
    join groups g on g.id = m.group_id
    where g.academic_year_id = year_id
      and (m.valid_from < m.valid_until
        or (m.ended_by in ('leaving', 'transfer') and m.valid_from < m.own_until))
  ), stays as (
    select r.kind, r.id, r.student_id, r.holder_id, r.valid_from,
      case when r.valid_from < r.valid_until then r.valid_until else r.own_until end as valid_until
    from rows r, year y
    where r.valid_from < new_start
      or (
        new_end < y.end_date
        and (
          r.valid_from >= new_end + 1
          or (r.valid_until < r.own_until and r.valid_until >= new_end + 1)
          or (r.own_until > new_end + 1 and r.own_until <> y.end_date + 1)
        )
      )
  ), dated as (
    select c.student_id, l.id, coalesce(l.class_id, l.group_id) as holder_id, l.lesson_date
    from journal_cells c
    join lessons l on l.id = c.lesson_id
    join lesson_blocks b on b.id = l.block_id
    where b.academic_year_id = year_id
      and (c.mark is not null or c.score is not null)
      and (l.lesson_date < new_start or l.lesson_date > new_end)
    union all
    select m.student_id, l.id, coalesce(l.class_id, l.group_id), l.lesson_date
    from journal_comments m
    join lessons l on l.id = m.lesson_id
    join lesson_blocks b on b.id = l.block_id
    where b.academic_year_id = year_id
      and m.body is not null
      and (l.lesson_date < new_start or l.lesson_date > new_end)
    union all
    select e.student_id, x.id, coalesce(j.class_id, j.group_id), d.in_force
    from journal_rating_entries e
    join journal_rating_exams x on x.id = e.rating_exam_id
    join journals j on j.id = x.journal_id
    cross join lateral (select journal_rating_date(x.journal_id, x.quarter_id) as in_force) d
    where j.academic_year_id = year_id
      and e.kind is not null
      and d.in_force is not null
      and (d.in_force < new_start or d.in_force > new_end)
  ), entries as (
    select distinct on (d.student_id, d.lesson_date)
      'entry'::text as kind, d.id, d.student_id, d.holder_id,
      d.lesson_date as valid_from, d.lesson_date + 1 as valid_until
    from dated d
    order by d.student_id, d.lesson_date, d.id
  )
  select * from (
    select * from stays
    union all
    select * from entries
  ) s
  order by s.kind, s.valid_from, s.id
$$;
