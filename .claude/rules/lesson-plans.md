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
