---
paths:
  - "apps/api/src/modules/journal/**"
  - "apps/web/src/features/journal/**"
---

# Journal

Before changing anything here, read `docs/spec/07-journal.md`, `docs/spec/edge-cases/journal.md`, `docs/spec/edge-cases/exemptions.md` and `docs/spec/edge-cases/00-definitions.md`.

- Journal columns come from dated lessons. A teacher never creates a lesson by hand.
- Typed scores and totals are whole numbers. Percentages and averages come from `packages/calc` only.
- Every cell save checks the edit period with the injected clock, the cell version, and the person's rights on the server.
- Every change to a cell writes a history entry in the same transaction.
- Nothing a teacher typed may be lost: unsent entries survive reload and are never dropped silently.
- A column or a cell worked out on read for a stored row with data (a total, "not held", a number) never resolves to nowhere: when the derivation finds no lesson for it (no check lesson left, a source removed), the row stays a column of its own lesson, and a route that moves a row decides the target with the same derivation; a test removes or cancels every lesson the row could go to (found by the spec review of the code of task 8.1: a carry onto a cancelled lesson hid a homework and its total).
- A route that acts on a stored row takes every lesson the screen shows the row at (its own, its source, the lesson the derivation shows it at), and a test sends the action through the lesson that shows it when that is not the stored one (found by code round 1 of task 8.1: a homework given by hand could not be removed from its check lesson).
