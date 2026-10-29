-- migrate: no transaction
-- 0144 Indexes for the reads of the speed run (task 10.1b, pull request #263).
--
-- Built without a long lock (`edge/system-behaviour`: "Database changes are made in two steps so
-- that tables are never locked for long"; plan decision 4, Look first): this file runs outside a
-- transaction, each index `concurrently`, and on a partitioned table the runner builds it on the
-- parent only and then on each partition (`apps/api/src/database/migrate.ts`).

-- The lessons of a branch on a date or a range of dates: attendance today, the lessons begun of
-- the counts per teacher.
create index concurrently if not exists lessons_branch_date_idx on lessons (branch_id, lesson_date);

-- The entries made after the edit period, of the lessons counted (the counts per teacher).
create index concurrently if not exists journal_cell_history_lesson_idx
  on journal_cell_history (lesson_id);
create index concurrently if not exists journal_comment_history_lesson_idx
  on journal_comment_history (lesson_id);

-- The journal lines of one student (the personal-data report).
create index concurrently if not exists journal_cell_history_student_idx
  on journal_cell_history (student_id, changed_at);

-- The freshness test reads only the change rows newer than a snapshot's oldest transaction.
create index concurrently if not exists report_changes_xid_idx on report_changes (branch_id, xid);
