-- 0111 The forced delete of a lesson with its cells and works, and their
-- restore (task 6.1b-2, pull request #208).
--
-- docs/spec/06-timetable.md, Protection: "A dated lesson that already has
-- attendance or marks cannot be deleted ..." "Forced delete is for Super
-- Admin only, with a typed reason. The attendance and marks are kept for 30
-- days and can be restored." .claude/rules/journal.md: "Every change to a
-- cell writes a history entry in the same transaction".
--
-- The plan approved on pull request #208 with corrections 1 to 4: decisions
-- 1, 6, 7 and 9. Every waiver is held to the exact rows of the store row of
-- the same transaction (`forced_deletes.rows`), which the application cannot
-- change (0105 grants only `restored_at` and `restored_by`). 0105, 0108 and
-- 0109 are not edited.

-- ---------------------------------------------------------------------------
-- The cells and works a store row keeps (`rows -> 'cells'`, `rows -> 'works'`,
-- written by `LessonForcedDeletes`). Run as the invoker.

create function forced_store_cells(store forced_deletes)
returns table (
  id uuid,
  student_id uuid,
  work_id uuid,
  mark smallint,
  score integer,
  version integer,
  changed_by uuid,
  changed_how text,
  changed_at timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select c.id, c.student_id, c.work_id, c.mark, c.score, c.version, c.changed_by,
    c.changed_how, c.changed_at
  from jsonb_to_recordset(coalesce(store.rows -> 'cells', '[]'::jsonb)) as c(
    id uuid, student_id uuid, work_id uuid, mark smallint, score integer, version integer,
    changed_by uuid, changed_how text, changed_at timestamptz
  );
$$;

create function forced_store_works(store forced_deletes)
returns table (id uuid, kind text, total integer, not_held boolean)
language sql
stable
set search_path = pg_catalog, public
as $$
  select w.id, w.kind, w.total, w.not_held
  from jsonb_to_recordset(coalesce(store.rows -> 'works', '[]'::jsonb)) as w(
    id uuid, kind text, total integer, not_held boolean
  );
$$;

grant execute on function forced_store_cells(forced_deletes) to sodiq_app;
grant execute on function forced_store_works(forced_deletes) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The deletes (decision 1): a cell or a work also goes when a store row of
-- this transaction names its lesson and holds that exact row.

create or replace function journal_cells_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from forced_deletes f
    cross join lateral forced_store_cells(f) c
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
      and c.id = old.id
      and c.student_id = old.student_id
      and c.work_id is not distinct from old.work_id
      and c.mark is not distinct from old.mark
      and c.score is not distinct from old.score
      and c.version = old.version
      and c.changed_by = old.changed_by
      and c.changed_how = old.changed_how
      and c.changed_at = old.changed_at
  ) then
    return old;
  end if;
  if pg_trigger_depth() <= 1 or old.mark is not null or old.score is not null then
    raise exception 'journal_cell_delete'
      using errcode = 'check_violation', constraint = 'journal_cell_delete';
  end if;
  return old;
end;
$$;

create or replace function journal_works_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from forced_deletes f
    cross join lateral forced_store_works(f) w
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
      and w.id = old.id
      and w.kind = old.kind
      and w.total is not distinct from old.total
      and w.not_held = old.not_held
  ) then
    return old;
  end if;
  if pg_trigger_depth() <= 1 or old.total is not null or old.not_held then
    raise exception 'journal_cell_delete'
      using errcode = 'check_violation', constraint = 'journal_cell_delete';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- The history line of a cell with a value that a forced delete removes
-- (decision 9, correction 2): `forced_delete` is written in the history only,
-- never on a cell row. The version after the stored one, the store row's
-- author. Runs as the invoker.

create function journal_cells_forced_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  author uuid;
begin
  if old.mark is null and old.score is null then
    return null;
  end if;
  select f.deleted_by into author from forced_deletes f
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
    limit 1;
  if author is null then
    return null;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  insert into journal_cell_history (
    branch_id, cell_id, lesson_id, student_id, work_id, version,
    mark_before, score_before, changed_by, changed_how, changed_at
  ) values (
    old.branch_id, old.id, old.lesson_id, old.student_id, old.work_id, old.version + 1,
    old.mark, old.score, author, 'forced_delete', moment
  );
  return null;
end;
$$;

create trigger journal_cells_forced_history
  after delete on journal_cells
  for each row execute function journal_cells_forced_history();

-- ---------------------------------------------------------------------------
-- The restore of a cell (decisions 1 and 6, correction 3): an insert of a
-- cell whose lesson a restore of this transaction names is let in only when
-- it equals a cell of that store row; the version is the stored one plus the
-- lines written since (2 with a value: the forced delete's line and this one;
-- 1 without), the restorer, `restored` and the moment. The checks of a
-- cancelled lesson and of who is expected are skipped for it. Everything else
-- as in 0109.

alter table journal_cells drop constraint journal_cells_changed_how_check;
alter table journal_cells add constraint journal_cells_changed_how_check check (
  changed_how in (
    'entry', 'late_entry', 'correction', 'exemption', 'transfer', 'cancellation',
    'not_held', 'offline_entry', 'undo', 'restored'
  )
);

create or replace function journal_cells_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  lesson_row lessons;
  stored_version integer;
  restorer uuid;
begin
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    select c.version, f.restored_by into stored_version, restorer
      from forced_deletes f
      cross join lateral forced_store_cells(f) c
      where f.restored_xact = pg_current_xact_id()
        and f.record_type = 'lesson'
        and f.record_id = new.lesson_id
        and c.id = new.id
        and c.student_id = new.student_id
        and c.work_id is not distinct from new.work_id
        and c.mark is not distinct from new.mark
        and c.score is not distinct from new.score
      limit 1;
    if stored_version is null then
      raise exception 'journal_cell_restore'
        using errcode = 'check_violation', constraint = 'journal_cell_restore';
    end if;
    new.version := stored_version
      + case when new.mark is null and new.score is null then 1 else 2 end;
    new.changed_by := restorer;
    new.changed_how := 'restored';
    new.changed_at := moment;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  select * into lesson_row from lessons l where l.id = new.lesson_id;
  if lesson_row.cancel_cause is not null then
    raise exception 'journal_cell_cancelled'
      using errcode = 'check_violation', constraint = 'journal_cell_cancelled';
  end if;
  if new.mark is null and new.score is null then
    -- A cleared value: allowed on a lesson that is not cancelled, the old
    -- value stays in the history.
    return new;
  end if;
  perform 1 from class_memberships m
    where lesson_row.class_id is not null
      and m.class_id = lesson_row.class_id
      and m.student_id = new.student_id
    for share;
  perform 1 from group_memberships m
    where lesson_row.group_id is not null
      and m.group_id = lesson_row.group_id
      and m.student_id = new.student_id
    for share;
  if not lesson_student_expected(new.lesson_id, new.student_id) then
    raise exception 'journal_cell_not_member'
      using errcode = 'check_violation', constraint = 'journal_cell_not_member';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The restore of a work: a total or "not held" is inserted by the application
-- only as a work of the store row restored in this transaction (totals are
-- otherwise 8.1's). A write as the migrator (a test fixture) is not checked.

grant insert (total, not_held) on journal_works to sodiq_app;

create function journal_works_insert_data() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'sodiq_app' or (new.total is null and not new.not_held) then
    return new;
  end if;
  if not exists (
    select 1 from forced_deletes f
    cross join lateral forced_store_works(f) w
    where f.restored_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = new.lesson_id
      and w.id = new.id
      and w.kind = new.kind
      and w.total is not distinct from new.total
      and w.not_held = new.not_held
  ) then
    raise exception 'journal_work_insert_data'
      using errcode = 'check_violation', constraint = 'journal_work_insert_data';
  end if;
  return new;
end;
$$;

create trigger journal_works_insert_data
  before insert on journal_works
  for each row execute function journal_works_insert_data();

-- ---------------------------------------------------------------------------
-- The student of a kept mark (decision 7, Look first): while a store row can
-- still be restored, a student who has a cell with a value in it is not
-- deleted, as the cell's key refused it before the forced delete, whatever
-- branch holds the row. Raised as a key refusal, which the student delete and
-- the merge map to their codes. Read past the branch filter; answers yes or no.

create function student_in_forced_store(student_ref uuid) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from forced_deletes f
    cross join lateral forced_store_cells(f) c
    where f.record_type = 'lesson'
      and f.restored_at is null
      and (class_tutors_moment() is null or f.restore_until > class_tutors_moment())
      and c.student_id = student_ref
      and (c.mark is not null or c.score is not null)
  );
$$;

revoke all on function student_in_forced_store(uuid) from public;
grant execute on function student_in_forced_store(uuid) to sodiq_app;

create function students_forced_cells() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if student_in_forced_store(old.id) then
    raise exception 'student_forced_cells'
      using errcode = 'foreign_key_violation', constraint = 'student_forced_cells';
  end if;
  return old;
end;
$$;

create trigger students_forced_cells
  before delete on students
  for each row execute function students_forced_cells();
