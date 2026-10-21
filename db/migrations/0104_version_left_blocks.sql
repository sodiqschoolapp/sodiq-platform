-- 0104 The pattern blocks a copy of a version did not keep (task 5.8a, pull
-- request #194).
--
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "'Restore an
-- earlier version' always means copy it to a new draft; entries whose
-- teacher, room, subject or class is no longer active go to the 'to place'
-- list." docs/spec/edge-cases/academic-year.md: "Entries whose teacher, room,
-- subject or class is no longer active go to the 'to place' list with the
-- reason."
--
-- The plan approved on pull request #194: decision 7 and review correction 1.
-- Each block left by a copy is kept with its reason on the draft until it is
-- dismissed with the rows the copy left (0055 `left_rows`): written once by
-- the copy's insert, then only emptied, and only while the version is a
-- draft.

alter table timetable_versions
  add column left_blocks jsonb not null default '[]'
    constraint timetable_versions_left_blocks_check check (jsonb_typeof(left_blocks) = 'array');

grant insert (left_blocks), update (left_blocks) on timetable_versions to sodiq_app;

-- The 0078 body, with the left blocks guarded as the left rows are.
create or replace function timetable_versions_fixed() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.branch_id is distinct from old.branch_id
    or new.academic_year_id is distinct from old.academic_year_id
    or new.number is distinct from old.number
    or (new.from_version_id is distinct from old.from_version_id
      and (old.status <> 'draft' or new.status <> 'draft'))
    or (new.left_rows is distinct from old.left_rows and new.left_rows <> '[]'::jsonb)
    or (new.left_blocks is distinct from old.left_blocks and new.left_blocks <> '[]'::jsonb) then
    raise exception 'timetable_versions_fixed'
      using errcode = 'check_violation', constraint = 'timetable_versions_fixed';
  end if;
  return new;
end;
$$;

-- Only a draft's start date, left rows and left blocks change (0055).
drop trigger timetable_versions_draft_update on timetable_versions;
create trigger timetable_versions_draft_update
  before update of starts_on, left_rows, left_blocks on timetable_versions
  for each row execute function timetable_versions_draft();
