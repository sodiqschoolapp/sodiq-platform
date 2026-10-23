-- 0121 The application version on a feedback report (task 8.3a, review
-- correction 5; docs/progress.md, task 0.8b-3: "the application version on
-- the report (8.3a)").
--
-- The version the page sent in `X-App-Version` (packages/shared,
-- `APP_VERSION`); null when the request carried none. A report is never
-- changed, so the column takes no update right.

alter table feedback_reports
  add column app_version integer constraint feedback_reports_app_version_check check (
    app_version >= 0
  );
