---
paths:
  - "packages/timetable-rules/**"
  - "apps/api/src/modules/timetable/**"
  - "apps/web/src/features/timetable/**"
  - "apps/solver/**"
---

# Timetable

Before changing anything here, read `docs/spec/06-timetable.md`, `docs/spec/edge-cases/timetable.md` and `docs/spec/edge-cases/time-dates-calendar.md`.

- Every clash check uses real clock time, never slot numbers, and counts all branches.
- The rules live once in TypeScript, in `packages/timetable-rules`. The grid, the API and the check of solver output all call it. Do not copy a rule into another TypeScript place.
- The one allowed second copy is the Kotlin solver in `apps/solver`, which needs the blocked rules as its own hard constraints. Keep it in step with the rule engine, and never trust it alone.
- The database constraints in `docs/spec/edge-cases/developer-rules.md` stay in force. Application checks come on top of them, not instead.
- Publishing never changes a lesson dated today or earlier. The live timetable is never edited in place.
- The solver never publishes. Its output is a draft that the rule engine re-checks.
- An exception that relaxes a rule (a one-day change when no teacher of the subject is free) applies to the lesson it is for only, never to every lesson checked in the same call, and a test keeps another lesson of the call blocked (found by the spec review of task 5.2).
- A rule over a set of placements that must sit together (the parts of a block, a double pair) checks their times as well as their members; a test places one part in another slot (found by the spec review of task 5.2).
- A collector that removes duplicate results keys them by everything that tells two results apart (the rule, the day, the placements and the detail: a date, a load row, a teacher, a room, a slot); a test adds two results that differ only in their detail and finds both (found by the review of task 5.2).
- A task that first writes rows a spec rule is about (dated lessons for "A class cannot be archived while it has future lessons") enforces every rule an earlier task left unenforced because those rows did not exist yet (a comment such as "does not refuse future lessons"), or adds a From line quoting the row to a named task; a test never asserts the forbidden outcome as correct (found by code round 2 of the review of pull request #152: a published class was archived).
- A published version checked or written over dates it did not run on before (a withdraw that runs the earlier version again) is read as if it started on the first of those dates: its facts (busy elsewhere, availability, statuses, the class's Tutor) on the later of that day and today, never on its own start; a test makes a fact differ between the two days (found by the spec review of the code of task 5.5c-2a).
- A dated lesson is named by its pattern entry and the date of its pattern block, never by the entry and its own date alone: a one-day move applied again can put a lesson on a date where its entry has a lesson of its own, and a cancel or a needs-a-teacher mark keyed by entry and date then reaches both (`patternDateOf`, `placeKeyOf` of `dated-lessons.ts`); a test moves a lesson onto the same weekday a week later (found by the spec review of the code of task 5.6a-5a).
- A record that names a dated block or lesson by its id (a bulk cancel's choice on `bulk_cancel_blocks`) is updated when a publish decides it again on a block the pairing reuses: `pairDated` keeps a block's id when one of its lessons pairs, so "the row is there" never means "the stored choice still holds"; a test changes a part of the block and decides against the stored choice (found by the spec review of the code of task 5.6a-5b-1).
