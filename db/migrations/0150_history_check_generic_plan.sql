-- 0150 The commit check of lesson history uses its generic plan from the first call (task 10.1b,
-- pull request #263).
--
-- After 0149 the plan of `lesson_history_unaudited` is kept, but PostgreSQL plans the first five
-- calls of each connection for their own transaction id before it keeps the generic plan: 20 to
-- 85 ms each, which the slowest of a read's repeats still met. The plan does not depend on the
-- transaction id (an index lookup on `written_xact` in every partition), so the generic plan is
-- used from the first call. The function's answer is unchanged. No row is changed or removed.

alter function lesson_history_unaudited(xid8) set plan_cache_mode = force_generic_plan;
