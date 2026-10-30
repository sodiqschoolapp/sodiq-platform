-- 0148 The counts of a prepared lesson in a column of their own (task 10.1b, pull request #263).
--
-- The closing checklist reads of each held lesson of the quarter only its journal, whether it is
-- held, its lock and what keeps it from complete. Read out of `value`, every lesson's facts were
-- read whole (about 100 MB at the school's size, 0.3 s of each checklist). `summary` holds those
-- few fields (`PreparedLesson` of `apps/api/src/modules/results/prepared/units.ts`), written with
-- `value`. A column with no default: no row is rewritten, changed or removed; the rows prepared
-- before it have none and are behind by their shape (`PREPARED_SHAPE`), so they are prepared again.

alter table report_prepared_lessons add column summary jsonb;
