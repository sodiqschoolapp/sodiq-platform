-- migrate: no transaction
-- 0145 The history lines written under an unlock (task 10.1b, pull request #263).
--
-- The counts per teacher read the entries made after the edit period (`08`, Journal discipline)
-- by the unlocks of the branch, a few rows, instead of the lessons of a quarter. Built without a
-- long lock, as 0144.

create index concurrently if not exists journal_cell_history_unlock_idx
  on journal_cell_history (unlock_id) where unlock_id is not null;
create index concurrently if not exists journal_work_history_unlock_idx
  on journal_work_history (unlock_id) where unlock_id is not null;
create index concurrently if not exists journal_comment_history_unlock_idx
  on journal_comment_history (unlock_id) where unlock_id is not null;
