-- 0154 Student imports from the system's Excel template (task 9.4g, pull request #278; the
-- owner's spec change of 3 November 2026; `04`, Student record: Excel import).
--
-- An upload is kept as one row: the rows of the file as read (what the confirm runs again,
-- plan decision 2, Look first) and the hash of the file's bytes. A confirm sets the confirm
-- pair. One file is confirmed at most once in a branch, guarded here (`edge/students-classes-
-- groups`: "Uploading the same file again creates nothing").
--
-- Nothing here changes or removes an existing row.

create table student_imports (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The SHA-256 of the file's bytes, in lower-case hex.
  file_sha256 text not null constraint student_imports_file_sha256_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The rows as read and normalised (`studentImportRowSchema` of `packages/shared`).
  rows jsonb not null,
  row_count integer not null,
  uploaded_by uuid not null references accounts (id),
  uploaded_at timestamptz not null,
  confirmed_by uuid references accounts (id),
  confirmed_at timestamptz,
  constraint student_imports_confirm_pair_check
    check ((confirmed_by is null) = (confirmed_at is null))
);

create index student_imports_branch_idx on student_imports (branch_id);

-- One confirmed import of one file per branch.
create unique index student_imports_file_once_idx on student_imports (branch_id, file_sha256)
  where confirmed_at is not null;

alter table student_imports enable row level security;
create policy branch_filter on student_imports for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Archive, do not delete: an import is never removed; only its confirm pair is written later.
grant select, insert on student_imports to sodiq_app;
grant update (confirmed_by, confirmed_at) on student_imports to sodiq_app;
