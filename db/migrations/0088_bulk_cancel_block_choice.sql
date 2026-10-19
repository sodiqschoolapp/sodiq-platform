-- 0088 The choice of a bulk cancel's block decided again by a publish (task
-- 5.6a-5b-1, pull request #165).
--
-- docs/spec/edge-cases/timetable.md, After publishing: "7 Oxford goes on an
-- excursion ... For each, the Academic Vice Principal chooses: cancel the
-- whole block, or keep it and exempt the students of the chosen classes for
-- those slots in the same action."; Versions and drafts: "One-day changes,
-- absences, room closures and exams are stored on their own and applied
-- again after a publish. ... Publish waits until every 'needs a decision'
-- item is settled."
--
-- A publish whose version changes a shared block (a part more or less) can
-- still reuse the stored block by its pairing, so the block keeps its id and
-- its `bulk_cancel_blocks` row. The block then needs a decision, and the
-- choice made in the publish must replace the stored one on that row, or a
-- later publish and 8.5 would read the old choice (spec review of the code,
-- must-fix 1). Only the choice changes; the row is never deleted, and the
-- audit entry of the publish keeps the choice before and after.

grant update (choice) on bulk_cancel_blocks to sodiq_app;
