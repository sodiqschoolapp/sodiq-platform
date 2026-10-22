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
-- The plan approved on pull request #204 (decision 1, Look first): the block's
-- own lock orders two writers of one block, each of which sees only its own
-- lessons. A block inserted by an open transaction is seen by no other one: a
-- lesson insert into it fails its key check, and a lesson update or a
-- membership check reads no lesson of it. So it needs no lock of its own until
-- the commit, after which every writer takes the lock as before. The locks of
-- its classes and groups stay, in the same order, so a membership change still
-- waits for the publish or the publish for it; no lock is added.

-- ---------------------------------------------------------------------------
-- The transaction that inserted a block (decision 2, changed in the build).
-- The plan read "inserted by this transaction" from xmin and created_at, but
-- every route's work runs under the savepoint of its request key
-- (request-keys.ts), so xmin holds the id of a subtransaction and never
-- matched a publish's blocks. As day_template_versions.created_xact (0017) and
-- forced_deletes.created_xact (0105): the top-level id, written by the trigger
-- on every insert (a restored stored row included: it is inserted now) and
-- never changed by an update. Rows written before this migration keep null and
-- so keep their lock. The column is added without a default, so the table is
-- not rewritten.

alter table lesson_blocks add column created_xact xid8;

comment on column lesson_blocks.created_xact is
  'The top-level transaction that inserted the block (0107): timetable_lock_block takes no lock of its own for a block of the current transaction. Written by lesson_blocks_created_xact on insert, never updated.';

create function lesson_blocks_created_xact() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_xact := pg_current_xact_id();
  elsif new.created_xact is distinct from old.created_xact then
    raise exception 'lesson_block_created_xact_fixed'
      using errcode = 'check_violation', constraint = 'lesson_block_created_xact_fixed';
  end if;
  return new;
end;
$$;

create trigger lesson_blocks_created_xact
  before insert or update of created_xact on lesson_blocks
  for each row execute function lesson_blocks_created_xact();

-- ---------------------------------------------------------------------------
-- 0060, replaced: the advisory locks of the units of a block (its classes and
-- groups, in the order of the id), then of the block, unless this transaction
-- inserted the block (decision 1). Runs as the invoker.
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
      where b.id = block_ref and b.created_xact = pg_current_xact_id()
  ) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('timetable_block:' || block_ref::text, 0));
end;
$$;
