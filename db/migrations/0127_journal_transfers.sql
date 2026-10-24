-- 0127 Transfers and leaving inside the journal (task 8.6, pull request #224).
--
-- `edge/students-classes-groups`: "Entries in the old journals on or after the
-- date are listed; he either moves the date past them or voids them with a
-- reason. They are never copied. In the new journal, cells of lessons already
-- held open as optional: they do not change the lesson's status and can be
-- filled for 7 days"; the 1 October row: "Absences and zeros entered after it
-- are voided: kept in history and removed from every figure".
--
-- - The `changed_how` checks of the cells, the comments and their history and
--   the rating entries gain `leaving` (and `transfer` where it was missing):
--   values added, none taken away (decision 3 as changed by correction 6 of
--   the plan review). `journal_edit_judge` (0122) needs nothing: it returns
--   every kind that is not a person's write unchanged.
-- - `journal_voids` keeps every value a move, a leaving or a merge voided, to
--   give it back when the change is taken back (decision 4); the void itself is
--   the existing clear, its reason in the history line (`app.void_reason`).
-- - `journal_optional_cells`: the held lessons a late move or return opens in
--   the new journal; the cells guard takes a person's write there after the
--   lock as a late entry until `open_until` (decision 10).
-- - `lesson_student_member`: a member of the lesson's class or group on its
--   date, whatever an exemption says; the readers of the moves ask it.
-- - `journal_former_member_names`: names and UID of a former member of a
--   journal's unit whose record is now of another branch (decision 7).
-- - `journal_comments_write` takes the student's class and group rows `for
--   share` as the cells and rating entries do, so a comment saved at the same
--   moment as a move waits for it.

alter table journal_cells drop constraint journal_cells_changed_how_check;
alter table journal_cells add constraint journal_cells_changed_how_check check (
  changed_how in (
    'entry', 'late_entry', 'correction', 'exemption', 'transfer', 'cancellation',
    'not_held', 'offline_entry', 'undo', 'restored', 'leaving'
  )
);

alter table journal_comments drop constraint journal_comments_changed_how_check;
alter table journal_comments add constraint journal_comments_changed_how_check check (
  changed_how in ('entry', 'restored', 'late_entry', 'correction', 'transfer', 'leaving')
);

alter table journal_comment_history drop constraint journal_comment_history_changed_how_check;
alter table journal_comment_history add constraint journal_comment_history_changed_how_check check (
  changed_how in (
    'entry', 'restored', 'forced_delete', 'late_entry', 'correction', 'transfer', 'leaving'
  )
);

alter table journal_rating_entries drop constraint journal_rating_entries_changed_how_check;
alter table journal_rating_entries add constraint journal_rating_entries_changed_how_check check (
  changed_how in ('entry', 'late_entry', 'correction', 'undo', 'transfer', 'leaving')
);

-- The reason of a void reaches the history line as a correction's does.
create or replace function journal_line_reason(how text) returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when how in ('correction', 'deleted') then journal_correction_reason()
    when how in ('transfer', 'leaving') then
      nullif(current_setting('app.void_reason', true), '')
  end
$$;

-- ---------------------------------------------------------------------------
-- The values voided (decision 4).

create table journal_voids (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  student_id uuid not null,
  -- The change that voided it: exactly one.
  move_id uuid references student_moves (id),
  leaving_id uuid references student_statuses (id),
  branch_move_id uuid references student_branch_moves (id),
  return_status_id uuid references student_statuses (id),
  merge_id uuid references student_merges (id),
  -- What was voided: exactly one.
  cell_id uuid,
  comment_id uuid,
  rating_entry_id uuid,
  -- The values before.
  mark smallint,
  score integer,
  rating_kind text,
  body text,
  visibility text,
  -- The version the void wrote, so that a give-back writes only over it.
  version integer not null,
  -- Required for a person's void; null only for a leaving's own void of
  -- absences and zeros (decision 6).
  reason text constraint journal_voids_reason_text_check check (
    length(btrim(reason)) between 1 and 500
  ),
  voided_by uuid not null references accounts (id),
  voided_at timestamptz not null,
  given_back_at timestamptz,
  given_back_by uuid references accounts (id),
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_voids_one_source check (
    num_nonnulls(move_id, leaving_id, branch_move_id, return_status_id, merge_id) = 1
  ),
  constraint journal_voids_one_target check (
    num_nonnulls(cell_id, comment_id, rating_entry_id) = 1
  ),
  constraint journal_voids_reason check (reason is not null or leaving_id is not null),
  constraint journal_voids_given_back_check check (
    (given_back_at is null) = (given_back_by is null)
  ),
  constraint journal_voids_cell_fkey foreign key (cell_id) references journal_cells (id)
    on delete cascade,
  constraint journal_voids_comment_fkey foreign key (comment_id) references journal_comments (id)
    on delete cascade,
  constraint journal_voids_rating_fkey foreign key (rating_entry_id)
    references journal_rating_entries (id) on delete cascade
);

create index journal_voids_student_idx on journal_voids (student_id);
create index journal_voids_move_idx on journal_voids (move_id) where move_id is not null;
create index journal_voids_leaving_idx on journal_voids (leaving_id) where leaving_id is not null;
create index journal_voids_branch_move_idx on journal_voids (branch_move_id)
  where branch_move_id is not null;
create index journal_voids_return_idx on journal_voids (return_status_id)
  where return_status_id is not null;
create index journal_voids_cell_idx on journal_voids (cell_id) where cell_id is not null;
create index journal_voids_comment_idx on journal_voids (comment_id) where comment_id is not null;
create index journal_voids_rating_idx on journal_voids (rating_entry_id)
  where rating_entry_id is not null;

alter table journal_voids enable row level security;
create policy branch_filter on journal_voids for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_voids to sodiq_app;
grant insert (
  id, branch_id, student_id, move_id, leaving_id, branch_move_id, return_status_id, merge_id,
  cell_id, comment_id, rating_entry_id, mark, score, rating_kind, body, visibility, version,
  reason, voided_by, voided_at
) on journal_voids to sodiq_app;
-- The give-back, and the merge that carries the student.
grant update (given_back_at, given_back_by, student_id) on journal_voids to sodiq_app;

-- ---------------------------------------------------------------------------
-- The optional cells of a late move or return (decision 10).

create table journal_optional_cells (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  move_id uuid references student_moves (id),
  branch_move_id uuid references student_branch_moves (id),
  return_status_id uuid references student_statuses (id),
  lesson_id uuid not null,
  student_id uuid not null,
  -- 00:00 branch time of the day after the seventh day following the day the
  -- change was recorded: from this moment the cell is closed (correction 3).
  open_until timestamptz not null,
  opened_at timestamptz not null,
  withdrawn_at timestamptz,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint journal_optional_cells_one_source check (
    num_nonnulls(move_id, branch_move_id, return_status_id) = 1
  ),
  constraint journal_optional_cells_order_check check (opened_at < open_until),
  constraint journal_optional_cells_withdrawn_check check (
    withdrawn_at is null or withdrawn_at >= opened_at
  ),
  constraint journal_optional_cells_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade
);

create index journal_optional_cells_lesson_idx on journal_optional_cells (lesson_id, student_id);
create index journal_optional_cells_student_idx on journal_optional_cells (student_id);

alter table journal_optional_cells enable row level security;
create policy branch_filter on journal_optional_cells for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select on journal_optional_cells to sodiq_app;
grant insert (
  id, branch_id, move_id, branch_move_id, return_status_id, lesson_id, student_id, open_until,
  opened_at
) on journal_optional_cells to sodiq_app;
grant update (withdrawn_at, student_id) on journal_optional_cells to sodiq_app;

-- An optional cell takes a write now: opened, not withdrawn, before its end.
create function journal_optional_open(lesson_ref uuid, student_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from journal_optional_cells o
    where o.lesson_id = lesson_ref and o.student_id = student_ref
      and o.withdrawn_at is null
      and o.opened_at <= class_tutors_moment() and class_tutors_moment() < o.open_until
  )
$$;
grant execute on function journal_optional_open(uuid, uuid) to sodiq_app;

-- 0123's guard, with the optional cells beside the cells reopened after an
-- exemption.
create or replace function journal_cells_edit_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lock_at timestamptz;
begin
  if tg_op = 'DELETE' then
    -- Only the clearing of an empty lesson and the works triggers delete a cell (0108, 0119).
    return old;
  end if;
  if tg_op = 'INSERT' and forced_restore_names('lesson', new.lesson_id) then
    return new;
  end if;
  lock_at := journal_lesson_lock(new.lesson_id);
  if new.changed_how in ('entry', 'offline_entry', 'not_held', 'undo')
    and coalesce(journal_correction_reason(), '') = ''
    and lock_at is not null and class_tutors_moment() >= lock_at
    and (exemption_reopened_open(new.lesson_id, new.student_id)
      or journal_optional_open(new.lesson_id, new.student_id)) then
    new.changed_how := case when new.changed_how = 'undo' then 'undo' else 'late_entry' end;
    return new;
  end if;
  new.changed_how := journal_edit_judge(
    new.branch_id, lock_at, new.changed_how, new.changed_by,
    journal_correction_reason(), new.lesson_id, null, null
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A member of the lesson's class or group on its date (no exemption read).

create function lesson_student_member(lesson_ref uuid, student_ref uuid) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from lessons l
    join class_memberships m on m.class_id = l.class_id and m.student_id = student_ref
    where l.id = lesson_ref
      and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
    union all
    select 1 from lessons l
    join group_memberships m on m.group_id = l.group_id and m.student_id = student_ref
    where l.id = lesson_ref
      and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
  )
$$;
grant execute on function lesson_student_member(uuid, uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- Decision 7 (Look first): the old branch's journals keep naming a former
-- member whose record moved to another branch (From 3.3c: "read past the row
-- filter, names only"). For a journal of the branch named by the request, the
-- students with a class or group row of its unit in that branch whose record
-- is of another branch: id, names and UID, nothing else.
create function journal_former_member_names(journal uuid, branch uuid)
returns table (
  id uuid, first_name text, last_name text, paternal_name text, uid text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with unit as (
    select j.class_id, j.group_id from public.journals j
    where j.id = journal_former_member_names.journal
      and j.branch_id = journal_former_member_names.branch
      and journal_former_member_names.branch = any (public.app_branch_ids())
  ),
  members as (
    select m.student_id from public.class_memberships m, unit u
    where m.class_id = u.class_id and m.branch_id = journal_former_member_names.branch
    union
    select m.student_id from public.group_memberships m, unit u
    where m.group_id = u.group_id and m.branch_id = journal_former_member_names.branch
  )
  select s.id, s.first_name, s.last_name, s.paternal_name, s.uid
  from public.students s
  join members on members.student_id = s.id
  where s.branch_id <> journal_former_member_names.branch
$$;

revoke execute on function journal_former_member_names(uuid, uuid) from public;
grant execute on function journal_former_member_names(uuid, uuid) to sodiq_app;

-- ---------------------------------------------------------------------------
-- 0120's comment trigger, taking the student's class and group rows `for
-- share` before the membership check, as the cells' trigger does: a comment
-- saved at the same moment as a move or a leaving waits for it.
create or replace function journal_comments_write() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  lesson_row lessons;
begin
  if tg_op = 'INSERT' and new.changed_how = 'restored' then
    if not forced_restore_names('lesson', new.lesson_id) then
      raise exception 'journal_comment_restore'
        using errcode = 'check_violation', constraint = 'journal_comment_restore';
    end if;
    return new;
  end if;
  moment := class_tutors_moment();
  if moment is null then
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    if new.body is not distinct from old.body and new.visibility = old.visibility then
      -- A move of the work's lesson (on update cascade), or a write that changes
      -- nothing: no version, no moment, no author and no check, so the history
      -- writes no line (code review round 1, defect 2).
      new.changed_by := old.changed_by;
      new.changed_how := old.changed_how;
      return new;
    end if;
    new.version := old.version + 1;
  end if;
  new.changed_at := moment;
  if new.body is null then
    return new;
  end if;
  if new.lesson_id is not null then
    select * into lesson_row from lessons l where l.id = new.lesson_id;
    if lesson_row.cancel_cause is not null then
      raise exception 'journal_cell_cancelled'
        using errcode = 'check_violation', constraint = 'journal_cell_cancelled';
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
  end if;
  return new;
end;
$$;
