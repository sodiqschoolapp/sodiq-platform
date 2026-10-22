import { describe, expect, it } from 'vitest';
import { lessonCorrectionBodySchema } from './day-changes.js';

const TEACHER = '0190a3c4-0000-7000-8000-000000000004';
const ROOM = '0190a3c4-0000-7000-8000-000000000005';

// Task 5.6a-4: `06`, How surprises are prevented: "A past lesson can only be
// corrected one at a time by the Academic Vice Principal, with a reason".
describe('the correction of a past lesson', () => {
  const parse = (body: unknown) => lessonCorrectionBodySchema.safeParse(body);

  it('takes each kind with its reason, trimmed', () => {
    expect(parse({ kind: 'cancel', reason: ' Did not take place ' }).data).toEqual({
      kind: 'cancel',
      reason: 'Did not take place',
    });
    expect(parse({ kind: 'restore', reason: 'Took place' }).success).toBe(true);
    expect(parse({ kind: 'restore', roomId: ROOM, reason: 'Took place' }).success).toBe(true);
    expect(parse({ kind: 'teacher', teacherId: TEACHER, reason: 'Taught it' }).success).toBe(true);
    expect(
      parse({ kind: 'teacher', teacherId: TEACHER, reason: 'Taught it', confirm: true }).success,
    ).toBe(true);
    expect(parse({ kind: 'room', roomId: ROOM, reason: 'Held there' }).success).toBe(true);
  });

  it('refuses a correction without a reason, or with spaces only', () => {
    expect(parse({ kind: 'cancel' }).success).toBe(false);
    expect(parse({ kind: 'cancel', reason: '   ' }).success).toBe(false);
    expect(parse({ kind: 'room', roomId: ROOM, reason: '' }).success).toBe(false);
  });

  it('takes a teacher only for the teacher kind and always there, a room for a room', () => {
    expect(parse({ kind: 'teacher', reason: 'Taught it' }).success).toBe(false);
    expect(parse({ kind: 'cancel', teacherId: TEACHER, reason: 'x' }).success).toBe(false);
    expect(parse({ kind: 'room', reason: 'Held there' }).success).toBe(false);
    expect(parse({ kind: 'teacher', teacherId: TEACHER, roomId: ROOM, reason: 'x' }).success).toBe(
      false,
    );
  });

  it('refuses an unknown kind', () => {
    expect(parse({ kind: 'move', reason: 'x' }).success).toBe(false);
  });

  // Task 6.1b-2 (decision 2, Look first): a cancel takes the tick under the
  // list of what a lesson with data holds (`cancel_holds_data`); before, a
  // cancel had no warnings and refused it.
  it('takes a tick on a cancel, the tick under what a lesson with data holds', () => {
    expect(parse({ kind: 'cancel', reason: 'x', confirm: true }).data).toEqual({
      kind: 'cancel',
      reason: 'x',
      confirm: true,
    });
    expect(parse({ kind: 'cancel', reason: 'x', confirm: 'yes' }).success).toBe(false);
  });
});
