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
- A route that writes cells another writer also writes (an undo, a bulk fill) locks them in the order `saveCells` writes them (lesson, student, work, the attendance cell first), and a same-moment test runs it against a multi-cell save with the cells sent in the opposite order (found by the spec review of the code of task 8.3a: an undo locked by cell id).
- A bulk fill of cells ("all present", "copy attendance", "not graded") skips and reports a cell typed between its read and its write, never refuses the whole action as stale (found by the spec review of the code of task 8.3a).
- In the browser, an entry the server did not take for a reason the person cannot fix in the cell (no answer, an outdated page) stays on screen "not saved" and in the unsent store; only a refusal about the value itself takes it back (found by the spec review of the code of task 8.3a).
- A writer that changes cells under locks of other rows the cell trigger also takes (an exemption takes the class rows that `journal_cells_write` takes `for share`) locks the cells first, in the order `saveCells` writes them, then the other rows: a cell save updates its cell before its trigger takes the memberships; a same-moment test runs the writer first, held at the other rows, against a re-save of a stored cell (found by the spec review of the code of task 8.5: a re-save and an exemption deadlocked).
- A writer that changes a student's class or group rows (a move, its change or cancel, a leaving and its take-back, a return, an accept, a merge) locks the student's journal entries (`lockStudentEntries` of `journal-entries.ts`) before its first write of any row, also when its journal step comes only after another step that writes rows (a change that cancels first) (found by the spec review of the code of task 8.6).
- A list of records the person confirms having seen (`journalEntries.seen`) names each record once, refused by its schema, and is matched to the list now one to one by id: a repeated id must never make the lengths agree (found by the spec review of the code of task 8.6).
- A writer of cells whose cell trigger takes another row (a work `for share`, under "not graded") takes that row first, before any cell, with the lock the other writers of those cells take it with (`writeScores` takes the work `for update` before its cells); a same-moment test against the save of numbers holds a row both lock `for update` (`row` of `inOrderOnLesson`), since both take the lesson `for share` and a hold of the lesson fixes no order (found by code round 1 of task 8.7: "not graded" and a save of numbers deadlocked).
