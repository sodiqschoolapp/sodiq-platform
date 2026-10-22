-- 0113 Attendance: the reasons of a student's absence (task 6.3, pull
-- request #211).
--
-- docs/spec/edge-cases/journal.md, Locks, unlocks and corrections, "A Tutor
-- records why a student was absent": "The reason is its own record per
-- student and date: a category (illness, family, permitted by the school,
-- unexcused, unknown), a text and an optional file. It never affects a
-- calculation. The class Tutor and the Academic Vice Principal can edit it
-- until the quarter closes. Teachers see the category only."
--
-- The plan approved on pull request #211 with corrections 1 to 5: decisions
-- 6 to 11. The file is 8.5's (decision 10); the lock at the quarter's close
-- is 9.2b's (decision 11). Attendance marks are the cells of 0108.

create table student_absence_reasons (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The key on the id only, as journal_cells: a reason stays in the branch of
  -- its date when the student moves to another branch (spec review of the
  -- plan, must-fix 6). No action: a student with a reason is not deleted.
  student_id uuid not null,
  absence_date date not null,
  -- Null: cleared (decision 8); the row and its audit entries stay.
  category text constraint student_absence_reasons_category_check check (
    category in ('illness', 'family', 'school_permitted', 'unexcused', 'unknown')
  ),
  -- ABSENCE_REASON_NOTE_MAX of packages/shared; empty when cleared.
  note text not null default '' constraint student_absence_reasons_note_check check (
    length(note) <= 500 and (category is not null or note = '')
  ),
  changed_by uuid not null references accounts (id),
  -- From the transaction's moment (the injected clock), written by the trigger.
  changed_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint student_absence_reasons_student_fkey foreign key (student_id)
    references students (id),
  constraint student_absence_reasons_key unique (branch_id, student_id, absence_date)
);

create index student_absence_reasons_student_idx on student_absence_reasons (student_id);
create index student_absence_reasons_date_idx on student_absence_reasons (branch_id, absence_date);

alter table student_absence_reasons enable row level security;
create policy branch_filter on student_absence_reasons for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The student changes only in a merge (correction 2), guarded below; the
-- branch and the date never change.
grant select on student_absence_reasons to sodiq_app;
grant insert (id, branch_id, student_id, absence_date, category, note, changed_by, changed_at)
  on student_absence_reasons to sodiq_app;
grant update (student_id, category, note, changed_by) on student_absence_reasons to sodiq_app;

-- The moment from the injected clock; the student changes only to the other
-- record of a merge written in this transaction, and alone (as
-- memberships_merge of 0054). For every user. Runs as the invoker.
create function student_absence_reasons_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
begin
  if tg_op = 'UPDATE' and new.student_id is distinct from old.student_id then
    if (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id')
      or not student_merge_here(old.student_id, new.student_id) then
      raise exception 'student_absence_reasons_merge'
        using errcode = 'check_violation', constraint = 'student_absence_reasons_merge';
    end if;
    return new;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'student_absence_reasons_moment'
      using errcode = 'check_violation', constraint = 'student_absence_reasons_moment';
  end if;
  new.changed_at := moment;
  return new;
end;
$$;

create trigger student_absence_reasons_write
  before insert or update on student_absence_reasons
  for each row execute function student_absence_reasons_write();
