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
