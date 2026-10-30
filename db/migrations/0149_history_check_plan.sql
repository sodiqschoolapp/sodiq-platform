-- 0149 The commit check of lesson history keeps its plan (task 10.1b, pull request #263).
--
-- `lesson_history_unaudited` (0105, last 0120) is a SQL function with `security definer`, so it
-- is never inlined and its statement was planned again on every call: five history tables and
-- the audit log, each over every monthly partition (40 each at the school's size), 30 to 85 ms
-- of every transaction that writes (a saved move, every cell save). The same statement in
-- PL/pgSQL is prepared once per session and its plan kept. The answer is unchanged: the body is
-- the body of 0120 word for word. No row is changed or removed.

create or replace function lesson_history_unaudited(xact xid8) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return xact is not null and (
    exists (
      select 1 from lesson_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_cell_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_work_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_rating_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
    or exists (
      select 1 from journal_comment_history h
      where h.written_xact = xact
        and not exists (
          select 1 from audit_log a where a.branch_id = h.branch_id and a.written_xact = xact
        )
    )
  );
end
$$;
