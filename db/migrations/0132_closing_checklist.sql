-- Task 9.2a, the closing checklist (pull request #229).
--
-- `07`, Exemptions, Effect on totals: "When closing the quarter, the Academic
-- Vice Principal decides each flagged case: keep the number, or set
-- 'Exempt'. The quarter cannot be closed while a flagged result is
-- undecided." `edge/calculation`, "A student joined late ...": the flag
-- "becomes a decision only on the closing checklist. The outcome is 'keep',
-- 'Exempt' (when an exemption explains it) or 'Not assessed'. Decisions can
-- be made for a whole journal at once."
--
-- One row per student, subject and quarter (From 4.3: "one per student,
-- subject and quarter"), read by every reader of a quarter result as the
-- `decision` of `studentQuarterOutcome` (decision 1, Look first). A cleared
-- decision is an update to null: no row is deleted, the audit log keeps the
-- old and new decision (review decision 13). Whether a decision fits the
-- outcome is the module's (`staleDecision`), never this table's.

create table quarter_result_decisions (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  quarter_id uuid not null,
  subject_id uuid not null references subjects (id),
  -- With no action, as the tables of results (From 2.4b-1 on 6.1 and 9.1).
  student_id uuid not null references students (id),
  -- Null: cleared.
  decision text constraint quarter_result_decisions_decision_check check (
    decision in ('keep', 'exempt', 'not_assessed')
  ),
  decided_by uuid not null references accounts (id),
  -- The transaction's moment (the injected clock), by the trigger below.
  decided_at timestamptz not null,
  version integer not null default 1,
  constraint quarter_result_decisions_quarter_fkey foreign key (quarter_id, branch_id)
    references quarters (id, branch_id),
  constraint quarter_result_decisions_key unique (branch_id, quarter_id, subject_id, student_id)
);

create index quarter_result_decisions_student_idx on quarter_result_decisions (student_id);
create index quarter_result_decisions_subject_idx on quarter_result_decisions (subject_id);

alter table quarter_result_decisions enable row level security;
create policy branch_filter on quarter_result_decisions for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- The moment from the transaction, and no decision in a closed year (the
-- year is frozen with its quarters; the year row is locked FOR SHARE whatever
-- its status, so a close at the same moment waits). The closed-quarter refusal comes with 9.2b's
-- closed state (From line).
create function quarter_result_decisions_write() returns trigger
language plpgsql
as $$
declare
  moment timestamptz;
  year_status text;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  -- The year row is locked first whatever its status (0022), then read.
  select academic_years.status into year_status
    from quarters
    join academic_years on academic_years.id = quarters.academic_year_id
    where quarters.id = new.quarter_id
    for share of academic_years;
  if year_status = 'closed' then
    raise exception 'academic_years_closed'
      using errcode = 'check_violation', constraint = 'academic_years_closed';
  end if;
  new.decided_at := moment;
  return new;
end
$$;

create trigger quarter_result_decisions_write
  before insert on quarter_result_decisions
  for each row execute function quarter_result_decisions_write();
create trigger quarter_result_decisions_write_update
  before update on quarter_result_decisions
  for each row when (old.student_id is not distinct from new.student_id)
  execute function quarter_result_decisions_write();

-- The merge of two student records (task 3.3d, From 8.6 decision 8) carries the decisions to
-- the kept record as it carries the journal's rows (0128): a change of `student_id` alone, from
-- the merged record to the kept one of a merge of this transaction; two decisions of one
-- quarter and subject meet the unique key and refuse the merge.
create trigger quarter_result_decisions_merge_carry
  before update on quarter_result_decisions
  for each row when (old.student_id is distinct from new.student_id)
  execute function journal_merge_carry();

grant select on quarter_result_decisions to sodiq_app;
grant insert (branch_id, quarter_id, subject_id, student_id, decision, decided_by, decided_at)
  on quarter_result_decisions to sodiq_app;
grant update (decision, decided_by, version, student_id) on quarter_result_decisions to sodiq_app;
