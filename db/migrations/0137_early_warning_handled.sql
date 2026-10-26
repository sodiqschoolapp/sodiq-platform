-- Task 9.4a, the early-warning list (pull request #235).
--
-- `08`, Early-warning list, Handled: "A Tutor or teacher can add a staff-only note ('spoke to the
-- parents') and mark the entry as handled. It returns only if the figures get worse."
--
-- One row each time an entry (a student, a subject, a quarter and a reason) is marked handled;
-- append-only, the newest row of the four is in force (plan decision 11). `figure` is the figure
-- the entry had when it was handled, as the list compares it: the rounded result or attendance,
-- the drop in points, or the length of the run of absences (spec review of the plan, should-fix
-- 2: a whole number). The entry is listed again when its figure gets worse, or, for a run of
-- absences, when a new run began after `handled_at` (review of the plan, correction 2).
create table early_warning_handled (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  quarter_id uuid not null,
  -- The student's own key only: a move to another branch keeps the row in the branch of its
  -- quarter, as `quarter_result_decisions` (0132); the route checks the student's branch.
  student_id uuid not null references students (id),
  -- Subjects are school-wide (0020).
  subject_id uuid not null references subjects (id),
  reason text not null constraint early_warning_handled_reason_check check (
    reason in ('low_result', 'result_drop', 'low_attendance', 'absences_in_row')
  ),
  figure smallint not null constraint early_warning_handled_figure_check check (
    figure between 0 and 1000
  ),
  -- EARLY_WARNING_NOTE_MAX_LENGTH; optional, empty when none.
  note text not null default '' constraint early_warning_handled_note_check check (
    length(note) <= 500 and note = btrim(note)
  ),
  handled_by uuid not null references accounts (id),
  assignment_id uuid not null,
  -- The transaction's moment (`app.now`), written again by the trigger below.
  handled_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint early_warning_handled_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id)
);

create index early_warning_handled_quarter_idx
  on early_warning_handled (quarter_id, student_id, subject_id, reason, handled_at);

alter table early_warning_handled enable row level security;
create policy branch_filter on early_warning_handled for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The merge of two student records (task 3.3d) carries the rows to the kept record as it carries
-- the journal's rows (0128): a change of `student_id` alone, from the merged record to the kept
-- one of a merge of this transaction. Every other update is refused: the rows are append-only.
create trigger early_warning_handled_merge_carry
  before update on early_warning_handled
  for each row execute function journal_merge_carry();

grant select on early_warning_handled to sodiq_app;
grant update (student_id) on early_warning_handled to sodiq_app;
grant insert (
  id, branch_id, quarter_id, student_id, subject_id, reason, figure, note, handled_by,
  assignment_id, handled_at
) on early_warning_handled to sodiq_app;

create function early_warning_handled_moment() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- `.claude/rules/database.md`: a moment a rule reads comes from the injected clock.
  -- The migrator's fixtures have no moment and keep the one they write.
  new.handled_at := coalesce(class_tutors_moment(), new.handled_at);
  return new;
end;
$$;

create trigger early_warning_handled_moment
  before insert on early_warning_handled
  for each row execute function early_warning_handled_moment();
