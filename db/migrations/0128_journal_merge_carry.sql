-- 0128 The merge carries the journal data of the merged record (task 8.6, pull
-- request #224).

-- Decision 8 with correction 1 of the plan review (From 3.3d). A carry changes `student_id`
-- alone, from the merged record to the kept one of a merge of this
-- transaction: it writes no version, no moment, no author and no history line
-- (the history stays under the merged id and is read by the cell, the comment
-- or the entry), and passes none of the write checks, which judged the value
-- when it was written. Every other update runs the triggers as before: each
-- trigger on insert or update is split into its insert (and delete) part and
-- its update part, the update part fired only when `student_id` stays.

create function journal_merge_carry() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (to_jsonb(new) - 'student_id') is distinct from (to_jsonb(old) - 'student_id')
    or not exists (
      select 1 from student_merges m
      where m.merged_xact = pg_current_xact_id()
        and m.merged_id = old.student_id
        and m.kept_id = new.student_id
    ) then
    raise exception 'journal_merge_carry'
      using errcode = 'check_violation', constraint = 'journal_merge_carry';
  end if;
  return new;
end;
$$;

-- journal_cells
drop trigger journal_cells_edit_guard on journal_cells;
create trigger journal_cells_edit_guard
  before insert or delete on journal_cells
  for each row execute function journal_cells_edit_guard();
create trigger journal_cells_edit_guard_update
  before update on journal_cells
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_cells_edit_guard();

drop trigger journal_cells_write on journal_cells;
create trigger journal_cells_write
  before insert on journal_cells
  for each row execute function journal_cells_write();
create trigger journal_cells_write_update
  before update on journal_cells
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_cells_write();

drop trigger journal_cells_history on journal_cells;
create trigger journal_cells_history
  after insert on journal_cells
  for each row execute function journal_cells_history();
create trigger journal_cells_history_update
  after update on journal_cells
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_cells_history();

create trigger journal_cells_merge_carry
  before update on journal_cells
  for each row when (old.student_id is distinct from new.student_id)
  execute function journal_merge_carry();

-- journal_comments
drop trigger journal_comments_edit_guard on journal_comments;
create trigger journal_comments_edit_guard
  before insert or delete on journal_comments
  for each row execute function journal_comments_edit_guard();
create trigger journal_comments_edit_guard_update
  before update on journal_comments
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_comments_edit_guard();

drop trigger journal_comments_write on journal_comments;
create trigger journal_comments_write
  before insert on journal_comments
  for each row execute function journal_comments_write();
create trigger journal_comments_write_update
  before update on journal_comments
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_comments_write();

drop trigger journal_comments_history on journal_comments;
create trigger journal_comments_history
  after insert or delete on journal_comments
  for each row execute function journal_comments_history();
create trigger journal_comments_history_update
  after update on journal_comments
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_comments_history();

create trigger journal_comments_merge_carry
  before update on journal_comments
  for each row when (old.student_id is distinct from new.student_id)
  execute function journal_merge_carry();

-- journal_rating_entries
drop trigger journal_rating_entries_edit_guard on journal_rating_entries;
create trigger journal_rating_entries_edit_guard
  before insert or delete on journal_rating_entries
  for each row execute function journal_rating_entries_edit_guard();
create trigger journal_rating_entries_edit_guard_update
  before update on journal_rating_entries
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_rating_entries_edit_guard();

drop trigger journal_rating_entries_write on journal_rating_entries;
create trigger journal_rating_entries_write
  before insert on journal_rating_entries
  for each row execute function journal_rating_entries_write();
create trigger journal_rating_entries_write_update
  before update on journal_rating_entries
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_rating_entries_write();

drop trigger journal_rating_entries_history on journal_rating_entries;
create trigger journal_rating_entries_history
  after insert on journal_rating_entries
  for each row execute function journal_rating_entries_history();
create trigger journal_rating_entries_history_update
  after update on journal_rating_entries
  for each row when (old.student_id is not distinct from new.student_id)
  execute function journal_rating_entries_history();

create trigger journal_rating_entries_merge_carry
  before update on journal_rating_entries
  for each row when (old.student_id is distinct from new.student_id)
  execute function journal_merge_carry();

grant update (student_id) on journal_cells to sodiq_app;
grant update (student_id) on journal_comments to sodiq_app;
grant update (student_id) on journal_rating_entries to sodiq_app;

-- Correction 1 of the plan review: the cells and comments a forced delete
-- keeps (`forced_deletes.rows -> 'cells'`, `-> 'comments'`, 0111, 0120) of
-- the merged record of a merge of this transaction name the kept record, in
-- every store not restored, so a restore gives them back under it and the
-- merged record's delete passes (`students_forced_cells`). The stores of
-- every branch, past the row filter; nothing else of a store changes.
create function forced_deletes_merge_carry(merge uuid) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  merge_row public.student_merges;
  changed integer;
begin
  select * into merge_row from public.student_merges m
    where m.id = forced_deletes_merge_carry.merge
      and m.merged_xact = pg_current_xact_id();
  if not found then
    raise exception 'journal_merge_carry'
      using errcode = 'check_violation', constraint = 'journal_merge_carry';
  end if;
  update public.forced_deletes f
    set rows = f.rows
      || jsonb_build_object(
        'cells', coalesce((
          select jsonb_agg(
            case when c ->> 'student_id' = merge_row.merged_id::text
              then jsonb_set(c, '{student_id}', to_jsonb(merge_row.kept_id::text))
              else c end
            order by ordinality)
          from jsonb_array_elements(coalesce(f.rows -> 'cells', '[]'::jsonb)) with ordinality as e(c, ordinality)
        ), '[]'::jsonb),
        'comments', coalesce((
          select jsonb_agg(
            case when c ->> 'student_id' = merge_row.merged_id::text
              then jsonb_set(c, '{student_id}', to_jsonb(merge_row.kept_id::text))
              else c end
            order by ordinality)
          from jsonb_array_elements(coalesce(f.rows -> 'comments', '[]'::jsonb)) with ordinality as e(c, ordinality)
        ), '[]'::jsonb)
      )
    where f.record_type = 'lesson'
      and f.restored_at is null
      and (
        exists (
          select 1 from jsonb_array_elements(coalesce(f.rows -> 'cells', '[]'::jsonb)) c
          where c ->> 'student_id' = merge_row.merged_id::text
        )
        or exists (
          select 1 from jsonb_array_elements(coalesce(f.rows -> 'comments', '[]'::jsonb)) c
          where c ->> 'student_id' = merge_row.merged_id::text
        )
      );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function forced_deletes_merge_carry(uuid) from public;
grant execute on function forced_deletes_merge_carry(uuid) to sodiq_app;

-- 0111's guard of a cell's delete, with one more path: in a merge of this
-- transaction, the kept record's empty cell on the key of a value the merged
-- record holds goes, so that the value is carried onto that key (decision 8).
-- The cell holds no value; its history lines stay.
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
  if old.mark is null and old.score is null and exists (
    select 1 from student_merges m
    join journal_cells a on a.student_id = m.merged_id
      and a.branch_id = old.branch_id
      and a.lesson_id = old.lesson_id
      and a.work_id is not distinct from old.work_id
      and (a.mark is not null or a.score is not null)
    where m.merged_xact = pg_current_xact_id()
      and m.kept_id = old.student_id
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
