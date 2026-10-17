// A small draft of one branch as pattern data, for the tests of task 5.4a.
// Invented names only.
import { dayTimes, type DaySlotInput } from '../day.js';
import type { PatternFactsData, PatternRowData, PatternUnitData } from '../facts-data.js';
import type { EngineDay, EngineTeacher } from '../placement.js';

const lesson = (length: number): DaySlotInput => ({ kind: 'lesson', lengthMinutes: length });
const pause = (length: number): DaySlotInput => ({ kind: 'break', lengthMinutes: length });

export const BRANCH = 'branch-a';

// Grades 5–11: 45-minute lessons from 08:00. Position 1 08:00–08:45 (L1),
// 2 a break, 3 08:50–09:35 (L2), 4 a break, 5 09:55–10:40 (L3), 6 10:40–11:25 (L4).
export const SENIOR = dayTimes(480, [
  lesson(45),
  pause(5),
  lesson(45),
  pause(20),
  lesson(45),
  lesson(45),
]);
// Grades 1–4: 40-minute lessons from 08:00: position 5 is 09:30–10:10, which
// meets position 3 of the seniors (08:50–09:35) by clock time, not by number
// (edge/timetable, Structure, first row).
export const JUNIOR = dayTimes(480, [
  lesson(40),
  pause(5),
  lesson(40),
  pause(5),
  lesson(40),
  lesson(40),
]);

const teacher = (id: string): EngineTeacher => ({
  id,
  vacancy: false,
  out: false,
  branchIds: [BRANCH],
  subjects: ['math', 'english', 'science'].map((subjectId) => ({
    subjectId,
    grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  })),
  languages: ['uz'],
  availability: [
    {
      branchId: BRANCH,
      validFrom: '2026-09-01',
      validUntil: null,
      ranges: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: 480, end: 900 })),
    },
  ],
  weeklyLessons: null,
  dailyLessons: null,
});

const unit = (
  id: string,
  kind: 'class' | 'group',
  grade: number,
  classIds: string[],
  studentIds: string[],
  mainRoomId: string | null = null,
): PatternUnitData => ({
  id,
  kind,
  grades: [grade],
  language: 'uz',
  tutorOnStart: null,
  classIds,
  studentIds,
  mainRoomId,
});

export const row = (id: string, extra: Partial<PatternRowData> = {}): PatternRowData => ({
  id,
  classId: '7a',
  groupId: null,
  subjectId: 'math',
  teacherId: 't1',
  roomId: null,
  roomType: null,
  lessonsPerWeek: 3,
  mixedBlock: false,
  doubleLessons: false,
  deliberatelyShort: false,
  block: [id],
  ...extra,
});

export const ROWS: PatternRowData[] = [
  // One teacher in 7a, 7b and the grade-2 class: the clashes by clock time.
  row('math-7a'),
  row('math-7b', { classId: '7b' }),
  row('math-2a', { classId: '2a' }),
  // The English split of 7a: two groups in one block, two teachers.
  row('eng-e1', {
    classId: null,
    groupId: '7a-e1',
    subjectId: 'english',
    teacherId: 't3',
    lessonsPerWeek: 2,
    block: ['eng-e1', 'eng-e2'],
  }),
  row('eng-e2', {
    classId: null,
    groupId: '7a-e2',
    subjectId: 'english',
    teacherId: 't4',
    lessonsPerWeek: 2,
    block: ['eng-e1', 'eng-e2'],
  }),
  // Two rows in one laboratory, two teachers.
  row('sci-7a', { subjectId: 'science', teacherId: 't5', roomId: 'lab', lessonsPerWeek: 2 }),
  row('sci-7b', {
    classId: '7b',
    subjectId: 'science',
    teacherId: 't6',
    roomId: 'lab',
    lessonsPerWeek: 2,
  }),
];

const weekDay = (grade: number, weekday: number): EngineDay =>
  weekday > 5
    ? { lessons: false, reason: 'not_working_day' }
    : { lessons: true, day: grade <= 4 ? JUNIOR : SENIOR, noRegularLessons: false };

export function patternData(rows: readonly PatternRowData[] = ROWS): PatternFactsData {
  return {
    branchId: BRANCH,
    startDate: '2026-11-09',
    versionEnd: '2026-12-27',
    teachers: ['t1', 't3', 't4', 't5', 't6'].map(teacher),
    subjects: ['math', 'english', 'science'].map((id) => ({
      id,
      active: true,
      languageRule: false,
      tutorSubject: false,
    })),
    rooms: [
      {
        id: 'r7a',
        type: 'classroom',
        status: 'in_use',
        shared: false,
        lessonsAtOnce: 1,
        capacity: 30,
      },
      {
        id: 'r7b',
        type: 'classroom',
        status: 'in_use',
        shared: false,
        lessonsAtOnce: 1,
        capacity: 30,
      },
      {
        id: 'lab',
        type: 'laboratory',
        status: 'in_use',
        shared: false,
        lessonsAtOnce: 1,
        capacity: 30,
      },
    ],
    units: [
      unit('7a', 'class', 7, ['7a'], ['s1', 's2', 's3', 's4'], 'r7a'),
      unit('7b', 'class', 7, ['7b'], ['s5', 's6'], 'r7b'),
      unit('2a', 'class', 2, ['2a'], ['j1', 'j2']),
      unit('7a-e1', 'group', 7, ['7a'], ['s1', 's2']),
      unit('7a-e2', 'group', 7, ['7a'], ['s3', 's4']),
    ],
    classStudents: [
      { classId: '7a', studentIds: ['s1', 's2', 's3', 's4'] },
      { classId: '7b', studentIds: ['s5', 's6'] },
      { classId: '2a', studentIds: ['j1', 'j2'] },
    ],
    days: [2, 7].flatMap((grade) =>
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ grade, weekday, day: weekDay(grade, weekday) })),
    ),
    year: {
      firstDate: '2026-09-02',
      lastDate: '2027-05-25',
      quarters: [{ firstDate: '2026-11-09', lastDate: '2026-12-27' }],
    },
    travel: [],
    classDailyLessons: null,
    rows,
    busyElsewhere: [],
    otherDrafts: [],
    branches: [],
  };
}
