-- 0028 Head Teacher appointments and subject scope (task 2.3b-1, pull request #63).
--
-- docs/spec/02-roles-and-access.md, Head Teachers and Senior Head Teachers:
-- "A Head Teacher oversees a list of subjects in one branch"; "A subject in a
-- branch has at most one Head Teacher, so every request has one clear
-- approver"; a Senior Head Teacher is "Appointed by the Super Admin with a
-- list of subjects"; "Appointments carry dates". Edge cases, Who can act:
-- "Rights are assignments: person, role, branch, and where needed subjects
-- ... with dates. A Senior Head Teacher's assignment has subjects and no
-- branch."
--
-- An appointment is one assignment with a list of subjects (decision 3 of
-- #63, Look first). The list is fixed: a change of subjects ends the
-- appointment and begins a new one at the same moment (decision 6). The
-- subject rows carry the role, branch and dates of their assignment, so that
-- PostgreSQL holds "one per subject per branch" with an exclusion constraint.

-- "Inserted by this transaction" for the subject rows (correction 1 of the
-- review of #63). Not `xmin`: `Assignments.give` inserts under a savepoint,
-- whose rows carry the id of the subtransaction. An update does not change
-- this column. The default is set after the column is added, so the rows
-- that exist stay empty, and empty never matches.
alter table assignments add column written_xact xid8;
alter table assignments alter column written_xact set default pg_current_xact_id();

create table assignment_subjects (
  assignment_id uuid not null references assignments (id),
  subject_id uuid not null references subjects (id),
  -- Copied from the assignment by assignment_subjects_fill; the role, branch
  -- and start of an assignment never change (0009 grants).
  role text not null constraint assignment_subjects_role_check check (
    role in ('head_teacher', 'senior_head_teacher')
  ),
  branch_id uuid references branches (id),
  valid_from timestamptz not null,
  -- The end of the assignment, written by assignments_subjects_end on every
  -- change of it.
  valid_until timestamptz,
  primary key (assignment_id, subject_id),
  constraint assignment_subjects_branch_check check (
    (branch_id is null) = (role = 'senior_head_teacher')
  ),
  -- `02`, One per subject per branch. Half-open: a subject passes at one
  -- moment from one Head Teacher to the next.
  constraint assignment_subjects_one_head_teacher exclude using gist (
    subject_id with =,
    branch_id with =,
    tstzrange(valid_from, valid_until) with &&
  ) where (role = 'head_teacher'),
  -- One Senior Head Teacher of a subject in the school (decision 4 of #63,
  -- Look first): `02` speaks of "the Senior Head Teacher of the subject".
  constraint assignment_subjects_one_senior exclude using gist (
    subject_id with =,
    tstzrange(valid_from, valid_until) with &&
  ) where (role = 'senior_head_teacher')
);

-- "Who holds this subject", for the list of a branch and later the approver
-- of a request.
create index assignment_subjects_subject_idx on assignment_subjects (subject_id);

-- The subject rows of an assignment: written with the assignment, never
-- changed by the application. Runs as the invoker: the reads are the
-- application's own.
create function assignment_subjects_fill() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  given record;
  archived timestamptz;
begin
  select a.role, a.branch_id, a.valid_from, a.valid_until, a.written_xact
    into given
    from assignments a
    where a.id = new.assignment_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;
  if given.role not in ('head_teacher', 'senior_head_teacher') then
    raise exception 'assignment_subjects_role'
      using errcode = 'check_violation', constraint = 'assignment_subjects_role';
  end if;
  if given.written_xact is distinct from pg_current_xact_id() then
    raise exception 'assignment_subjects_fixed'
      using errcode = 'check_violation', constraint = 'assignment_subjects_fixed';
  end if;
  -- Under a share lock: an archive at the same moment waits (decision 12).
  select s.archived_at into archived from subjects s where s.id = new.subject_id for share;
  if found and archived is not null then
    raise exception 'assignment_subjects_archived'
      using errcode = 'check_violation', constraint = 'assignment_subjects_archived';
  end if;
  new.role := given.role;
  new.branch_id := given.branch_id;
  new.valid_from := given.valid_from;
  new.valid_until := given.valid_until;
  return new;
end;
$$;

create trigger assignment_subjects_fill
  before insert on assignment_subjects
  for each row execute function assignment_subjects_fill();

-- Every end of an assignment (a role end, a `left` through `Staff.endRoles`,
-- its taking back) moves the end of its subject rows in the same statement's
-- transaction. When an end moves later and another holder of a subject was
-- appointed meanwhile, the exclusion constraints refuse it (decision 10).
-- SECURITY DEFINER: the application has no update right on the rows.
create function assignments_subjects_end() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.assignment_subjects
    set valid_until = new.valid_until
    where assignment_id = new.id;
  return null;
end;
$$;

create trigger assignments_subjects_end
  after update of valid_until on assignments
  for each row
  when (new.valid_until is distinct from old.valid_until)
  execute function assignments_subjects_end();

revoke execute on function assignments_subjects_end() from public;

-- A Head Teacher or Senior Head Teacher appointment has at least one subject,
-- checked at the commit of the transaction that gives it (correction 4: on
-- the insert only; the mirror keeps the rows).
create function assignments_subjects_needed() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from assignment_subjects s where s.assignment_id = new.id) then
    raise exception 'assignments_subjects_needed'
      using errcode = 'check_violation', constraint = 'assignments_subjects_needed';
  end if;
  return null;
end;
$$;

create constraint trigger assignments_subjects_needed
  after insert on assignments
  deferrable initially deferred
  for each row
  when (new.role in ('head_teacher', 'senior_head_teacher'))
  execute function assignments_subjects_needed();

grant select on assignment_subjects to sodiq_app;
grant insert (assignment_id, subject_id) on assignment_subjects to sodiq_app;
