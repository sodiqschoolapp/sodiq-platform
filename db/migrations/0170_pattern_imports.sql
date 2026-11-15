-- 0170 Timetable imports from the system's Excel template (task 5.14, the owner's spec change of
-- 15 November 2026; `06`, Importing the load and the timetable).
--
-- The shape of `load_imports` (0169): an upload is kept as one row, with the rows of the file as
-- read (what the confirm runs again), the draft and language the template was made for, and the
-- hash of the file's bytes. A confirm sets the confirm pair. One file is confirmed at most once
-- into a draft, guarded here (`06`: "the same file is not imported twice"); two confirms into one
-- draft already run one after the other on the version row the confirm holds.
--
-- The blocks the import writes are ordinary `pattern_blocks` and `pattern_entries`: the clash
-- constraints of 0058 stay their last guard. Nothing here changes or removes an existing row.

create table pattern_imports (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  -- The SHA-256 of the file's bytes, in lower-case hex.
  file_sha256 text not null constraint pattern_imports_file_sha256_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The file as read (`patternImportFileSchema` of `packages/shared`).
  rows jsonb not null,
  row_count integer not null,
  uploaded_by uuid not null references accounts (id),
  uploaded_at timestamptz not null,
  confirmed_by uuid references accounts (id),
  confirmed_at timestamptz,
  -- An import belongs to the branch of its draft.
  constraint pattern_imports_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id),
  constraint pattern_imports_confirm_pair_check
    check ((confirmed_by is null) = (confirmed_at is null))
);

create index pattern_imports_branch_idx on pattern_imports (branch_id);
create index pattern_imports_version_idx on pattern_imports (version_id);

-- One confirmed import of one file per draft.
create unique index pattern_imports_file_once_idx on pattern_imports (version_id, file_sha256)
  where confirmed_at is not null;

alter table pattern_imports enable row level security;
create policy branch_filter on pattern_imports for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Archive, do not delete: an import is never removed; only its confirm pair is written later.
grant select, insert on pattern_imports to sodiq_app;
grant update (confirmed_by, confirmed_at) on pattern_imports to sodiq_app;
