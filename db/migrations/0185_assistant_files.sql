-- 0185 Files, photos and voice in the assistant's conversations; the exports
-- it makes (task 11.22, pull request #390; the owner's spec change of
-- 25 November 2026).
--
-- 02, Assistant, Files, photos and voice: "The person can attach an Excel
-- file, a PDF or a photo ... On a phone the person can speak the question".
-- What it can do: exports "it prepares as a file the person downloads". 13,
-- Hosting and data: the files are on Cloudflare R2; the database keeps only
-- which file is which (plan decision 8).
--
-- Two new tables, no existing row changes (stop-list item 3). Both are
-- insert-only for the application (no update, no delete grant) and carry
-- their branch with the branch filter (CLAUDE.md, Branch on every row).
-- Whether an upload may still be sent is read from created_at and the clock
-- on each request (plan decision 9; CLAUDE.md, State from stored moments).

create table assistant_files (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  account_id uuid not null references accounts (id),
  kind text not null constraint assistant_files_kind_check check (
    kind in ('attachment', 'voice', 'export')
  ),
  name text not null constraint assistant_files_name_check check (
    length(name) between 1 and 200
  ),
  -- ASSISTANT_UPLOAD_TYPES of packages/shared, and an export's own type (an
  -- Excel workbook or a PDF).
  media_type text not null constraint assistant_files_media_type_check check (
    media_type in (
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/webm',
      'audio/ogg',
      'audio/mp4'
    )
  ),
  size_bytes integer not null constraint assistant_files_size_check check (
    size_bytes between 1 and 10000000
  ),
  -- assistant/<id> in the photo store: the check below pins it to the id, so a key is never
  -- reused.
  store_key text not null,
  constraint assistant_files_store_key_check check (store_key = 'assistant/' || id::text),
  -- From the injected clock (the transaction's moment), never now().
  created_at timestamptz not null,
  -- Review of the plan, correction 4: a link names a file of its own branch.
  constraint assistant_files_id_branch_key unique (id, branch_id)
);

alter table assistant_files enable row level security;
create policy branch_filter on assistant_files for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_files to sodiq_app;

-- Which message a file belongs to: the question it was sent with (an
-- attachment or a recording), or the answer that links it (an export). A file
-- belongs to one message; linking an upload to its question inserts a row and
-- changes none.
create table assistant_message_files (
  message_id uuid not null,
  file_id uuid not null,
  branch_id uuid not null references branches (id),
  constraint assistant_message_files_message_fkey foreign key (message_id, branch_id)
    references assistant_messages (id, branch_id),
  constraint assistant_message_files_file_fkey foreign key (file_id, branch_id)
    references assistant_files (id, branch_id),
  -- The order the files were attached in.
  position smallint not null constraint assistant_message_files_position_check check (
    position between 1 and 5
  ),
  primary key (message_id, file_id),
  -- A file belongs to one message (with its branch, as every unique of a branch table).
  constraint assistant_message_files_file_key unique (file_id, branch_id)
);

alter table assistant_message_files enable row level security;
create policy branch_filter on assistant_message_files for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on assistant_message_files to sodiq_app;
