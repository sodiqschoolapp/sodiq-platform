-- 0011 Feedback reports (task 0.8b-3).
--
-- docs/spec/14-quality-plan.md, Whole system, Monitoring: "A feedback button on
-- every page sends a report with the page and role attached."
-- docs/spec/edge-cases/people-roles-accounts.md, "Who can act": sending a
-- report is a change to the own account, which every signed-in account may
-- make, the Principal included (docs/spec-changes.md, 6 October 2026).
--
-- School-wide: a report belongs to an account, which has no branch (a Super
-- Admin works across branches), and is about the app, not about a branch. The
-- owner reads the table until a screen exists (decided by the owner).

create table feedback_reports (
  id uuid primary key default uuidv7(),
  account_id uuid not null references accounts (id),
  -- The roles of the session at the moment of the report, each once, in the
  -- order of ROLES (packages/shared); empty for an account without a role.
  -- The same names as assignments_role_check (0009); a test compares the two.
  roles text[] not null constraint feedback_reports_roles_check check (
    roles <@ array[
      'super_admin', 'principal', 'academic_vice_principal', 'spiritual_vice_principal',
      'head_tutor', 'tutor', 'senior_head_teacher', 'head_teacher', 'teacher', 'student',
      'parent', 'hr', 'nurse', 'psychologist', 'librarian'
    ]::text[]
  ),
  -- The path of the page, without the query (decided by the owner).
  page text not null constraint feedback_reports_page_check check (
    page ~ '^/[^?#]*$' and length(page) <= 500
  ),
  text text not null constraint feedback_reports_text_check check (
    length(btrim(text)) between 1 and 2000
  ),
  -- From the injected clock: the limit of reports per 24 hours counts by it.
  created_at timestamptz not null,
  request_id text
);

-- "The reports of this account in the last 24 hours", on every report.
create index feedback_reports_account_idx on feedback_reports (account_id, created_at);

-- A report is never changed or removed by the application.
grant select, insert on feedback_reports to sodiq_app;
