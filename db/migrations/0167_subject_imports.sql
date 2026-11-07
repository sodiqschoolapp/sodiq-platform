-- 0167 Subject imports from the system's Excel template (the owner's change of 7 November
-- 2026, pull request #316; `05`, "Excel import of subjects").
--
-- The shape of `staff_imports` (0155): an upload is kept as one row, with the rows of the file
-- as read (what the confirm runs again) and the hash of the file's bytes. A confirm sets the
-- confirm pair. One file is confirmed at most once in a branch, guarded here (`05`: "the same
-- file not twice"). The subjects themselves are school-wide; the import belongs to the branch
-- whose daily and quarterly distributions it writes.
--
-- Nothing here changes or removes an existing row.

create table subject_imports (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The SHA-256 of the file's bytes, in lower-case hex.
  file_sha256 text not null constraint subject_imports_file_sha256_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The rows as read (`subjectImportRowSchema` of `packages/shared`).
  rows jsonb not null,
  row_count integer not null,
  uploaded_by uuid not null references accounts (id),
  uploaded_at timestamptz not null,
  confirmed_by uuid references accounts (id),
  confirmed_at timestamptz,
  constraint subject_imports_confirm_pair_check
    check ((confirmed_by is null) = (confirmed_at is null))
);

create index subject_imports_branch_idx on subject_imports (branch_id);

-- One confirmed import of one file per branch.
create unique index subject_imports_file_once_idx on subject_imports (branch_id, file_sha256)
  where confirmed_at is not null;

alter table subject_imports enable row level security;
create policy branch_filter on subject_imports for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Archive, do not delete: an import is never removed; only its confirm pair is written later.
grant select, insert on subject_imports to sodiq_app;
grant update (confirmed_by, confirmed_at) on subject_imports to sodiq_app;
