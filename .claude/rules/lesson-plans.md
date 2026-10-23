---
paths:
  - "apps/api/src/modules/plans/**"
  - "apps/web/src/features/plans/**"
---

# Lesson plans

Before changing anything here, read `docs/spec/09-lesson-plans.md` and `docs/spec/edge-cases/lesson-plans.md`.

- After the plan window, nothing opens without an approved request.
- Items stay attached to lessons in order when the timetable changes. Lessons already held keep their items.
- A shared plan joins only classes with the same language of instruction.
- Every plan write passes `PlansService.gate` after `lockPlanOf`, with the rows it touches in every journal of the plan; a new write route gets a test that it is refused outside the window and an open period (found by the spec review of the code of task 7.2: file delete and copy untested).
- A grant that opens writes for a person (a window extension, an approval) is a decision of a request: `refuseOwnRequest` applies to it, before and after the window's end (found by the permission review of the code of task 7.2).
- A column added to the place or the item of a plan (a mark) is copied wherever places or items are copied (a separation, a copy), with a test that reads it after the copy (found by the spec review of the code of task 7.2: the "edited after the lesson" mark lost on a separation).
- A mark set when a write changes the item of a held lesson ("edited after the lesson") is set by every write route that changes that item (a save, a file added or removed, an item created on the row), through `PlansService.markEditedAfterLesson`, with a route test per write (found by the code review of task 7.2: files left the mark unset).
- A write that replaces the content of plan items from another source (taking a master's changes) writes the old and the new content of every item it changes, adds or clears into its audit entry, as a save does (`09`: "old text, new text, who approved"); a route test reads both from the entry (found by the spec review of the code of task 7.3).
- A link a copy carries over (a plan's master) is kept only when the target meets every condition the direct copy is refused on (grade, language, year, quarter), with a test per condition (found by the spec review of the code of task 7.3).
