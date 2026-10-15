-- 0059 Lessons and time claims: the spec review of the build (task 5.1a,
-- pull request #107). 0058 is applied in working databases, so its fixes are
-- a migration of their own.
--
-- Should-fix 3: docs/spec/edge-cases/time-dates-calendar.md, "Quarter dates
-- are edited after lessons exist": "A boundary can move only over future
-- dates, so a held lesson never changes quarter." A block's quarter changes
-- only when its date is after today in the branch's time zone, not when its
-- start is merely later today.
-- Should-fix 4: every key between the new tables carries branch_id (spec
-- review of the plan, 1): the claims' keys to their lesson and block.
-- Should-fix 5: no lock of the version in a before-row trigger
-- (.claude/rules/database.md): the version of a new regular block is checked
-- at the commit, after a FOR SHARE lock taken there.

alter table time_claims
  drop constraint time_claims_lesson_id_fkey,
  drop constraint time_claims_block_id_fkey,
  add constraint time_claims_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  add constraint time_claims_block_fkey foreign key (block_id, branch_id)
    references lesson_blocks (id, branch_id) on delete cascade;

-- The date and the quarter of a block. Runs as the invoker.
create or replace function lesson_blocks_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  zone text;
  quarter_year uuid;
  quarter_start date;
  quarter_end date;
  moment timestamptz;
begin
  select b.time_zone into zone from branches b where b.id = new.branch_id;
  if zone is null then
    -- The foreign key answers it.
    return new;
  end if;
  if (new.starts_at at time zone zone)::date <> new.lesson_date
    or (new.ends_at at time zone zone)::date <> new.lesson_date then
    raise exception 'lesson_block_date'
      using errcode = 'check_violation', constraint = 'lesson_block_date';
  end if;

  select q.academic_year_id, q.start_date, q.end_date
    into quarter_year, quarter_start, quarter_end
    from quarters q where q.id = new.quarter_id and q.branch_id = new.branch_id;
  if found and (
    quarter_year is distinct from new.academic_year_id
    or quarter_start is null
    or new.lesson_date not between quarter_start and quarter_end
  ) then
    raise exception 'lesson_block_quarter'
      using errcode = 'check_violation', constraint = 'lesson_block_quarter';
  end if;

  -- A move stays in its quarter, and only a block dated after today in the
  -- branch's time zone changes quarter; without a moment of the transaction,
  -- no quarter changes (correction 4).
  if tg_op = 'UPDATE' and new.quarter_id is distinct from old.quarter_id then
    moment := class_tutors_moment();
    if new.lesson_date is distinct from old.lesson_date
      or moment is null
      or old.lesson_date <= (moment at time zone zone)::date then
      raise exception 'lesson_block_quarter_fixed'
        using errcode = 'check_violation', constraint = 'lesson_block_quarter_fixed';
    end if;
  end if;
  return new;
end;
$$;

-- Decision 13: a regular block's version is of the block's year and not a
-- draft, checked at the commit after the version is locked FOR SHARE and read
-- in a statement of its own. A publish holds the version FOR UPDATE already.
-- Runs as the invoker.
create function lesson_blocks_version() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block lesson_blocks%rowtype;
  version_year uuid;
  version_state text;
begin
  select * into block from lesson_blocks b where b.id = new.id;
  if not found or block.version_id is null then
    return null;
  end if;
  perform 1 from timetable_versions v where v.id = block.version_id for share;
  select v.academic_year_id, v.status into version_year, version_state
    from timetable_versions v where v.id = block.version_id;
  if version_year is distinct from block.academic_year_id or version_state = 'draft' then
    raise exception 'lesson_block_version'
      using errcode = 'check_violation', constraint = 'lesson_block_version';
  end if;
  return null;
end;
$$;

create constraint trigger lesson_blocks_version
  after insert on lesson_blocks
  deferrable initially deferred
  for each row execute function lesson_blocks_version();

-- Nit 7: a double pair id is made by the API for one branch; the checks of
-- 0058 count the pair within what the branch filter shows.
comment on column lesson_blocks.double_pair_id is
  'The two blocks of a double lesson share it; made by the API, one branch only.';
comment on column pattern_blocks.double_pair_id is
  'The two blocks of a double lesson share it; made by the API, one branch only.';
