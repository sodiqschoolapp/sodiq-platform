-- 0157 A work added by hand is named (task 10.6, pull request #290; the owner's
-- `/spec-change` of 5 November 2026, docs/spec-changes.md).
--
-- docs/spec/07-journal.md, Entering data: "the teacher can add any number of
-- classworks and of 'homework given' by hand, each with a title the teacher
-- types when adding it (required, at most 60 characters)".
-- docs/spec/edge-cases/journal.md, "A lesson is held with no plan item":
-- "The teacher may rename it while the lesson can still be edited; each change
-- is kept in history." "When the plan item is written later, its works take
-- over these columns ... and give them their titles, which replace the titles
-- typed by hand (those stay in history)".
--
-- Plan approved on pull request #290: decisions 1 to 8.
-- - The title of a work added by hand; null for a planned work (the plan's
--   title is shown) and for a work added before this migration (shown as
--   "CW 1" / "HW 1"). The takeover clears it (decision 1); the history keeps it.
-- - A new row added by hand needs a title (decision 2), refused by the insert
--   trigger below; existing rows are left as they are.
-- - A rename is an update of `title` with `changed_how = 'entry'` (decision 4):
--   the edit guard (0130) and the closed and reopened quarter guard (0135)
--   judge it as every other write of a work.
--
-- Nothing here changes or removes an existing row.

alter table journal_works add column title text;

-- Every existing row is null and meets it; validated apart, without a rewrite.
alter table journal_works
  add constraint journal_works_title_check check (
    title is null or (
      char_length(title) between 1 and 60 and title = btrim(title, E' \t\r\n')
    )
  ) not valid;
alter table journal_works validate constraint journal_works_title_check;

grant insert (title), update (title) on journal_works to sodiq_app;

-- ---------------------------------------------------------------------------
-- A work added by hand by the application is named. A forced-delete restore
-- brings back what it stored (a work added before 0157 has no title).

create function journal_works_title_required() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if session_user = 'sodiq_app'
    and new.plan_work_id is null
    and new.title is null
    and not forced_restore_names('lesson', new.lesson_id) then
    raise exception 'journal_work_title_required'
      using errcode = 'check_violation', constraint = 'journal_work_title_required';
  end if;
  return new;
end;
$$;

create trigger journal_works_title_required
  before insert on journal_works
  for each row execute function journal_works_title_required();

-- ---------------------------------------------------------------------------
-- The history keeps the titles: both on every line of a change, the title
-- brought back on a restore line, the title removed on a delete line. A
-- change of the title alone writes a line. The body of 0130 otherwise as it was.

alter table journal_work_history
  add column title_before text,
  add column title_after text;

create or replace function journal_works_history() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz;
  author uuid;
begin
  if tg_op = 'INSERT' then
    if new.changed_how = 'restored' or forced_restore_names('lesson', new.lesson_id) then
      insert into journal_work_history (
        branch_id, work_id, lesson_id, source_lesson_id, kind, version, total_after,
        not_held_after, carried_from_after, plan_work_after, title_after, changed_by,
        changed_how, changed_at
      ) values (
        new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
        new.total, new.not_held, new.carried_from_lesson_id, new.plan_work_id, new.title,
        new.changed_by, 'restored', coalesce(class_tutors_moment(), new.changed_at)
      );
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.total is not distinct from old.total
      and new.not_held = old.not_held
      and new.lesson_id = old.lesson_id
      and new.carried_from_lesson_id is not distinct from old.carried_from_lesson_id
      and new.plan_work_id is not distinct from old.plan_work_id
      and new.title is not distinct from old.title then
      return null;
    end if;
    insert into journal_work_history (
      branch_id, work_id, lesson_id, source_lesson_id, kind, version,
      total_before, total_after, not_held_before, not_held_after, lesson_before,
      carried_from_after, plan_work_before, plan_work_after, title_before, title_after,
      changed_by, changed_how, changed_at, reason, unlock_id, orphan_assignment_id,
      plan_request_id
    ) values (
      new.branch_id, new.id, new.lesson_id, new.source_lesson_id, new.kind, new.version,
      old.total, new.total, old.not_held, new.not_held,
      case when new.lesson_id <> old.lesson_id then old.lesson_id end,
      new.carried_from_lesson_id, old.plan_work_id, new.plan_work_id, old.title, new.title,
      new.changed_by, new.changed_how, new.changed_at,
      journal_line_reason(new.changed_how), journal_line_unlock(new.changed_how),
      journal_line_orphan(new.changed_how), journal_line_plan_request(new.changed_how)
    );
    return null;
  end if;
  moment := class_tutors_moment();
  select f.deleted_by into author from forced_deletes f
    where f.created_xact = pg_current_xact_id()
      and f.record_type = 'lesson'
      and f.record_id = old.lesson_id
    limit 1;
  if author is null and pg_trigger_depth() > 1 and old.total is null and not old.not_held then
    return null;
  end if;
  if moment is null then
    if session_user <> 'sodiq_app' then
      return null;
    end if;
    raise exception 'journal_cell_moment'
      using errcode = 'check_violation', constraint = 'journal_cell_moment';
  end if;
  insert into journal_work_history (
    branch_id, work_id, lesson_id, source_lesson_id, kind, version,
    total_before, not_held_before, plan_work_before, title_before, changed_by, changed_how,
    changed_at, reason, unlock_id, orphan_assignment_id
  ) values (
    old.branch_id, old.id, old.lesson_id, old.source_lesson_id, old.kind, old.version + 1,
    old.total, old.not_held, old.plan_work_id, old.title, coalesce(author, old.changed_by),
    case when author is null then 'deleted' else 'forced_delete' end, moment,
    case when author is null then journal_line_reason('deleted') end,
    case when author is null then journal_line_unlock('deleted') end,
    case when author is null then journal_line_orphan('deleted') end
  );
  return null;
end;
$$;
