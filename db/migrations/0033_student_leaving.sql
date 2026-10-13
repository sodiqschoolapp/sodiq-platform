-- 0033 Leaving, return and delete of a student (task 2.4b-1, pull request #68).
--
-- docs/spec/04-people.md, Movements: "Leaving the school. Asks for
-- confirmation, date and reason. The student becomes inactive (archived) ...
-- Coming back. A returning student is restored from the Inactive list with the
-- same UID and full history". UID sets: "A UID stays with the student for good
-- ... and it is never given to another student."
-- docs/spec/edge-cases/students-classes-groups.md: "A transfer or a leaving is
-- set for a future date. It is \"scheduled\" ... It can be changed or cancelled
-- until the date." "The leave date is the last day as a student." "Contracts
-- are kept as a dated list, and a return adds a new one. A leaving entered by
-- mistake has its own \"undo leaving\" action with a reason." "A student is
-- created twice by mistake. The Academic Vice Principal may delete a student
-- only if there is no attendance, number, exemption, result, scholarship,
-- stipend entry or comment." "A student is graduated by mistake. The Super
-- Admin restores the student to active with a class and a reason."
-- docs/spec/edge-cases/developer-rules.md, Identifiers: "a unique constraint
-- across the school guarantees it is never used twice".
--
-- Decisions of pull request #68 (plan approved with corrections 1 to 3):
-- the cause and the reason of each status row (decision 8); the delete
-- guarded by `students_delete_guard` (decisions 4 and 14), the children going
-- with the student; the UIDs of a deleted student kept reserved with
-- `released_at` (decision 3, Look first); a status row dated in a closed
-- academic year refused (correction 1).

-- What wrote each status row, and the reason a person gave. The existing rows
-- are first rows (`start`); the default goes once they are filled, so a later
-- insert names its cause.
alter table student_statuses
  add column cause text not null default 'start' constraint student_statuses_cause_check check (
    cause in ('start', 'leaving', 'return', 'undo', 'cancel', 'graduation', 'restore')
  ),
  add column reason text constraint student_statuses_reason_check check (
    reason = btrim(reason) and length(reason) between 1 and 500
  );

alter table student_statuses alter column cause drop default;

-- The spec asks a reason for a leaving, an undo and the graduated restore.
alter table student_statuses add constraint student_statuses_reason_needed_check check (
  cause not in ('leaving', 'undo', 'restore') or reason is not null
);

-- Not updatable: the shrink trigger of 0032 refuses a change of any column
-- but `valid_until` (and the branch, with the student).
grant insert (cause, reason) on student_statuses to sodiq_app;

-- A status row dated in a closed academic year is refused (edge: "A date in a
-- closed quarter is refused"; the quarter comes with task 9.2b). The date a
-- row writes: its start on insert, its new end when the end changes. The year
-- of the row's branch that holds the date is locked FOR SHARE whatever its
-- status, then its status read, so a close of the year at the same moment
-- waits for this write (the shape of 0022). An update of the branch alone,
-- the move of task 3.3, is not checked (correction 1). Not SECURITY DEFINER.
create function student_statuses_closed_year_guard() returns trigger
language plpgsql
as $$
declare
  day date;
  year_status text;
begin
  if tg_op = 'INSERT' then
    day := new.valid_from;
  elsif new.valid_until is distinct from old.valid_until then
    day := new.valid_until;
  else
    return new;
  end if;
  if day is null then
    return new;
  end if;
  select academic_years.status into year_status
    from academic_years
    where academic_years.branch_id = new.branch_id
      and academic_years.start_date <= day
      and academic_years.end_date >= day
    for share;
  if year_status = 'closed' then
    raise exception 'student_statuses_closed_year'
      using errcode = 'check_violation', constraint = 'student_statuses_closed_year';
  end if;
  return new;
end
$$;

create trigger student_statuses_closed_year_guard
  before insert or update on student_statuses
  for each row execute function student_statuses_closed_year_guard();

-- The children go with the student, and only through the guarded delete of
-- the student: the application has no delete right on them.
alter table student_contracts drop constraint student_contracts_student_fkey;
alter table student_contracts add constraint student_contracts_student_fkey
  foreign key (student_id, branch_id) references students (id, branch_id)
  on update cascade on delete cascade;

alter table student_statuses drop constraint student_statuses_student_fkey;
alter table student_statuses add constraint student_statuses_student_fkey
  foreign key (student_id, branch_id) references students (id, branch_id)
  on update cascade on delete cascade;

alter table student_accounts drop constraint student_accounts_student_fkey;
alter table student_accounts add constraint student_accounts_student_fkey
  foreign key (student_id, branch_id) references students (id, branch_id)
  on update cascade on delete cascade;

-- The UIDs of a deleted student stay reserved for good (decision 3): the row
-- is kept with no student and the moment it was released. The UID key is
-- untouched, so a released UID is never given again.
alter table student_uids add column released_at timestamptz;
alter table student_uids alter column student_id drop not null;
alter table student_uids add constraint student_uids_released_check check (
  (student_id is null) = (released_at is not null)
);
alter table student_uids drop constraint student_uids_student_fkey;
alter table student_uids add constraint student_uids_student_fkey
  foreign key (student_id, branch_id) references students (id, branch_id)
  on update cascade on delete set null (student_id);

-- The release is written by the `set null` action of the key, which runs as
-- the owner of the table: the moment comes from `app.now`, the transaction
-- moment of the injected clock, and without it nothing is released. Any other
-- change of `student_id` or `released_at` is refused; the application has no
-- update right on the table at all.
create function student_uids_release() returns trigger
language plpgsql
as $$
declare
  moment timestamptz;
begin
  if old.student_id is not null and new.student_id is null then
    moment := nullif(current_setting('app.now', true), '')::timestamptz;
    if moment is null then
      raise exception 'student_uids_release_moment'
        using errcode = 'check_violation', constraint = 'student_uids_release_moment';
    end if;
    new.released_at := moment;
    return new;
  end if;
  if new.student_id is distinct from old.student_id
    or new.released_at is distinct from old.released_at then
    raise exception 'student_uids_release_only'
      using errcode = 'check_violation', constraint = 'student_uids_release_only';
  end if;
  return new;
end
$$;

create trigger student_uids_release
  before update on student_uids
  for each row execute function student_uids_release();

-- The delete of a student created twice (decisions 4 and 14). Refused for a
-- student with data: a scholarship (the data that exists today), a live
-- status row that is not active (a leaving scheduled or in force, a
-- graduation: a student who left or graduated was not "created twice"), or
-- more than one contract (a return). A leaving cancelled or undone leaves no
-- live inactive row and blocks nothing. The tables of student data that later
-- tasks add reference `students` with no action, so their key refuses the
-- delete whatever the branch filter shows. Not SECURITY DEFINER.
create function students_delete_guard() returns trigger
language plpgsql
as $$
begin
  if old.scholarship_type <> 'none'
    or exists (
      select 1 from student_statuses ss
      where ss.student_id = old.id
        and ss.status <> 'active'
        and ss.valid_from < coalesce(ss.valid_until, 'infinity'::date)
    )
    or (select count(*) from student_contracts sc where sc.student_id = old.id) > 1 then
    raise exception 'students_delete_guard'
      using errcode = 'check_violation', constraint = 'students_delete_guard';
  end if;
  return old;
end
$$;

create trigger students_delete_guard
  before delete on students
  for each row execute function students_delete_guard();

grant delete on students to sodiq_app;
