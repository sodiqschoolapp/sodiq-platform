-- 0188 The exact columns beside the old ones (task 11.25a; the owner's spec
-- changes of 25 November 2026, decimal scores and decimal totals).
--
-- 07, The total: a score and a total may have up to two digits after the
-- decimal point; 13, Database: "typed scores and totals (with at most two
-- digits after the decimal point) … stored exactly, never as floating point".
--
-- Step 1 of two (.claude/rules/database.md: a change that rewrites a large
-- table is split; docs/deploy.md: "Every migration works with the version
-- that is running"). Beside each column that holds a work score or a work
-- total, an exact twin `<name>_exact`, filled with the same value, kept the
-- same on every write by a mirror trigger, and checked as the old column is.
-- The old column stays the source of truth and the application reads and
-- writes it unchanged. Step 2 (task 11.25b) drops the old columns and renames
-- the twins and their checks into their place, once this step runs on
-- production.
--
-- The fill writes each value unchanged and nothing else (the owner's approval,
-- stop-list item 3, 25 November 2026). It runs with the tables' user triggers
-- off for the fill statements only, inside this migration's transaction
-- (decision 4 of pull request #395, Look first): with them on, the journal's
-- guards would judge every row again, bump each cell's and work's version and
-- moment, write a false history line and mark every report out of date. No
-- guard reads the twins. No audit entry and no history line is written: no
-- value a person reads changes (decision 5).

-- ---------------------------------------------------------------------------
-- The domain: 0 to 1000 with at most two digits after the point. A value with
-- more is refused, never rounded (a `numeric(6,2)` would turn 7.555 into 7.56).
create domain work_amount as numeric
  constraint work_amount_check check (value >= 0 and value <= 1000 and value = trunc(value, 2));

-- ---------------------------------------------------------------------------
-- The twins (nullable, no default: no table is rewritten).
alter table journal_cells add column score_exact work_amount;
alter table journal_works add column total_exact work_amount;
alter table journal_cell_history
  add column score_before_exact work_amount,
  add column score_after_exact work_amount;
alter table journal_work_history
  add column total_before_exact work_amount,
  add column total_after_exact work_amount;
alter table journal_voids add column score_exact work_amount;
alter table exemption_clears add column score_exact work_amount;
-- A refused value is recorded as it was sent, whatever it was (0131: "What
-- was sent"), so this twin has no range and no scale (review of the plan,
-- correction 1): a refused 1500 or, after 11.25b, 7.555 is still recorded.
alter table journal_save_refusals add column value_sent_exact numeric;
alter table digest_entries
  add column sent_score_exact work_amount,
  add column sent_total_exact work_amount;

-- ---------------------------------------------------------------------------
-- The mirrors: unconditional, the old column is the source. Each is named
-- `<table>_zz_exact_mirror`, so that it runs after every other BEFORE row
-- trigger of its table (PostgreSQL runs them by name) and mirrors the value
-- as it is stored, also one another trigger set or cleared.
create function journal_cells_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.score_exact := new.score;
  return new;
end;
$$;

create trigger journal_cells_zz_exact_mirror
  before insert or update on journal_cells
  for each row execute function journal_cells_exact_mirror();

create function journal_works_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.total_exact := new.total;
  return new;
end;
$$;

create trigger journal_works_zz_exact_mirror
  before insert or update on journal_works
  for each row execute function journal_works_exact_mirror();

create function journal_cell_history_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.score_before_exact := new.score_before;
  new.score_after_exact := new.score_after;
  return new;
end;
$$;

create trigger journal_cell_history_zz_exact_mirror
  before insert or update on journal_cell_history
  for each row execute function journal_cell_history_exact_mirror();

create function journal_work_history_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.total_before_exact := new.total_before;
  new.total_after_exact := new.total_after;
  return new;
end;
$$;

create trigger journal_work_history_zz_exact_mirror
  before insert or update on journal_work_history
  for each row execute function journal_work_history_exact_mirror();

create function journal_voids_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.score_exact := new.score;
  return new;
end;
$$;

create trigger journal_voids_zz_exact_mirror
  before insert or update on journal_voids
  for each row execute function journal_voids_exact_mirror();

create function exemption_clears_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.score_exact := new.score;
  return new;
end;
$$;

create trigger exemption_clears_zz_exact_mirror
  before insert or update on exemption_clears
  for each row execute function exemption_clears_exact_mirror();

create function journal_save_refusals_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.value_sent_exact := new.value_sent;
  return new;
end;
$$;

create trigger journal_save_refusals_zz_exact_mirror
  before insert or update on journal_save_refusals
  for each row execute function journal_save_refusals_exact_mirror();

create function digest_entries_exact_mirror() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.sent_score_exact := new.sent_score;
  new.sent_total_exact := new.sent_total;
  return new;
end;
$$;

create trigger digest_entries_zz_exact_mirror
  before insert or update on digest_entries
  for each row execute function digest_entries_exact_mirror();

-- ---------------------------------------------------------------------------
-- The fill, with each table's user triggers off for its statement only.
alter table journal_cells disable trigger user;
update journal_cells set score_exact = score where score is not null;
alter table journal_cells enable trigger user;

alter table journal_works disable trigger user;
update journal_works set total_exact = total where total is not null;
alter table journal_works enable trigger user;

alter table journal_cell_history disable trigger user;
update journal_cell_history
  set score_before_exact = score_before, score_after_exact = score_after
  where score_before is not null or score_after is not null;
alter table journal_cell_history enable trigger user;

alter table journal_work_history disable trigger user;
update journal_work_history
  set total_before_exact = total_before, total_after_exact = total_after
  where total_before is not null or total_after is not null;
alter table journal_work_history enable trigger user;

alter table journal_voids disable trigger user;
update journal_voids set score_exact = score where score is not null;
alter table journal_voids enable trigger user;

alter table exemption_clears disable trigger user;
update exemption_clears set score_exact = score where score is not null;
alter table exemption_clears enable trigger user;

alter table journal_save_refusals disable trigger user;
update journal_save_refusals set value_sent_exact = value_sent where value_sent is not null;
alter table journal_save_refusals enable trigger user;

alter table digest_entries disable trigger user;
update digest_entries
  set sent_score_exact = sent_score, sent_total_exact = sent_total
  where sent_score is not null or sent_total is not null;
alter table digest_entries enable trigger user;

-- ---------------------------------------------------------------------------
-- The twin checks: the same expressions as the old columns' checks, on the
-- twins, added after the fill (some would refuse the rows before it). Step 2
-- renames them into the old names and scans nothing. `journal_cells_score_exact_check`
-- repeats a bound of the domain; it is kept so that the rename keeps the name
-- `journal_cells_score_check`, as does the upper bound of the total's check.
alter table journal_cells
  add constraint journal_cells_score_exact_check check (score_exact >= 0),
  add constraint journal_cells_attendance_exact_check check (
    work_id is not null or score_exact is null
  ),
  add constraint journal_cells_not_graded_exact_check check (
    not not_graded or (work_id is not null and score_exact is null)
  );
alter table journal_works
  add constraint journal_works_total_exact_check check (total_exact between 1 and 1000);
alter table exemption_clears
  add constraint exemption_clears_value_exact_check check (
    mark is not null or score_exact is not null
  );
alter table digest_entries
  add constraint digest_entries_removed_exact_check check (
    (state = 'removed') = (
      sent_mark is null and sent_score_exact is null and sent_total_exact is null
      and sent_version is null
    )
  );

-- ---------------------------------------------------------------------------
-- The check of the fill: every twin equals its old column, nulls included.
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
      raise exception 'work_amounts_fill: % rows of % differ from their exact twin',
        found_rows, found_table;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The application's rights on the twins, as on the old columns, so that the
-- rename of step 2 keeps them.
grant select (score_exact), insert (score_exact), update (score_exact) on journal_cells to sodiq_app;
grant select (total_exact), insert (total_exact), update (total_exact) on journal_works to sodiq_app;
grant select (score_before_exact, score_after_exact), insert (score_before_exact, score_after_exact)
  on journal_cell_history to sodiq_app;
grant select (total_before_exact, total_after_exact), insert (total_before_exact, total_after_exact)
  on journal_work_history to sodiq_app;
grant select (score_exact), insert (score_exact) on journal_voids to sodiq_app;
grant select (score_exact), insert (score_exact) on exemption_clears to sodiq_app;
grant select (value_sent_exact), insert (value_sent_exact) on journal_save_refusals to sodiq_app;
grant select (sent_score_exact, sent_total_exact), insert (sent_score_exact, sent_total_exact)
  on digest_entries to sodiq_app;
