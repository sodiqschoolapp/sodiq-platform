-- 0079 Dated lessons written at publish (task 5.5b-1, pull request #152).
--
-- docs/spec/06-timetable.md, Model, Dated lesson: "On publishing, dated
-- lessons are created up to the end of the academic year". How surprises are
-- prevented: "Publishing or regenerating cannot change any lesson dated today
-- or earlier." docs/spec/edge-cases/timetable.md, Versions and drafts: "An
-- unchanged lesson keeps its identity, so its comments, plan item and one-day
-- changes stay. Only real differences are created or removed."
--
-- The plan approved on pull request #152: decisions 2 and 3. 0058 left the
-- delete of lessons and blocks, and the update of the columns that tie a
-- dated lesson to its version, to this task (5.1a, correction 6). A publish
-- removes the future lessons the new version does not have, and re-points an
-- unchanged lesson to the new version's pattern block, load row and entry.
-- The check that a lesson holds no data comes with the cells of 6.1, whose
-- key to `lessons` has no action (decision 9).

-- Decision 2: the deletes and the re-pointing columns. The claims of a
-- deleted lesson or block go with it (time_claims, on delete cascade, 0059).
grant delete on lesson_blocks to sodiq_app;
grant delete on lessons to sodiq_app;
grant update (version_id, pattern_block_id) on lesson_blocks to sodiq_app;
grant update (load_row_id, pattern_entry_id) on lessons to sodiq_app;

-- Whether a school date is after today in the branch's time zone, on the
-- moment of the transaction (`app.now`); false without a moment. Runs as the
-- invoker.
create function lesson_date_open(branch_ref uuid, on_day date) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  zone text;
  moment timestamptz;
begin
  moment := class_tutors_moment();
  select b.time_zone into zone from branches b where b.id = branch_ref;
  if moment is null or zone is null then
    return false;
  end if;
  return on_day > (moment at time zone zone)::date;
end;
$$;

-- A lesson or block dated today or earlier is never deleted (06, How
-- surprises are prevented: "The past is closed").
create function lessons_delete_past() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not lesson_date_open(old.branch_id, old.lesson_date) then
    raise exception 'lesson_delete_past'
      using errcode = 'check_violation', constraint = 'lesson_delete_past';
  end if;
  return old;
end;
$$;

create trigger lessons_delete_past
  before delete on lessons
  for each row execute function lessons_delete_past();

create trigger lesson_blocks_delete_past
  before delete on lesson_blocks
  for each row execute function lessons_delete_past();

-- Nor re-pointed to another version.
create function lessons_repoint_past() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not lesson_date_open(old.branch_id, old.lesson_date) then
    raise exception 'lesson_repoint_past'
      using errcode = 'check_violation', constraint = 'lesson_repoint_past';
  end if;
  return new;
end;
$$;

create trigger lesson_blocks_repoint_past
  before update of version_id, pattern_block_id on lesson_blocks
  for each row
  when (new.version_id is distinct from old.version_id
    or new.pattern_block_id is distinct from old.pattern_block_id)
  execute function lessons_repoint_past();

create trigger lessons_repoint_past
  before update of load_row_id, pattern_entry_id on lessons
  for each row
  when (new.load_row_id is distinct from old.load_row_id
    or new.pattern_entry_id is distinct from old.pattern_entry_id)
  execute function lessons_repoint_past();

-- What an insert checks (lessons_check of 0066, lesson_blocks_version of
-- 0059), checked again for a re-pointed block and its lessons at the commit,
-- after both are written: the block's version is of its year and not a
-- draft, and each lesson's load row is of that version with the lesson's
-- class or group, and its pattern entry of the block's pattern block and the
-- lesson's row. The version is locked FOR SHARE and read in a statement of
-- its own. Runs as the invoker.
create function lesson_repoint_check(block_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block lesson_blocks%rowtype;
  version_year uuid;
  version_state text;
begin
  select * into block from lesson_blocks b where b.id = block_ref;
  if not found then
    return;
  end if;
  perform 1 from timetable_versions v where v.id = block.version_id for share;
  select v.academic_year_id, v.status into version_year, version_state
    from timetable_versions v where v.id = block.version_id;
  if version_year is distinct from block.academic_year_id or version_state = 'draft' then
    raise exception 'lesson_repoint'
      using errcode = 'check_violation', constraint = 'lesson_repoint';
  end if;
  if exists (
    select 1
    from lessons l
    left join teaching_load_rows r on r.id = l.load_row_id
    left join pattern_entries e on e.id = l.pattern_entry_id
    where l.block_id = block_ref
      and (
        r.version_id is distinct from block.version_id
        or r.class_id is distinct from l.class_id
        or r.group_id is distinct from l.group_id
        or e.block_id is distinct from block.pattern_block_id
        or e.load_row_id is distinct from l.load_row_id
      )
  ) then
    raise exception 'lesson_repoint'
      using errcode = 'check_violation', constraint = 'lesson_repoint';
  end if;
end;
$$;

create function lesson_blocks_repoint() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform lesson_repoint_check(new.id);
  return null;
end;
$$;

create constraint trigger lesson_blocks_repoint
  after update of version_id, pattern_block_id on lesson_blocks
  deferrable initially deferred
  for each row execute function lesson_blocks_repoint();

create function lessons_repoint() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform lesson_repoint_check(new.block_id);
  return null;
end;
$$;

create constraint trigger lessons_repoint
  after update of load_row_id, pattern_entry_id on lessons
  deferrable initially deferred
  for each row execute function lessons_repoint();
