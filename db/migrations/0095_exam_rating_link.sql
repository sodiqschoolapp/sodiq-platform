-- 0095 The rating-exam link of an exam (task 5.6c-3b, pull request #184,
-- decisions 1, 2, 4 to 6 and 9).
--
-- docs/spec/edge-cases/timetable.md, Exams, "The exam is the quarter's rating
-- exam": "An exam can be linked to the rating exam of the journals of its
-- subject whose students all belong to its classes: class journals, and group
-- journals whose students all come from sitting classes. A group journal with
-- students outside the exam is listed and not linked; its teacher sets the
-- date by hand. The linked journals' rating exam date is the exam's date."
--
-- `exams.rating_exam` is the tick of the Academic Vice Principal. Each save of
-- the exam writes its journals again, linked or not linked, from the
-- memberships on its date (decision 1); none while the tick is off. A
-- cancelled exam keeps its rows as history (decision 6): every reader reads
-- `rating_exam and cancel_cause is null`. "One linked exam per journal and
-- quarter" (decision 2) is checked by the exam save and the quarter save,
-- which both hold the year row (`for share`, `for update`); no trigger.

alter table exams add column rating_exam boolean not null default false;

-- A rating exam has a subject; whether the subject has the rating exam is
-- read by the save (`subjects.rating_exam`, decision 5).
alter table exams add constraint exams_rating_subject_check
  check (not rating_exam or subject_id is not null);

grant insert (rating_exam) on exams to sodiq_app;
grant update (rating_exam) on exams to sodiq_app;

create table exam_rating_journals (
  branch_id uuid not null references branches (id),
  exam_id uuid not null,
  journal_id uuid not null,
  -- Linked: every student of the journal on the exam's date sits it.
  linked boolean not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint exam_rating_journals_pkey primary key (exam_id, journal_id, branch_id),
  constraint exam_rating_journals_exam_fkey foreign key (exam_id, branch_id)
    references exams (id, branch_id),
  constraint exam_rating_journals_journal_fkey foreign key (journal_id, branch_id)
    references journals (id, branch_id)
);

create index exam_rating_journals_journal_idx on exam_rating_journals (journal_id);

alter table exam_rating_journals enable row level security;
create policy branch_filter on exam_rating_journals for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Rewritten by each save of the exam; never updated.
grant select, delete on exam_rating_journals to sodiq_app;
grant insert (branch_id, exam_id, journal_id, linked) on exam_rating_journals to sodiq_app;

-- A journal of the exam's year and subject, whatever the application does.
-- Runs as the invoker.
create function exam_rating_journals_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  exam_subject uuid;
  exam_year uuid;
  journal_subject uuid;
  journal_year uuid;
begin
  select e.subject_id, e.academic_year_id into exam_subject, exam_year
    from exams e where e.id = new.exam_id and e.branch_id = new.branch_id;
  select j.subject_id, j.academic_year_id into journal_subject, journal_year
    from journals j where j.id = new.journal_id and j.branch_id = new.branch_id;
  if exam_subject is distinct from journal_subject or exam_year is distinct from journal_year then
    raise exception 'exam_rating_journal'
      using errcode = 'check_violation', constraint = 'exam_rating_journal';
  end if;
  return new;
end;
$$;

create trigger exam_rating_journals_check
  before insert on exam_rating_journals
  for each row execute function exam_rating_journals_check();

-- At the end of the transaction: a change of an exam's subject leaves none of
-- its rows on a journal of another subject (`.claude/rules/database.md`: a
-- rule between a child row and a column of its parent is checked on the
-- parent's update too). The exam save writes the rows again after the
-- subject. Runs as the invoker.
create function exams_rating_journals() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from exam_rating_journals r
    join exams e on e.id = r.exam_id and e.branch_id = r.branch_id
    join journals j on j.id = r.journal_id and j.branch_id = r.branch_id
    where r.exam_id = new.id
      and (e.subject_id is distinct from j.subject_id
        or e.academic_year_id is distinct from j.academic_year_id)
  ) then
    raise exception 'exam_rating_journal'
      using errcode = 'check_violation', constraint = 'exam_rating_journal';
  end if;
  return null;
end;
$$;

create constraint trigger exams_rating_journals
  after update of subject_id on exams
  deferrable initially deferred
  for each row execute function exams_rating_journals();
