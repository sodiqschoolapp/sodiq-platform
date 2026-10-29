-- 0143 School-wide change rows and two new kinds of prepared units (task 10.1b, pull request #263).
--
-- Until now a unit's preparation kept a fingerprint of the eight school-wide inputs
-- (`SCHOOL_INPUTS` of `apps/api/src/modules/results/prepared/prepared.query.ts`), and every read
-- of prepared totals hashed every row of those tables to compare it (task 9.3b-1). At three
-- times the school's size that hash is paid by every report and home page. A write of one of
-- those tables now writes a row of `report_school_changes` in its own transaction instead, as the
-- branch tables write `report_changes` (0140): a unit is behind while a school change row is not
-- visible in the snapshot of its preparation. The meaning is the one of 9.3b-1 (any insert,
-- update or delete of those tables puts every unit of every branch behind); the rows are
-- appended, never updated, so two writers of those tables never wait on one another (plan
-- decision 3, Look first; review of the plan, finding 2).
--
-- The kinds `closing` (a quarter and a subject: the items of the closing checklist that do not
-- move with the clock) and `class_figures` (a quarter and a class: the figures of the class's
-- rating) join the list (plan decision 10, Look first).
--
-- Nothing here changes or removes an existing row: the prepared rows of before keep their
-- fingerprint, which no longer matches (`PREPARED_SHAPE`), so the job prepares them again.

create table report_school_changes (
  -- The transaction of the change: a preparation saw it when it is visible in its snapshot.
  xid xid8 not null default pg_current_xact_id(),
  -- The table written; bookkeeping for the reader of a change, no rule reads it.
  table_name text not null,
  -- The injected clock (`app.now`); bookkeeping, no rule compares it.
  changed_at timestamptz
);

-- The freshness test reads only the rows newer than a snapshot's oldest transaction.
create index report_school_changes_xid_idx on report_school_changes (xid);

grant select, insert on report_school_changes to sodiq_app;
-- The preparation removes the rows every prepared unit of every branch saw (review correction 2).
grant delete on report_school_changes to sodiq_app;

create function report_changed_school() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  changed boolean;
begin
  -- A statement that changed no row writes nothing.
  if tg_op = 'INSERT' then
    select exists (select from new_rows) into changed;
  elsif tg_op = 'DELETE' then
    select exists (select from old_rows) into changed;
  else
    select exists (select from new_rows) into changed;
  end if;
  if changed then
    insert into report_school_changes (table_name, changed_at)
    values (tg_table_name, class_tutors_moment());
  end if;
  return null;
end;
$$;

create function report_watch_school(target regclass) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  name text := replace(target::text, '.', '_');
begin
  execute format(
    'create trigger %I after insert on %s referencing new table as new_rows '
    'for each statement execute function report_changed_school()', name || '_school_insert', target);
  execute format(
    'create trigger %I after update on %s referencing old table as old_rows new table as new_rows '
    'for each statement execute function report_changed_school()', name || '_school_update', target);
  execute format(
    'create trigger %I after delete on %s referencing old table as old_rows '
    'for each statement execute function report_changed_school()', name || '_school_delete', target);
end;
$$;

-- `SCHOOL_INPUTS`, held complete by the inputs check of the speed run.
select report_watch_school('absences');
select report_watch_school('account_lock_spans');
select report_watch_school('branches');
select report_watch_school('staff');
select report_watch_school('staff_status_moments');
select report_watch_school('staff_statuses');
select report_watch_school('subject_switches');
select report_watch_school('subjects');

drop function report_watch_school(regclass);

alter table report_prepared drop constraint report_prepared_kind_check;
alter table report_prepared add constraint report_prepared_kind_check check (
  kind in ('outcomes', 'figures', 'statuses', 'attendance', 'closing', 'class_figures')
);
