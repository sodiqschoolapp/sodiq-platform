import { describe, expect, it } from 'vitest';
import { tutorChanges } from './tutor-changes.js';
import { emptyFollow, type TutorFollow } from './tutor-lessons.js';

// Task 5.5c-3b, pull request #159: the follows of one request as one change
// per lesson (decision 4: a lesson is changed when its teacher after the
// request differs from its teacher before it; spec review must-fixes 1 and 2).
// Ids are invented.

function follow(
  moved: { lessonId: string; from: string | null; to: string }[],
  needsTeacher: { lessonId: string; from: string | null }[] = [],
): TutorFollow {
  return {
    ...emptyFollow(),
    moved,
    needsTeacher: needsTeacher.map((one) => ({ ...one, clashes: [] })),
  };
}

describe('tutorChanges', () => {
  it('gives each moved lesson its teacher before and after, in the order of the ids', () => {
    expect(
      tutorChanges([
        follow(
          [
            { lessonId: 'l2', from: 'a', to: 'b' },
            { lessonId: 'l1', from: null, to: 'b' },
          ],
          [{ lessonId: 'l3', from: 'a' }],
        ),
      ]),
    ).toEqual([
      { lessonId: 'l1', from: null, to: 'b' },
      { lessonId: 'l2', from: 'a', to: 'b' },
      { lessonId: 'l3', from: 'a', to: null },
    ]);
  });

  it('leaves out a lesson that needed a teacher and is set to need one again', () => {
    expect(tutorChanges([follow([], [{ lessonId: 'l1', from: null }])])).toEqual([]);
  });

  it('leaves out a lesson given back and taken away again in one request', () => {
    // A `left` moved to a later date: the taking back gives it to `a`, the new end takes it away.
    expect(
      tutorChanges([
        follow([{ lessonId: 'l1', from: null, to: 'a' }]),
        follow([], [{ lessonId: 'l1', from: 'a' }]),
      ]),
    ).toEqual([]);
  });

  it('keeps the first teacher before and the last after over three follows', () => {
    expect(
      tutorChanges([
        follow([{ lessonId: 'l1', from: 'a', to: 'b' }]),
        follow([], [{ lessonId: 'l1', from: 'b' }]),
        follow([{ lessonId: 'l1', from: null, to: 'c' }]),
      ]),
    ).toEqual([{ lessonId: 'l1', from: 'a', to: 'c' }]);
  });
});
