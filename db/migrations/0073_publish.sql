-- 0073 Publish: the status of a version, the mark "out of date" and
-- "deliberately short" (task 5.5a-1, pull request #139).
--
-- docs/spec/06-timetable.md, Model: "Version ... States: draft, published,
-- archived." How surprises are prevented: "Draft, then publish. The live
-- timetable is never edited in place." "Out-of-date draft. If the live
-- timetable changed after a draft was started, the draft must be brought up
-- to date before publishing". Rules, last row: "Lessons placed per week differ
-- from the teaching load. This is a warning while editing a draft and blocks
-- publishing, unless the load row is marked 'deliberately short' with a
-- reason." docs/spec/edge-cases/timetable.md, Versions and drafts: "Any
-- publish ... marks the other drafts out of date."
--
-- The plan approved on pull request #139: decisions 4, 8 and 9. No
-- constraint, index or trigger is removed or weakened.

-- Decision 4: the moment a publish marked the draft out of date; null while
-- it is up to date. Bringing a draft up to date (5.5a-3) clears it.
alter table timetable_versions add column out_of_date_at timestamptz;

-- Decision 14: a copy of a draft marked out of date carries the mark.
grant insert (out_of_date_at), update (status, out_of_date_at) on timetable_versions to sodiq_app;

-- Decision 9: a draft is published once and stays published; withdraw
-- (published to archived, before the start date) comes with 5.5c and widens
-- this function in a migration of its own. The year row is locked FOR SHARE
-- whatever its state and read afterwards, in a statement of its own
-- (.claude/rules/database.md), as `timetable_versions_draft` does.
create function timetable_versions_status() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  year_state text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not (old.status = 'draft' and new.status = 'published') then
    raise exception 'timetable_versions_status'
      using errcode = 'check_violation', constraint = 'timetable_versions_status';
  end if;
  perform 1 from academic_years y where y.id = new.academic_year_id for share;
  select y.status into year_state from academic_years y where y.id = new.academic_year_id;
  if year_state = 'closed' then
    raise exception 'version_year_closed'
      using errcode = 'check_violation', constraint = 'version_year_closed';
  end if;
  return new;
end;
$$;

create trigger timetable_versions_status
  before update of status on timetable_versions
  for each row execute function timetable_versions_status();

-- As starts_on, left_rows (0055), templates_confirmed (0068) and the weights
-- (0069): the mark and the edit lock (0072) change only while the version is
-- a draft of a year that is not closed (spec review of the plan, should-fix 1).
create trigger timetable_versions_mark_draft
  before update of out_of_date_at, edit_holder_id, edit_seen_at on timetable_versions
  for each row execute function timetable_versions_draft();

-- Decision 8: "deliberately short" is its reason; no reason, not short. The
-- row trigger of 0055 (`teaching_load_rows_check`, every column) already
-- refuses a write of a version that is not a draft.
alter table teaching_load_rows
  add column short_reason text
    constraint teaching_load_rows_short_reason_check check (
      short_reason is null
      or (btrim(short_reason) = short_reason and char_length(short_reason) between 1 and 500)
    );

grant insert (short_reason), update (short_reason) on teaching_load_rows to sodiq_app;
