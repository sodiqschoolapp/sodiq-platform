import type { DayLesson } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { correctionKinds } from './correction-dialog';

// Task 9.2c (From 9.2b, Left out): edge/timetable, After publishing, a cancel of a lesson with
// attendance is "Not possible in a closed quarter"; the server refuses the correction's cancel
// and restore there (`quarter_closed`), so the day view does not offer them.
describe('the kinds of a correction', () => {
  const lesson = (fields: Partial<DayLesson>) =>
    ({ canCorrect: true, cancelCause: null, quarterClosed: false, ...fields }) as DayLesson;

  it('offers the cancel, the teacher and the room of a lesson of an open quarter', () => {
    expect(correctionKinds(lesson({}))).toEqual(['cancel', 'teacher', 'room']);
    expect(correctionKinds(lesson({ cancelCause: 'reason' }))).toEqual(['restore']);
  });

  it('offers no cancel and no restore in a closed quarter', () => {
    expect(correctionKinds(lesson({ quarterClosed: true }))).toEqual(['teacher', 'room']);
    expect(correctionKinds(lesson({ quarterClosed: true, cancelCause: 'reason' }))).toEqual([]);
  });
});
