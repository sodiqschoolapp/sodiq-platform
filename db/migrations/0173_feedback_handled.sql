-- 0173 The handled mark of a feedback report (pull request #361; owner, 19 November 2026).
--
-- The Super Admin reads the reports on the Feedback reports page and marks each
-- one handled, or new again. Two nullable columns without a default: no existing
-- row changes and the table is not rewritten. `0011` said a report is never
-- changed by the application: that still holds for every field of the report
-- itself. Only the two columns of the mark are granted, by a column grant, and
-- there is still no delete (decision 2 of the plan, Look first).

alter table feedback_reports
  add column handled_at timestamptz,
  add column handled_by uuid references accounts (id),
  -- The moment and the account of the mark go together: both set, or both clear.
  add constraint feedback_reports_handled_check check (
    (handled_at is null) = (handled_by is null)
  );

-- The list of the page: newest first.
create index feedback_reports_created_idx on feedback_reports (created_at desc, id desc);

grant update (handled_at, handled_by) on feedback_reports to sodiq_app;
