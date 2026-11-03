-- 0155 Staff imports from the system's Excel template (task 9.4h, pull request #279; the
-- owner's spec change of 3 November 2026; `04`, Teacher and staff record: the import).
--
-- The shape of `student_imports` (0154): an upload is kept as one row, with the rows of the
-- file as read (what the confirm runs again, plan decision 2, Look first) and the hash of the
-- file's bytes. A confirm sets the confirm pair. One file is confirmed at most once in a
-- branch, guarded here (`edge/students-classes-groups`: "Uploading the same file again creates
-- nothing", which the spec change applies to the staff import). No first password is kept here
-- or anywhere (`edge/people-roles-accounts`: "printed once on per-person slips and not stored").
--
-- Nothing here changes or removes an existing row.

create table staff_imports (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  -- The SHA-256 of the file's bytes, in lower-case hex.
  file_sha256 text not null constraint staff_imports_file_sha256_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The rows as read (`staffImportRowSchema` of `packages/shared`).
  rows jsonb not null,
  row_count integer not null,
  uploaded_by uuid not null references accounts (id),
  uploaded_at timestamptz not null,
  confirmed_by uuid references accounts (id),
  confirmed_at timestamptz,
  constraint staff_imports_confirm_pair_check
    check ((confirmed_by is null) = (confirmed_at is null))
);

create index staff_imports_branch_idx on staff_imports (branch_id);

-- One confirmed import of one file per branch.
create unique index staff_imports_file_once_idx on staff_imports (branch_id, file_sha256)
  where confirmed_at is not null;

alter table staff_imports enable row level security;
create policy branch_filter on staff_imports for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Archive, do not delete: an import is never removed; only its confirm pair is written later.
grant select, insert on staff_imports to sodiq_app;
grant update (confirmed_by, confirmed_at) on staff_imports to sodiq_app;
