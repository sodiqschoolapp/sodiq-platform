import { describe, expect, it } from 'vitest';
import type { DatedLesson } from './dated.js';
import {
  datedPublishResults,
  publishRefusals,
  startChoices,
  type DatedPublishInput,
} from './publish.js';
import type { RuleResult } from './rules.js';
import { weekdayOf } from './templates.js';

const year = {
  firstDate: '2026-09-02',
  lastDate: '2027-05-31',
  quarters: [
    { firstDate: '2026-09-02', lastDate: '2026-10-31' },
    { firstDate: '2026-11-09', lastDate: '2026-12-28' },
    { firstDate: '2027-01-11', lastDate: '2027-03-20' },
    { firstDate: '2027-03-30', lastDate: '2027-05-31' },
  ],
};

describe('startChoices', () => {
  // 06, How surprises are prevented, Start date: "next Monday by default and
  // tomorrow at the earliest, with the first day of each coming quarter
  // offered as a shortcut".
  it('starts tomorrow at the earliest and next Monday by default', () => {
    // 2026-10-14 is a Wednesday.
    expect(startChoices('2026-10-14', year)).toEqual({
      earliest: '2026-10-15',
      defaultStart: '2026-10-19',
      quarterStarts: ['2026-11-09', '2027-01-11', '2027-03-30'],
    });
  });

  it('takes the Monday after when today is a Monday, and Sunday gives tomorrow', () => {
    expect(startChoices('2026-10-19', year).defaultStart).toBe('2026-10-26');
    expect(startChoices('2026-10-18', year).defaultStart).toBe('2026-10-19');
  });

  it('keeps a quarter that starts tomorrow and leaves out one that starts today', () => {
    expect(startChoices('2026-11-08', year).quarterStarts).toEqual([
      '2026-11-09',
      '2027-01-11',
      '2027-03-30',
    ]);
    expect(startChoices('2026-11-09', year).quarterStarts).toEqual(['2027-01-11', '2027-03-30']);
  });

  // edge/timetable, Versions and drafts: in a planned year "a version can be
  // published there, starting on the first school day" (decision 15).
  it('defaults to the first day of a planned year', () => {
    expect(startChoices('2026-08-10', year)).toEqual({
      earliest: '2026-08-11',
      defaultStart: '2026-09-02',
      quarterStarts: ['2026-09-02', '2026-11-09', '2027-01-11', '2027-03-30'],
    });
  });
});

const result = (rule: RuleResult['rule'], severity: RuleResult['severity']): RuleResult => ({
  rule,
  severity,
  day: '1',
  lessonIds: ['lesson-1'],
});

describe('publishRefusals', () => {
  // 06, Editing in the grid: "A draft with errors cannot be published."
  it('refuses a blocked result and keeps a warning a warning', () => {
    const blocked = result('teacher_double', 'blocked');
    const warning = result('room_capacity', 'warning');
    expect(publishRefusals([blocked, warning])).toEqual({
      blocked: [blocked],
      mismatched: [],
      warnings: [warning],
    });
  });

  // 06, Rules, last row: the difference from the load "blocks publishing,
  // unless the load row is marked 'deliberately short' with a reason"; the
  // engine reports no `load_mismatch` for a short row so marked.
  it('refuses a difference from the load, which the engine leaves out for a row marked short', () => {
    const mismatch: RuleResult = {
      rule: 'load_mismatch',
      severity: 'warning',
      day: '',
      lessonIds: [],
      detail: { loadRowId: 'row-1', placed: 1, lessonsPerWeek: 2 },
    };
    expect(publishRefusals([mismatch])).toEqual({
      blocked: [],
      mismatched: [mismatch],
      warnings: [],
    });
  });
});

describe('datedPublishResults (task 5.5a-2a)', () => {
  const lessonOf = (
    entryId: string,
    date: string,
    extra: Partial<DatedLesson> = {},
  ): DatedLesson => ({
    entryId,
    date,
    tutorFollowed: false,
    followsWeekday: weekdayOf(date),
    placement: {
      id: `${entryId}@${date}`,
      kind: 'lesson',
      branchId: 'a',
      day: date,
      start: 480,
      end: 525,
      blockId: `b-${entryId}@${date}`,
      doublePairId: null,
      classId: '7a',
      groupId: null,
      classIds: ['7a'],
      studentIds: [],
      exemptStudentIds: [],
      subjectId: 'math',
      loadRowId: 'row',
      teacherIds: ['t1'],
      substitute: false,
      roomId: null,
      examRooms: [],
      fixed: false,
    },
    ...extra,
  });
  const result = (
    rule: RuleResult['rule'],
    day: string,
    lessonIds: string[],
    detail?: Record<string, string | number>,
  ): RuleResult => ({
    rule,
    severity: rule === 'teacher_unavailable_later' ? 'warning' : 'blocked',
    day,
    lessonIds,
    ...(detail === undefined ? {} : { detail }),
  });
  const FIXED: Record<string, string> = {
    'pattern-b': 'branch-b',
    'claim-b': 'branch-b',
    'claim-c': 'branch-c',
  };
  const base = (extra: Partial<DatedPublishInput>): DatedPublishInput => ({
    patternBlocked: [],
    dated: [],
    lessons: new Map(),
    tutorNeeds: [],
    fixedBranch: (id) => FIXED[id] ?? null,
    outOnStart: () => false,
    ...extra,
  });

  it('leaves out a date that repeats a pattern refusal, and keeps one against another branch', () => {
    const e1 = lessonOf('e1', '2026-11-16');
    const e1Later = lessonOf('e1', '2026-12-07');
    const found = datedPublishResults(
      base({
        // The pattern refuses e1 against branch B.
        patternBlocked: [result('teacher_double', '1', ['e1', 'pattern-b'])],
        dated: [
          result('teacher_double', '2026-11-16', ['e1@2026-11-16', 'claim-b']),
          // A date shows e1 against branch C (review correction 1).
          result('teacher_double', '2026-12-07', ['e1@2026-12-07', 'claim-c']),
        ],
        lessons: new Map([
          [e1.placement.id, e1],
          [e1Later.placement.id, e1Later],
        ]),
      }),
    );
    expect(found.blocked.map((one) => one.day)).toEqual(['2026-12-07']);
  });

  it('keeps two dated results that differ only in their detail (.claude/rules/timetable.md)', () => {
    const e1 = lessonOf('e1', '2026-11-16');
    const found = datedPublishResults(
      base({
        patternBlocked: [result('split_apart', '1', ['e1'], { slots: 2 })],
        dated: [result('split_apart', '2026-11-16', ['e1@2026-11-16'], { students: 3 })],
        lessons: new Map([[e1.placement.id, e1]]),
      }),
    );
    expect(found.blocked).toHaveLength(1);
    // The same detail on a date is a repeat; the date itself is not part of the key.
    expect(
      datedPublishResults(
        base({
          patternBlocked: [result('split_apart', '1', ['e1'], { slots: 2 })],
          dated: [
            result('split_apart', '2026-11-16', ['e1@2026-11-16'], {
              slots: 2,
              date: '2026-11-16',
            }),
          ],
          lessons: new Map([[e1.placement.id, e1]]),
        }),
      ).blocked,
    ).toEqual([]);
  });

  it('keeps the Tutor lessons found "needs a teacher" before', () => {
    const found = datedPublishResults(
      base({
        tutorNeeds: [
          { date: '2026-11-30', entryId: 'tut', reason: 'no_tutor' },
          { date: '2026-11-23', entryId: 'tut', reason: 'tutor_clash' },
        ],
      }),
    );
    expect(found.needsTeacher).toEqual([
      { date: '2026-11-23', entryId: 'tut', reason: 'tutor_clash' },
      { date: '2026-11-30', entryId: 'tut', reason: 'no_tutor' },
    ]);
  });

  it('lists a worked Saturday outside the hours of the real day as needs a teacher', () => {
    // Worked by Monday's timetable.
    const saturday = lessonOf('e1', '2026-11-21', { followsWeekday: 1 });
    const monday = lessonOf('e1', '2026-11-23');
    const found = datedPublishResults(
      base({
        dated: [
          result('teacher_unavailable', '2026-11-21', ['e1@2026-11-21']),
          result('teacher_unavailable', '2026-11-23', ['e1@2026-11-23']),
        ],
        lessons: new Map([
          [saturday.placement.id, saturday],
          [monday.placement.id, monday],
        ]),
      }),
    );
    expect(found.needsTeacher).toEqual([
      { date: '2026-11-21', entryId: 'e1', reason: 'not_available_real_day' },
    ]);
    expect(found.blocked.map((one) => one.day)).toEqual(['2026-11-23']);
  });

  it('decides "the real day" per lesson: a grade that keeps its own weekday stays refused (review of #140)', () => {
    // Tuesday 17 November: grade 3 follows Friday's timetable, grade 7 keeps Tuesday.
    const followsFriday = lessonOf('e3', '2026-11-17', { followsWeekday: 5 });
    const ownTuesday = lessonOf('e7', '2026-11-17');
    const found = datedPublishResults(
      base({
        dated: [
          result('teacher_unavailable', '2026-11-17', ['e3@2026-11-17']),
          result('teacher_unavailable', '2026-11-17', ['e7@2026-11-17']),
        ],
        lessons: new Map([
          [followsFriday.placement.id, followsFriday],
          [ownTuesday.placement.id, ownTuesday],
        ]),
      }),
    );
    expect(found.needsTeacher).toEqual([
      { date: '2026-11-17', entryId: 'e3', reason: 'not_available_real_day' },
    ]);
    expect(found.blocked).toEqual([result('teacher_unavailable', '2026-11-17', ['e7@2026-11-17'])]);
  });

  it('lists a teacher out from a date after the start as needs a teacher; out on the start stays refused', () => {
    const lesson = lessonOf('e1', '2026-12-07');
    const dated = [result('teacher_inactive', '2026-12-07', ['e1@2026-12-07'])];
    const lessons = new Map([[lesson.placement.id, lesson]]);
    expect(datedPublishResults(base({ dated, lessons })).needsTeacher).toEqual([
      { date: '2026-12-07', entryId: 'e1', reason: 'teacher_out' },
    ]);
    const outBefore = datedPublishResults(base({ dated, lessons, outOnStart: () => true }));
    expect(outBefore.needsTeacher).toEqual([]);
    expect(outBefore.blocked).toHaveLength(1);
  });

  it('keeps only the later-availability warnings', () => {
    const found = datedPublishResults(
      base({
        dated: [
          result('teacher_unavailable_later', '2026-12-11', ['e1@2026-12-11'], {
            date: '2026-12-11',
          }),
          { ...result('subject_twice', '2026-12-11', ['e1@2026-12-11']), severity: 'warning' },
        ],
      }),
    );
    expect(found.warnings.map((one) => one.rule)).toEqual(['teacher_unavailable_later']);
  });
});
