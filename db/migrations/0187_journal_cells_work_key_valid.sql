-- 0187 The checks added `not valid` by 0186 (task 11.24), validated in a step
-- of their own so that 0186 scans no large table under its locks
-- (.claude/rules/database.md: a change that locks a large table in two steps).

alter table journal_cells validate constraint journal_cells_work_fkey;
alter table journal_works validate constraint journal_works_at_source;
alter table journal_work_history validate constraint journal_work_history_changed_how_check;
alter table journal_comment_history validate constraint journal_comment_history_changed_how_check;
