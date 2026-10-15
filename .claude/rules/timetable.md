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
