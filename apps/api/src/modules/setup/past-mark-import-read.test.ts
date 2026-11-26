import { PAST_MARK_MAX_ROWS, type PastMarkImportRow } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { filledPastMarkTemplate } from '../../testing/past-marks-kit.js';
import {
  addPastMarkFileRepeats,
  parsePastMarkRow,
  pastMarkAmountOf,
  pastMarkDateOf,
  readPastMarkWorkbook,
  type PastMarkContext,
} from './past-mark-import-read.js';

const NORTH = '019a0000-0000-7000-8000-00000000000a';
const SOUTH = '019a0000-0000-7000-8000-00000000000b';
const STUDENT = '019a0000-0000-7000-8000-0000000000c1';
const MOVED = '019a0000-0000-7000-8000-0000000000c2';
const LOOSE = '019a0000-0000-7000-8000-0000000000c3';
const HISTORY = '019a0000-0000-7000-8000-0000000000d1';
const PE = '019a0000-0000-7000-8000-0000000000d2';
const TWIN_A = '019a0000-0000-7000-8000-0000000000d3';
const TWIN_B = '019a0000-0000-7000-8000-0000000000d4';

/**
 * The north went live on Monday 12 October 2026; its year runs from 1 September with quarter 1
 * from 2 September to 31 October; school on Monday to Friday, and Wednesday 16 September a day
 * off for grade 7 only. All names are invented.
 */
const CONTEXT: PastMarkContext = {
  branchId: NORTH,
  goLiveDate: '2026-10-12',
  year: {
    id: '019a0000-0000-7000-8000-0000000000e1',
    startDate: '2026-09-01',
    endDate: '2027-05-31',
  },
  quarters: [
    { startDate: '2026-09-02', endDate: '2026-10-31' },
    { startDate: '2026-11-09', endDate: '2026-12-28' },
  ],
  calendar: {
    workingWeekdays: [1, 2, 3, 4, 5],
    assignments: [],
    entries: [
      {
        id: '019a0000-0000-7000-8000-0000000000f1',
        kind: 'day_off',
        firstDate: '2026-09-16',
        lastDate: '2026-09-16',
        gradeFrom: 7,
        gradeTo: 7,
        dayTemplateId: null,
        followsWeekday: null,
        examWeek: null,
      },
    ],
  },
  students: new Map([
    [
      '2600101',
      {
        id: STUDENT,
        uid: '2600101',
        lastName: 'Oʻrinboyeva',
        firstName: 'Oʻgiloy',
        branchId: NORTH,
        memberships: [
          { branchId: NORTH, grade: 7, validFrom: '2026-09-02', validUntil: 'infinity' },
        ],
      },
    ],
    [
      '2600102',
      {
        // Moved to the south on 1 October: the north's lessons before are the north's.
        id: MOVED,
        uid: '2600102',
        lastName: 'Karimova',
        firstName: 'Nilufar',
        branchId: SOUTH,
        memberships: [
          { branchId: NORTH, grade: 8, validFrom: '2026-09-02', validUntil: '2026-10-01' },
          { branchId: SOUTH, grade: 8, validFrom: '2026-10-01', validUntil: 'infinity' },
        ],
      },
    ],
    [
      '2600103',
      {
        id: LOOSE,
        uid: '2600103',
        lastName: 'Toshmatova',
        firstName: 'Dilnoza',
        branchId: NORTH,
        memberships: [],
      },
    ],
  ]),
  subjects: [
    { id: HISTORY, names: ['Tarix', 'История', 'History'], attendanceOnly: false },
    {
      id: PE,
      names: ['Jismoniy tarbiya', 'Физкультура', 'Physical education'],
      attendanceOnly: true,
    },
    { id: TWIN_A, names: ['Fan A', 'Предмет', 'Twin A'], attendanceOnly: false },
    { id: TWIN_B, names: ['Fan B', 'Предмет', 'Twin B'], attendanceOnly: false },
  ],
};

const row = (cells: PastMarkImportRow['cells'], rowNumber = 3): PastMarkImportRow => ({
  rowNumber,
  cells: {
    uid: '2600101',
    lastName: 'Oʻrinboyeva',
    firstName: 'Oʻgiloy',
    date: '2026-09-07',
    subject: 'History',
    ...cells,
  },
});

const codes = (cells: PastMarkImportRow['cells']) =>
  parsePastMarkRow(row(cells), CONTEXT).problems.map((one) => `${String(one.column)}:${one.code}`);

// Task 11.26: `10`, Past marks from before go-live (The file; The rules of a row) and
// `edge/academic-year`, Past marks from before go-live, with the plan's decisions and the review's
// corrections.
describe('reading a row of past marks', () => {
  it('reads a clean row: attendance, a classwork and a homework of one lesson', () => {
    const parsed = parsePastMarkRow(
      row({
        attendance: '2',
        classworkTitle: 'Dictation',
        classworkTotal: '10',
        classworkScore: '7.5',
        homeworkTitle: 'Map of the river',
        homeworkTotal: '8.25',
        homeworkScore: '6.6',
      }),
      CONTEXT,
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.record).toEqual({
      studentId: STUDENT,
      subjectId: HISTORY,
      date: '2026-09-07',
      lesson: 1,
      mark: 2,
      works: [
        { kind: 'classwork', title: 'Dictation', titleKey: 'dictation', total: 10, score: 7.5 },
        {
          kind: 'homework',
          title: 'Map of the river',
          titleKey: 'map of the river',
          total: 8.25,
          score: 6.6,
        },
      ],
    });
  });

  it('takes the name in another spelling, the subject in any language, a dotted date and lesson 2', () => {
    const parsed = parsePastMarkRow(
      row({
        lastName: "O'rinboyeva",
        firstName: 'Ўғилой',
        subject: 'история',
        date: '07.09.2026',
        lesson: '2',
        attendance: '5',
      }),
      CONTEXT,
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.record?.lesson).toBe(2);
    expect(parsed.record?.date).toBe('2026-09-07');
  });

  it('refuses another person under the UID and an unknown UID', () => {
    expect(codes({ firstName: 'Madina', attendance: '1' })).toEqual(['lastName:name_mismatch']);
    expect(codes({ uid: '2699999', attendance: '1' })).toEqual(['uid:uid_unknown']);
  });

  it('refuses dates on or after go-live, outside the year or a quarter, and unreadable', () => {
    expect(codes({ date: '2026-10-12', attendance: '1' })).toEqual([
      'date:date_not_before_go_live',
    ]);
    expect(codes({ date: '2026-08-31', attendance: '1' })).toEqual(['date:date_outside_year']);
    expect(codes({ date: '2026-09-01', attendance: '1' })).toEqual(['date:date_outside_quarter']);
    expect(codes({ date: '31.09.2026', attendance: '1' })).toEqual(['date:date_invalid']);
    expect(
      parsePastMarkRow(row({ attendance: '1' }), { ...CONTEXT, goLiveDate: null }).problems,
    ).toEqual([{ column: 'date', code: 'no_go_live' }]);
  });

  it('refuses a weekend and a day off of the student own grade, not one of another grade', () => {
    expect(codes({ date: '2026-09-12', attendance: '1' })).toEqual(['date:date_not_school_day']);
    expect(codes({ date: '2026-09-16', attendance: '1' })).toEqual(['date:date_not_school_day']);
    // The moved student was in grade 8: the day off of grade 7 is a school day for her.
    expect(
      parsePastMarkRow(
        row({
          uid: '2600102',
          lastName: 'Karimova',
          firstName: 'Nilufar',
          date: '2026-09-16',
          attendance: '1',
        }),
        CONTEXT,
      ).problems,
    ).toEqual([]);
    // A student with no class: any grade's school day.
    expect(
      parsePastMarkRow(
        row({
          uid: '2600103',
          lastName: 'Toshmatova',
          firstName: 'Dilnoza',
          date: '2026-09-16',
          attendance: '1',
        }),
        CONTEXT,
      ).problems,
    ).toEqual([]);
  });

  it('decides the branch from the class on the date (review correction 1)', () => {
    const moved = {
      uid: '2600102',
      lastName: 'Karimova',
      firstName: 'Nilufar',
      attendance: '1',
    };
    // In the north on 7 September: the north imports it.
    expect(parsePastMarkRow(row({ ...moved, date: '2026-09-07' }), CONTEXT).problems).toEqual([]);
    // The south cannot import the north's lesson.
    expect(
      parsePastMarkRow(row({ ...moved, date: '2026-09-07' }), {
        ...CONTEXT,
        branchId: SOUTH,
      }).problems,
    ).toEqual([{ column: 'uid', code: 'student_other_branch' }]);
    // A student of the north with no class is checked against the record's branch.
    expect(
      parsePastMarkRow(
        row({ uid: '2600103', lastName: 'Toshmatova', firstName: 'Dilnoza', attendance: '1' }),
        { ...CONTEXT, branchId: SOUTH },
      ).problems,
    ).toEqual([{ column: 'uid', code: 'student_other_branch' }]);
  });

  it('refuses unknown and shared subject names, and a work on an attendance-only subject', () => {
    expect(codes({ subject: 'Astronomy', attendance: '1' })).toEqual(['subject:subject_unknown']);
    expect(codes({ subject: 'Предмет', attendance: '1' })).toEqual(['subject:subject_ambiguous']);
    expect(codes({ subject: 'Physical education', attendance: '1' })).toEqual([]);
    expect(
      codes({
        subject: 'Physical education',
        classworkTitle: 'Run',
        classworkTotal: '10',
        classworkScore: '9',
      }),
    ).toEqual(['classworkTitle:subject_attendance_only']);
  });

  it('refuses a lesson, a mark and an empty row that cannot be read', () => {
    expect(codes({ lesson: '0', attendance: '1' })).toEqual(['lesson:invalid']);
    expect(codes({ lesson: '13', attendance: '1' })).toEqual(['lesson:invalid']);
    expect(codes({ lesson: '1.5', attendance: '1' })).toEqual(['lesson:invalid']);
    expect(codes({ attendance: '6' })).toEqual(['attendance:invalid']);
    expect(codes({ attendance: 'n' })).toEqual(['attendance:invalid']);
    expect(codes({})).toEqual(['null:row_empty']);
  });

  it('keeps the three cells of a work together and the rules of a title, a total and a score', () => {
    expect(codes({ classworkTitle: 'Dictation', classworkScore: '7' })).toEqual([
      'classworkTotal:work_incomplete',
    ]);
    expect(
      codes({ homeworkTitle: 'x'.repeat(61), homeworkTotal: '10', homeworkScore: '7' }),
    ).toEqual(['homeworkTitle:title_too_long']);
    expect(
      codes({ classworkTitle: 'Dictation', classworkTotal: '10', classworkScore: '7,5' }),
    ).toEqual(['classworkScore:amount_comma']);
    expect(
      codes({ classworkTitle: 'Dictation', classworkTotal: '10', classworkScore: '7.555' }),
    ).toEqual(['classworkScore:amount_decimals']);
    expect(
      codes({ classworkTitle: 'Dictation', classworkTotal: '0', classworkScore: '0' }),
    ).toEqual(['classworkTotal:total_range']);
    expect(
      codes({ classworkTitle: 'Dictation', classworkTotal: '1000.5', classworkScore: '1' }),
    ).toEqual(['classworkTotal:total_range']);
    expect(
      codes({ classworkTitle: 'Dictation', classworkTotal: '10', classworkScore: '10.01' }),
    ).toEqual(['classworkScore:score_range']);
    expect(
      codes({ classworkTitle: 'Dictation', classworkTotal: 'ten', classworkScore: '1' }),
    ).toEqual(['classworkTotal:amount_invalid']);
    // "8." is 8, as in the journal.
    expect(
      codes({ classworkTitle: 'Dictation', classworkTotal: '10', classworkScore: '8.' }),
    ).toEqual([]);
  });

  it('marks every repeat in the file on its row, naming the other rows', () => {
    const rows = [
      row(
        { attendance: '1', classworkTitle: 'Dictation', classworkTotal: '10', classworkScore: '7' },
        3,
      ),
      row({ attendance: '0' }, 4),
      row({ classworkTitle: '  DICTATION ', classworkTotal: '5', classworkScore: '5' }, 5),
      // Lesson 2 of the day is another lesson.
      row(
        {
          lesson: '2',
          attendance: '1',
          classworkTitle: 'Dictation',
          classworkTotal: '10',
          classworkScore: '7',
        },
        6,
      ),
      // A second work of one kind in the same lesson is a further row (`10`).
      row({ classworkTitle: 'Reading', classworkTotal: '10', classworkScore: '9' }, 7),
    ].map((one) => parsePastMarkRow(one, CONTEXT));
    addPastMarkFileRepeats(rows);
    const at = (number: number) =>
      rows.find((one) => one.rowNumber === number)?.problems.map((one) => [one.code, one.rows]);
    expect(at(3)).toEqual([
      ['attendance_repeated_in_file', [4]],
      ['work_repeated_in_file', [5]],
    ]);
    expect(at(4)).toEqual([['attendance_repeated_in_file', [3]]]);
    expect(at(5)).toEqual([['work_repeated_in_file', [3]]]);
    expect(at(6)).toEqual([]);
    expect(at(7)).toEqual([]);
    expect(rows.find((one) => one.rowNumber === 3)?.record).toBeNull();
  });
});

describe('reading the file of past marks', () => {
  it('reads the system template: Excel numbers and dates as their values', async () => {
    const rows = await readPastMarkWorkbook(
      await filledPastMarkTemplate([
        {
          uid: '2600101',
          lastName: 'Oʻrinboyeva',
          firstName: 'Oʻgiloy',
          date: new Date(Date.UTC(2026, 8, 7)),
          subject: 'History',
          lesson: 2,
          attendance: 1,
          classworkTitle: 'Dictation',
          classworkTotal: 10,
          classworkScore: 7.5,
        },
        {},
        { uid: '2600101', date: '2026-09-08', classworkScore: 7.555 },
      ]),
    );
    expect(rows).toEqual([
      {
        rowNumber: 3,
        cells: {
          uid: '2600101',
          lastName: 'Oʻrinboyeva',
          firstName: 'Oʻgiloy',
          date: '2026-09-07',
          subject: 'History',
          lesson: '2',
          attendance: '1',
          classworkTitle: 'Dictation',
          classworkTotal: '10',
          classworkScore: '7.5',
        },
      },
      { rowNumber: 5, cells: { uid: '2600101', date: '2026-09-08', classworkScore: '7.555' } },
    ]);
  });

  it('refuses a file that is not the template, an empty one and one of more than 50,000 rows', async () => {
    await expect(readPastMarkWorkbook(Buffer.from('not a workbook'))).rejects.toMatchObject({
      code: 'import_not_template',
    });
    await expect(
      readPastMarkWorkbook(
        await filledPastMarkTemplate([], (sheet) => {
          sheet.getRow(1).getCell(1).value = 'name';
        }),
      ),
    ).rejects.toMatchObject({ code: 'import_not_template' });
    await expect(readPastMarkWorkbook(await filledPastMarkTemplate([]))).rejects.toMatchObject({
      code: 'import_empty',
    });
    await expect(
      readPastMarkWorkbook(
        await filledPastMarkTemplate(
          Array.from({ length: PAST_MARK_MAX_ROWS + 1 }, () => ({ uid: '2600101' })),
        ),
      ),
    ).rejects.toMatchObject({ code: 'import_too_many_rows' });
  }, 120_000);

  it('reads dates and amounts as the journal does', () => {
    expect(pastMarkDateOf('2026-09-07')).toBe('2026-09-07');
    expect(pastMarkDateOf('7.9.2026')).toBe('2026-09-07');
    expect(pastMarkDateOf('2026-02-30')).toBeUndefined();
    expect(pastMarkAmountOf('7.50')).toEqual({ value: 7.5 });
    expect(pastMarkAmountOf('8.')).toEqual({ value: 8 });
    expect(pastMarkAmountOf('-1')).toEqual({ code: 'amount_invalid' });
    expect(pastMarkAmountOf('1e2')).toEqual({ code: 'amount_invalid' });
  });
});
