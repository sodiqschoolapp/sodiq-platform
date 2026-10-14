-- 0051 The ends a move writes on a row (task 3.3a, pull request #95).
--
-- The spec review of the build, should-fix 1: the update paths that 0050 added
-- to the shrink triggers checked only that the move named is the student's.
-- A row is ended by a move only as that move ends it:
-- - `transfer`: the move is live (not cancelled nor undone) and the row ends
--   on its date, or is emptied on or after its date (a planned row after it);
-- - `undone`: the move is undone in the same transaction, before the row.
-- And the reason of a move is written only with its undo.
--
-- A trigger of its own beside the shrink triggers of 0050, for both
-- membership tables, so that no rule of those triggers changes. For every
-- user. Runs as the invoker.

create function membership_move_end_valid(
  student uuid,
  move uuid,
  ended_by text,
  valid_from date,
  valid_until date
) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from student_moves m
    where m.id = move
      and m.student_id = student
      and case ended_by
        when 'transfer' then
          m.cancelled_at is null
          and m.undone_at is null
          and (valid_until = m.effective_on
            or (valid_until = valid_from and valid_from >= m.effective_on))
        when 'undone' then m.undone_at is not null
        else false
      end
  )
$$;

create function memberships_move_end() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.ended_by in ('transfer', 'undone')
    and (new.ended_by is distinct from old.ended_by
      or new.ended_by_move_id is distinct from old.ended_by_move_id
      or new.valid_until is distinct from old.valid_until)
    and not membership_move_end_valid(
      new.student_id, new.ended_by_move_id, new.ended_by, new.valid_from, new.valid_until
    ) then
    raise exception 'memberships_move_end'
      using errcode = 'check_violation', constraint = 'memberships_move_end';
  end if;
  return new;
end;
$$;

create trigger class_memberships_move_end
  before update on class_memberships
  for each row execute function memberships_move_end();

create trigger group_memberships_move_end
  before update on group_memberships
  for each row execute function memberships_move_end();

-- The reason of a move is the reason of its undo (decision 10).
alter table student_moves add constraint student_moves_reason_undo_check check (
  reason is null or undone_at is not null
);
