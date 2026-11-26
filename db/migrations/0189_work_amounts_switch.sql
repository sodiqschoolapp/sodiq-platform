-- 0189 The switch to the exact columns (task 11.25b; the owner's spec changes
-- of 25 November 2026, decimal scores and decimal totals).
--
-- Step 2 of two (0188, task 11.25a; docs/deploy.md: "Every migration works
-- with the version that is running"). 0188 put an exact twin `<name>_exact` of
-- the domain `work_amount` beside each column that holds a work score or a
-- work total, kept equal by a mirror trigger, with the same checks. Once that
-- ran on production (the owner, 26 November 2026), this step drops the
-- mirrors and the old integer columns, and renames the twins and their checks
-- into the old names. The code of 11.25a, running while this migration runs,
-- names only `score` and `total` (never a twin), reads a `numeric` as a JS
-- number and writes whole numbers, which `work_amount` takes; so it works on
-- this schema.
--
-- No value changes (8 stays 8) and no row is written: a drop of a column and
-- a rename are changes of the catalog only (the owner's approval, stop-list
-- item 3, 25 November 2026: "the migrations that … retire the old columns,
-- each value unchanged"). No audit entry and no history line (decision 10 of
-- pull request #397, as decision 5 of #395). The twin checks were created and
-- validated in 0188, so the renames scan nothing.
--
-- Nothing else depends on the old columns: no view, index, `update of`
-- trigger list or SQL function body; the plpgsql guards name `new.score` and
-- `new.total` by name and declare no integer variable of them. Their checks
-- (`journal_cells_score_check`, `journal_cells_attendance_check`,
-- `journal_cells_not_graded_check`, `journal_works_total_check`,
-- `exemption_clears_value_check`, `digest_entries_removed_check`) go with the
-- columns they name. The two functions that read a forced-delete store with an
-- integer score or total are created again with `work_amount`.

-- ---------------------------------------------------------------------------
-- A guard first: every twin equals its old column, nulls included. The
-- mirrors keep them equal; a row that differs stops the migration, named.
do $$
declare
  found_rows bigint;
  found_table text;
begin
  for found_table, found_rows in
    select 'journal_cells', count(*) from journal_cells
      where score_exact is distinct from score
    union all select 'journal_works', count(*) from journal_works
      where total_exact is distinct from total
    union all select 'journal_cell_history', count(*) from journal_cell_history
      where score_before_exact is distinct from score_before
        or score_after_exact is distinct from score_after
    union all select 'journal_work_history', count(*) from journal_work_history
      where total_before_exact is distinct from total_before
        or total_after_exact is distinct from total_after
    union all select 'journal_voids', count(*) from journal_voids
      where score_exact is distinct from score
    union all select 'exemption_clears', count(*) from exemption_clears
      where score_exact is distinct from score
    union all select 'journal_save_refusals', count(*) from journal_save_refusals
      where value_sent_exact is distinct from value_sent
    union all select 'digest_entries', count(*) from digest_entries
      where sent_score_exact is distinct from sent_score
        or sent_total_exact is distinct from sent_total
  loop
    if found_rows > 0 then
      raise exception 'work_amounts_switch: % rows of % differ from their exact twin',
        found_rows, found_table;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The mirrors go.
drop trigger journal_cells_zz_exact_mirror on journal_cells;
drop function journal_cells_exact_mirror();
drop trigger journal_works_zz_exact_mirror on journal_works;
drop function journal_works_exact_mirror();
drop trigger journal_cell_history_zz_exact_mirror on journal_cell_history;
drop function journal_cell_history_exact_mirror();
drop trigger journal_work_history_zz_exact_mirror on journal_work_history;
drop function journal_work_history_exact_mirror();
drop trigger journal_voids_zz_exact_mirror on journal_voids;
drop function journal_voids_exact_mirror();
drop trigger exemption_clears_zz_exact_mirror on exemption_clears;
drop function exemption_clears_exact_mirror();
drop trigger journal_save_refusals_zz_exact_mirror on journal_save_refusals;
drop function journal_save_refusals_exact_mirror();
drop trigger digest_entries_zz_exact_mirror on digest_entries;
drop function digest_entries_exact_mirror();

-- ---------------------------------------------------------------------------
-- The functions that read a forced-delete store with an integer score or total
-- go before the columns, and come back below with `work_amount`.
drop function forced_store_cells(forced_deletes);
drop function forced_store_works(forced_deletes);

-- ---------------------------------------------------------------------------
-- The old columns go, with the checks that name them (`restrict`: anything
-- else that depended on one would stop the migration).
alter table journal_cells drop column score restrict;
alter table journal_works drop column total restrict;
alter table journal_cell_history
  drop column score_before restrict,
  drop column score_after restrict;
alter table journal_work_history
  drop column total_before restrict,
  drop column total_after restrict;
alter table journal_voids drop column score restrict;
alter table exemption_clears drop column score restrict;
alter table journal_save_refusals drop column value_sent restrict;
alter table digest_entries
  drop column sent_score restrict,
  drop column sent_total restrict;

-- ---------------------------------------------------------------------------
-- The twins take the old names; their grants and the partitions follow.
alter table journal_cells rename column score_exact to score;
alter table journal_works rename column total_exact to total;
alter table journal_cell_history rename column score_before_exact to score_before;
alter table journal_cell_history rename column score_after_exact to score_after;
alter table journal_work_history rename column total_before_exact to total_before;
alter table journal_work_history rename column total_after_exact to total_after;
alter table journal_voids rename column score_exact to score;
alter table exemption_clears rename column score_exact to score;
alter table journal_save_refusals rename column value_sent_exact to value_sent;
alter table digest_entries rename column sent_score_exact to sent_score;
alter table digest_entries rename column sent_total_exact to sent_total;

-- The twin checks take the old names (metadata only: valid since 0188).
alter table journal_cells rename constraint journal_cells_score_exact_check
  to journal_cells_score_check;
alter table journal_cells rename constraint journal_cells_attendance_exact_check
  to journal_cells_attendance_check;
alter table journal_cells rename constraint journal_cells_not_graded_exact_check
  to journal_cells_not_graded_check;
alter table journal_works rename constraint journal_works_total_exact_check
  to journal_works_total_check;
alter table exemption_clears rename constraint exemption_clears_value_exact_check
  to exemption_clears_value_check;
alter table digest_entries rename constraint digest_entries_removed_exact_check
  to digest_entries_removed_check;

-- ---------------------------------------------------------------------------
-- The readers of a forced-delete store (0111, 0119), with a score and a total
-- of `work_amount`: a store written before the switch holds whole numbers, one
-- written after it may hold 7.5; both read back.
create function forced_store_cells(store forced_deletes)
returns table (
  id uuid, student_id uuid, work_id uuid, mark smallint, score work_amount, version integer,
  changed_by uuid, changed_how text, changed_at timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select c.id, c.student_id, c.work_id, c.mark, c.score, c.version, c.changed_by,
    c.changed_how, c.changed_at
  from jsonb_to_recordset(coalesce(store.rows -> 'cells', '[]'::jsonb)) as c(
    id uuid, student_id uuid, work_id uuid, mark smallint, score work_amount, version integer,
    changed_by uuid, changed_how text, changed_at timestamptz
  );
$$;

create function forced_store_works(store forced_deletes)
returns table (
  id uuid, kind text, total work_amount, not_held boolean, source_lesson_id uuid,
  plan_work_id uuid, "position" integer, carried_from_lesson_id uuid, version integer,
  changed_by uuid, changed_how text, changed_at timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select w.id, w.kind, w.total, w.not_held, w.source_lesson_id, w.plan_work_id, w."position",
    w.carried_from_lesson_id, w.version, w.changed_by, w.changed_how, w.changed_at
  from jsonb_to_recordset(coalesce(store.rows -> 'works', '[]'::jsonb)) as w(
    id uuid, kind text, total work_amount, not_held boolean, source_lesson_id uuid,
    plan_work_id uuid, "position" integer, carried_from_lesson_id uuid, version integer,
    changed_by uuid, changed_how text, changed_at timestamptz
  );
$$;

-- `execute` for the application only (decision 4 of pull request #397, Look
-- first: 0111 and 0119 left the default grant to `public` in place).
revoke all on function forced_store_cells(forced_deletes) from public;
revoke all on function forced_store_works(forced_deletes) from public;
grant execute on function forced_store_cells(forced_deletes) to sodiq_app;
grant execute on function forced_store_works(forced_deletes) to sodiq_app;
