-- 0107 The publish at the real size: no lock of its own for a block the
-- transaction inserted (task 5.12d, pull request #204).
--
-- docs/spec/edge-cases/developer-rules.md, Class in one block: "A constraint
-- trigger checks that each student of a block's classes is in at most one of
-- its lessons, using membership on the lesson date." docs/spec/14-quality-plan.md,
-- Speed tests: "measured automatically with a full-size data set: all
-- branches, a full year of lessons".
--
-- The real-size run of 5.12c stopped at the first publish with "out of shared
-- memory": the check of 0058/0060 took one advisory lock per dated block, and a
-- branch's year is about 30,000 blocks in one transaction, more than the lock
-- table holds at the default max_locks_per_transaction.
--
-- The plan approved on pull request #204 (decisions 1 and 2, Look first): the
-- block's own lock orders two writers of one block, each of which sees only its
-- own lessons. A block inserted by an open transaction is seen by no other
-- one: a lesson insert into it fails its key check, and a lesson update or a
-- membership check reads no lesson of it. So it needs no lock of its own until
-- the commit, after which every writer takes the lock as before. The locks of
-- its classes and groups stay, in the same order, so a membership change still
-- waits for the publish or the publish for it; no lock is added.

-- ---------------------------------------------------------------------------
-- created_at is read by the rule below: an update of it is refused, so that an
-- older block can never pass as one inserted by this transaction (decision 2).
-- The application has no update right on the column (0058 grants the update of
-- quarter_id, lesson_date, starts_at, ends_at and double_pair_id only); the
-- trigger refuses it to every user, so that a later grant cannot open it.
-- The forced-delete restore inserts its stored row, which this does not touch.

comment on column lesson_blocks.created_at is
  'The moment of the insert. timetable_lock_block (0107) reads it with xmin to tell a block inserted by the transaction; never updated (lesson_blocks_created_at_fixed).';

create function lesson_blocks_created_at_fixed() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'lesson_block_created_at_fixed'
      using errcode = 'check_violation', constraint = 'lesson_block_created_at_fixed';
  end if;
  return new;
end;
$$;

create trigger lesson_blocks_created_at_fixed
  before update of created_at on lesson_blocks
  for each row execute function lesson_blocks_created_at_fixed();

-- ---------------------------------------------------------------------------
-- 0060, replaced: the advisory locks of the units of a block (its classes and
-- groups, in the order of the id), then of the block, unless this transaction
-- inserted the block (decision 1). Inserted by this transaction: its row
-- version was written by the transaction's own id (a block written inside a
-- savepoint has the id of the subtransaction and keeps its lock) and its
-- created_at is the start of this transaction (an update keeps the older
-- created_at, so a block that existed before keeps its lock). Runs as the
-- invoker.
create or replace function timetable_lock_block(block_ref uuid) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  unit uuid;
begin
  for unit in
    select u.id from (
      select l.class_id as id from lessons l where l.block_id = block_ref and l.class_id is not null
      union
      select l.group_id from lessons l where l.block_id = block_ref and l.group_id is not null
    ) u
    order by u.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('timetable_unit:' || unit::text, 0));
  end loop;
  if exists (
    select 1 from lesson_blocks b
      where b.id = block_ref
        and b.xmin = pg_current_xact_id()::xid
        and b.created_at = now()
  ) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_block:' || block_ref::text, 0));
end;
$$;
