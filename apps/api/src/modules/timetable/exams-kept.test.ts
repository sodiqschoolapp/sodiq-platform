import type { DayDecisions, ExamItemAnswer } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import type { StandingExam } from './calendar-exams.js';
import { examKeyPartOf, examRefusalsOf, type KeptExam } from './exams-kept.js';
import { refusingPublish } from './publish.service.js';

// All names are invented. Task 5.6c-3a, pull request #183: the choices of a
// standing exam kept after a publish (decisions 2 to 6 and plan review
// correction 1; edge/timetable, Exams).

const EXAM = '01a15a00-0000-7000-8000-000000000001';
const BLOCK = '01a15a00-0000-7000-8000-000000000002';
const DATE = '2026-10-19';

const exam: StandingExam = {
  id: EXAM,
  title: 'Quarter exam in maths',
  date: DATE,
  startsAt: new Date('2026-10-19T03:00:00Z'),
  endsAt: new Date('2026-10-19T03:45:00Z'),
  firstSlot: 1,
  lastSlot: 1,
  classIds: [],
  groups: new Map(),
  grades: [7],
  classUnits: [],
  roomIds: [],
  invigilatorIds: [],
  outs: [],
};

const blocked: ExamItemAnswer['blocked'][number] = {
  rule: 'teacher_double',
  severity: 'blocked',
  weekday: 1,
  lessonIds: ['01a15a00-0000-7000-8000-000000000003'],
  date: DATE,
};

/** A sorted exam: kept unless it has a clash, an open block, a group missed or no timetable. */
function kept(
  input: {
    blocked?: boolean;
    block?: boolean;
    groupMisses?: boolean;
    noTimetable?: boolean;
    dropBlocked?: boolean;
    keepBlocked?: boolean;
  } = {},
): KeptExam {
  const decide =
    input.blocked === true ||
    input.block === true ||
    input.groupMisses === true ||
    input.noTimetable === true;
  const lesson = { unitId: EXAM, subjectId: EXAM, start: 480, end: 525 };
  const blocks =
    input.block === true
      ? [
          {
            unitKey: BLOCK,
            answer: {
              blockId: BLOCK,
              blockDate: DATE,
              pairBlockId: null,
              start: 480,
              end: 525,
              lessons: [lesson],
              sittingClassIds: [],
              otherClassIds: [],
              choice: null,
              keepOffered: input.keepBlocked !== true,
            },
          },
        ]
      : [];
  return {
    exam,
    before: { start: 480, end: 525 },
    category: decide ? 'decide' : 'kept',
    blocks,
    carried: new Map(),
    clashKeys: input.blocked === true ? ['entry@2026-10-19@480'] : [],
    dropBlockedKeys: input.dropBlocked === true ? ['entry@2026-10-19@480'] : [],
    cancelOffered: input.blocked === true && input.groupMisses !== true,
    teacherIds: [],
    answer: {
      key: EXAM,
      category: decide ? 'decide' : 'kept',
      date: DATE,
      title: exam.title,
      start: 480,
      end: 525,
      carriedVersionId: null,
      cancelled: [],
      blocks: blocks.map((one) => one.answer),
      blocked: input.blocked === true ? [blocked] : [],
      clashes: input.blocked === true ? [lesson] : [],
      groupMisses: input.groupMisses === true,
      noTimetable: input.noTimetable === true,
      dropBlocked: input.dropBlocked === true ? [lesson] : [],
    },
  };
}

const codes = (item: KeptExam, sent: DayDecisions) =>
  examRefusalsOf([item], sent).map((one) =>
    one.blockId === undefined ? one.code : `${one.code}@block`,
  );

describe('the choices of a standing exam after a publish', () => {
  it('waits for a choice of a clash and of each open block (edge/timetable, Versions and drafts: "Publish waits until every needs a decision item is settled")', () => {
    expect(codes(kept({ blocked: true, block: true }), [])).toEqual([
      'day_change_undecided',
      'day_change_undecided@block',
    ]);
    expect(codes(kept({ block: true }), [])).toEqual(['day_change_undecided@block']);
    expect(codes(kept(), [])).toEqual([]);
  });

  it('settles a clash by "cancel" only with a typed reason, and never by "keep" (decision 2)', () => {
    const item = kept({ blocked: true });
    expect(codes(item, [{ key: EXAM, choice: 'cancel', reason: 'Sits elsewhere' }])).toEqual([]);
    expect(codes(item, [{ key: EXAM, choice: 'cancel' }])).toEqual(['day_choice_not_offered']);
    expect(codes(item, [{ key: EXAM, choice: 'keep' }])).toEqual(['day_choice_not_offered']);
  });

  it('offers only "drop" for a group whose lesson moved and for a date left with no timetable (decisions 4 and 6)', () => {
    for (const item of [kept({ groupMisses: true }), kept({ noTimetable: true })]) {
      expect(codes(item, [])).toEqual(['day_change_undecided']);
      expect(codes(item, [{ key: EXAM, choice: 'drop' }])).toEqual([]);
      expect(codes(item, [{ key: EXAM, choice: 'cancel', reason: 'No' }])).toEqual([
        'day_choice_not_offered',
      ]);
    }
    // A group missed beside a clash: "cancel" does not settle it either.
    expect(
      codes(kept({ blocked: true, groupMisses: true }), [
        { key: EXAM, choice: 'cancel', reason: 'No' },
      ]),
    ).toEqual(['day_choice_not_offered']);
  });

  it('settles every block with "drop" and refuses a block choice beside it (several conditions on one exam)', () => {
    const item = kept({ blocked: true, block: true });
    expect(codes(item, [{ key: EXAM, choice: 'drop' }])).toEqual([]);
    expect(
      codes(item, [
        { key: EXAM, choice: 'drop' },
        { key: EXAM, blockId: BLOCK, blockDate: DATE, choice: 'keep' },
      ]),
    ).toEqual(['day_choice_not_offered@block']);
    // "Cancel" with a reason still needs the block's own choice.
    expect(codes(item, [{ key: EXAM, choice: 'cancel', reason: 'Sits elsewhere' }])).toEqual([
      'day_change_undecided@block',
    ]);
    expect(
      codes(item, [
        { key: EXAM, choice: 'cancel', reason: 'Sits elsewhere' },
        { key: EXAM, blockId: BLOCK, blockDate: DATE, choice: 'keep' },
      ]),
    ).toEqual([]);
    // A block choice of "drop" is not offered.
    expect(
      codes(kept({ block: true }), [
        { key: EXAM, blockId: BLOCK, blockDate: DATE, choice: 'drop' },
      ]),
    ).toEqual(['day_choice_not_offered@block']);
  });

  it('refuses "keep" on a block whose lessons, kept for the other classes, would meet the exam (spec review of the code, must-fix 4)', () => {
    const at = { key: EXAM, blockId: BLOCK, blockDate: DATE };
    expect(codes(kept({ block: true, keepBlocked: true }), [{ ...at, choice: 'keep' }])).toEqual([
      'day_choice_not_offered@block',
    ]);
    expect(codes(kept({ block: true, keepBlocked: true }), [{ ...at, choice: 'cancel' }])).toEqual(
      [],
    );
    expect(codes(kept({ block: true }), [{ ...at, choice: 'keep' }])).toEqual([]);
  });

  it('needs a reason for a "drop" exactly when it leaves lessons cancelled (plan review correction 1)', () => {
    const blocking = kept({ blocked: true, dropBlocked: true });
    expect(codes(blocking, [{ key: EXAM, choice: 'drop' }])).toEqual(['day_choice_not_offered']);
    expect(codes(blocking, [{ key: EXAM, choice: 'drop', reason: 'Room taken' }])).toEqual([]);
    const free = kept({ blocked: true });
    expect(codes(free, [{ key: EXAM, choice: 'drop', reason: 'Room taken' }])).toEqual([
      'day_choice_not_offered',
    ]);
  });

  it('names no item for a choice of a kept exam or of a block that is not open', () => {
    expect(codes(kept(), [{ key: EXAM, choice: 'drop' }])).toEqual(['day_decision_unknown']);
    expect(
      codes(kept({ blocked: true }), [
        { key: EXAM, choice: 'drop' },
        { key: EXAM, blockId: EXAM, blockDate: DATE, choice: 'cancel' },
      ]),
    ).toEqual(['day_decision_unknown@block']);
  });

  it('keys everything the preview shows of the exams, so a changed exam changes the key (decision 11)', () => {
    expect(examKeyPartOf([])).toBeNull();
    const one = kept({ blocked: true });
    const other = kept({ blocked: true, dropBlocked: true });
    expect(examKeyPartOf([one])).toBe(examKeyPartOf([kept({ blocked: true })]));
    expect(examKeyPartOf([one])).not.toBe(examKeyPartOf([other]));
  });

  it('answers the guards of a standing exam that a publish or a withdraw meets at the commit as timetable_busy, never a 500 (spec review of the code, must-fix 1)', async () => {
    for (const constraint of [
      'exam_group_slots',
      'exam_incomplete',
      'lesson_block_class_out_exam',
    ]) {
      const failure = Object.assign(new Error(constraint), { code: '23514', constraint });
      await expect(refusingPublish(() => Promise.reject(failure))).rejects.toMatchObject({
        code: 'timetable_busy',
      });
    }
  });
});
