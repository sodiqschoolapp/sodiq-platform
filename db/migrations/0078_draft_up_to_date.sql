-- 0078 Bringing a draft up to date after a publish (task 5.5a-3b-2, pull
-- request #148).
--
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "Each draft
-- remembers the version it started from. ... Bringing one up to date lists
-- what changed on both sides, and the Academic Vice Principal picks." The
-- build plan: "the draft then names the published version as the one it
-- started from".
--
-- The plan approved on pull request #148: decision 1 (Look first, a trigger
-- widened by a requirement) with review correction 1. A draft's source may
-- change; the source of any other version, and the branch, year, number and
-- left rows of every version, stay as 0055 fixed them. The new source is of
-- the same branch and year by `timetable_versions_from_fkey`; that it is a
-- published version is decided by the route under the publish lock.

grant update (from_version_id) on timetable_versions to sodiq_app;

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
    or (new.left_rows is distinct from old.left_rows and new.left_rows <> '[]'::jsonb) then
    raise exception 'timetable_versions_fixed'
      using errcode = 'check_violation', constraint = 'timetable_versions_fixed';
  end if;
  return new;
end;
$$;
