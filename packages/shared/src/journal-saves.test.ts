import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { UNDO_CELLS_MAX, undoCellsOf, undoSchema } from './journal-saves.js';

/** `count` cells of 60 students: each a mark and then numbers, at most 21 a student. */
function body(count: number, studentsCount = 60) {
  const students = Array.from({ length: studentsCount }, () => ({
    studentId: randomUUID(),
    cells: [] as { workId: string | null; version: number }[],
  }));
  for (let index = 0; index < count; index += 1) {
    const student = students[index % studentsCount];
    student?.cells.push({ workId: index < studentsCount ? null : randomUUID(), version: 1 });
  }
  return { students: students.filter((one) => one.cells.length > 0) };
}

// Task 8.3a: edge/journal, Undo: "one cell or one bulk action"; the largest
// action is an attendance save of 60 marks whose keep-or-clear clears 20
// numbers of each (spec review of the plan, must-fix 2).
describe('the undo body', () => {
  it('takes the largest action, 1260 cells, and refuses one more', () => {
    expect(UNDO_CELLS_MAX).toBe(1260);
    expect(undoSchema.safeParse(body(UNDO_CELLS_MAX)).success).toBe(true);
    expect(undoSchema.safeParse(body(UNDO_CELLS_MAX + 1)).success).toBe(false);
    expect(undoSchema.safeParse(body(61, 61)).success).toBe(false);
  });

  it('stays inside the body limit of a request (100 kB) at its largest', () => {
    expect(JSON.stringify(body(UNDO_CELLS_MAX)).length).toBeLessThan(100 * 1024);
  });

  it('refuses a cell named twice and an empty body', () => {
    const studentId = randomUUID();
    expect(
      undoSchema.safeParse({
        students: [
          { studentId, cells: [{ workId: null, version: 1 }] },
          { studentId, cells: [{ workId: null, version: 2 }] },
        ],
      }).success,
    ).toBe(false);
    expect(undoSchema.safeParse({ students: [] }).success).toBe(false);
  });

  it('lists the cells one by one with their student', () => {
    const studentId = randomUUID();
    const workId = randomUUID();
    expect(
      undoCellsOf({
        students: [
          {
            studentId,
            cells: [
              { workId: null, version: 2 },
              { workId, version: 1 },
            ],
          },
        ],
      }),
    ).toEqual([
      { studentId, workId: null, version: 2 },
      { studentId, workId, version: 1 },
    ]);
  });
});
