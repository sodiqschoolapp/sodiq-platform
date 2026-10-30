// A sample branch for the solver (task 5.10): invented names only. Eighteen
// classes of grades 1 to 11 on two templates, whole-class rows, English
// splits, parallel groups across two classes, a two-grade group, a mixed
// split whose physical education halves share one teacher, a row that allows
// doubles, a vacancy, a part-time teacher, a teacher busy in another branch
// with a travel time, a shared sports hall, two laboratories by room type, a
// Tutor row and a pin. Its load fits the week.
import { dayTimes, type DaySlotInput } from '../day.js';
import type { PatternFactsData, PatternRowData, PatternUnitData } from '../facts-data.js';
import type { Pin } from '../pins.js';
import type { EngineDay, EngineTeacher } from '../placement.js';
import type { Weights } from '../preferences.js';

const lesson = (length: number): DaySlotInput => ({ kind: 'lesson', lengthMinutes: length });
const pause = (length: number): DaySlotInput => ({ kind: 'break', lengthMinutes: length });

export const SOLVER_BRANCH = 'branch-north';
export const OTHER_BRANCH = 'branch-south';

// Grades 5–11: seven 45-minute lessons from 08:00 with three breaks.
export const SENIOR_DAY = dayTimes(480, [
  lesson(45),
  pause(5),
  lesson(45),
  pause(15),
  lesson(45),
  lesson(45),
  pause(20),
  lesson(45),
  lesson(45),
  pause(5),
  lesson(45),
]);
// Grades 1–4: five 40-minute lessons from 08:00; their slots meet the
// seniors' by clock time, not by number (edge/timetable, Structure).
export const JUNIOR_DAY = dayTimes(480, [
  lesson(40),
  pause(10),
  lesson(40),
  pause(10),
  lesson(40),
  pause(20),
  lesson(40),
  lesson(40),
]);

const SUBJECTS = [
  'math',
  'native',
  'english',
  'science',
  'history',
  'pe',
  'tech',
  'art',
  'tutor-hour',
] as const;

const ALL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function teacher(
  id: string,
  options: { vacancy?: boolean; weekdays?: number[]; subjects?: readonly string[] } = {},
): EngineTeacher {
  return {
    id,
    vacancy: options.vacancy ?? false,
    out: false,
    branchIds: [SOLVER_BRANCH],
    subjects: (options.subjects ?? SUBJECTS).map((subjectId) => ({
      subjectId,
      grades: ALL_GRADES,
    })),
    languages: ['uz'],
    availability: [
      {
        branchId: SOLVER_BRANCH,
        validFrom: '2026-09-01',
        validUntil: null,
        ranges: (options.weekdays ?? [1, 2, 3, 4, 5]).map((weekday) => ({
          weekday,
          start: 480,
          end: 960,
        })),
      },
    ],
    weeklyLessons: null,
    dailyLessons: null,
  };
}

const JUNIOR_CLASSES = ['1a', '2a', '3a', '4a'];
const SENIOR_CLASSES = [
  '5a',
  '5b',
  '6a',
  '6b',
  '7a',
  '7b',
  '8a',
  '8b',
  '9a',
  '9b',
  '10a',
  '10b',
  '11a',
  '11b',
];

const gradeOf = (classId: string) => Number.parseInt(classId, 10);
const studentsOf = (classId: string) => [1, 2, 3, 4].map((n) => `st-${classId}-${n}`);

export interface SolverBranch {
  readonly data: PatternFactsData;
  readonly pins: Pin[];
  readonly weights: Weights;
  readonly demandingSubjectIds: string[];
  readonly partTimeTeacherIds: string[];
}

/** The sample branch; `overloaded` gives one teacher more lessons than the week can hold. */
export function solverBranch(options: { overloaded?: boolean } = {}): SolverBranch {
  const units: PatternUnitData[] = [];
  const rows: PatternRowData[] = [];
  const classUnit = (id: string): PatternUnitData => ({
    id,
    kind: 'class',
    grades: [gradeOf(id)],
    language: 'uz',
    tutorOnStart: id === '5a' ? 't-math-1' : null,
    classIds: [id],
    studentIds: studentsOf(id),
    mainRoomId: `room-${id}`,
  });
  const group = (id: string, classIds: string[], studentIds: string[]): PatternUnitData => ({
    id,
    kind: 'group',
    grades: [...new Set(classIds.map(gradeOf))].sort((a, b) => a - b),
    language: 'uz',
    tutorOnStart: null,
    classIds,
    studentIds,
    mainRoomId: null,
  });
  const row = (id: string, extra: Partial<PatternRowData>): PatternRowData => ({
    id,
    classId: null,
    groupId: null,
    subjectId: 'math',
    teacherId: 't-math-1',
    roomId: null,
    roomType: null,
    lessonsPerWeek: 1,
    mixedBlock: false,
    doubleLessons: false,
    deliberatelyShort: false,
    block: [id],
    ...extra,
  });

  // Grades 1–4: a class teacher for mathematics and the native language.
  JUNIOR_CLASSES.forEach((classId, index) => {
    units.push(classUnit(classId));
    const own = `t-primary-${index + 1}`;
    rows.push(
      row(`math-${classId}`, { classId, teacherId: own, lessonsPerWeek: 5 }),
      row(`native-${classId}`, { classId, subjectId: 'native', teacherId: own, lessonsPerWeek: 5 }),
      row(`english-${classId}`, {
        classId,
        subjectId: 'english',
        teacherId: 't-english-j',
        lessonsPerWeek: 2,
      }),
      row(`pe-${classId}`, {
        classId,
        subjectId: 'pe',
        teacherId: 't-pe-2',
        roomId: 'hall',
        lessonsPerWeek: 2,
      }),
      row(`art-${classId}`, { classId, subjectId: 'art', teacherId: 't-art', lessonsPerWeek: 1 }),
    );
  });

  SENIOR_CLASSES.forEach((classId, index) => {
    units.push(classUnit(classId));
    const grade = gradeOf(classId);
    rows.push(
      row(`math-${classId}`, {
        classId,
        teacherId: `t-math-${(index % 4) + 1}`,
        lessonsPerWeek: options.overloaded === true && index % 4 === 0 ? 9 : 5,
        // Mathematics of 11a may be taught as a double lesson.
        doubleLessons: classId === '11a',
      }),
      row(`native-${classId}`, {
        classId,
        subjectId: 'native',
        teacherId: `t-native-${(index % 3) + 1}`,
        lessonsPerWeek: 4,
      }),
      row(`science-${classId}`, {
        classId,
        subjectId: 'science',
        teacherId: `t-science-${(index % 2) + 1}`,
        roomType: grade >= 7 ? 'laboratory' : null,
        lessonsPerWeek: 2,
      }),
      row(`history-${classId}`, {
        classId,
        subjectId: 'history',
        // A vacancy holds the history of grade 5 until a teacher is hired.
        teacherId: grade === 5 ? 'v-history' : `t-history-${(index % 2) + 1}`,
        lessonsPerWeek: 2,
      }),
    );
    if (grade <= 6) {
      rows.push(
        row(`art-${classId}`, { classId, subjectId: 'art', teacherId: 't-art', lessonsPerWeek: 1 }),
      );
    }
    // English: a split of two groups, except grade 10's parallel groups below.
    if (grade !== 10) {
      const students = studentsOf(classId);
      const first = `${classId}-en-1`;
      const second = `${classId}-en-2`;
      units.push(group(first, [classId], students.slice(0, 2)));
      units.push(group(second, [classId], students.slice(2)));
      const half =
        index < SENIOR_CLASSES.length / 2
          ? ['t-english-a', 't-english-b']
          : ['t-english-c', 't-english-d'];
      const block = [`english-${first}`, `english-${second}`].sort();
      rows.push(
        row(`english-${first}`, {
          groupId: first,
          subjectId: 'english',
          teacherId: half[0] ?? '',
          lessonsPerWeek: 3,
          block,
        }),
        row(`english-${second}`, {
          groupId: second,
          subjectId: 'english',
          teacherId: half[1] ?? '',
          lessonsPerWeek: 3,
          block,
        }),
      );
    }
    // Physical education in the shared hall, except the two-grade group of
    // 9b and 10b and the mixed split of 8a below.
    if (!['9b', '10b', '8a'].includes(classId)) {
      rows.push(
        row(`pe-${classId}`, {
          classId,
          subjectId: 'pe',
          teacherId: 't-pe-2',
          roomId: 'hall',
          lessonsPerWeek: 2,
        }),
      );
    }
  });

  // Grade 10's English: three parallel groups across 10a and 10b, one block.
  const tenth = [...studentsOf('10a'), ...studentsOf('10b')];
  const parallel = [
    { id: '10-en-1', students: tenth.slice(0, 3), teacherId: 't-english-e' },
    { id: '10-en-2', students: tenth.slice(3, 6), teacherId: 't-english-f' },
    { id: '10-en-3', students: tenth.slice(6), teacherId: 't-english-g' },
  ];
  const parallelBlock = parallel.map((one) => `english-${one.id}`).sort();
  for (const one of parallel) {
    units.push(group(one.id, ['10a', '10b'], one.students));
    rows.push(
      row(`english-${one.id}`, {
        groupId: one.id,
        subjectId: 'english',
        teacherId: one.teacherId,
        lessonsPerWeek: 3,
        block: parallelBlock,
      }),
    );
  }

  // Physical education of 9b and 10b together: a group of two grades.
  units.push(group('pe-9b-10b', ['9b', '10b'], [...studentsOf('9b'), ...studentsOf('10b')]));
  rows.push(
    row('pe-9b-10b', {
      groupId: 'pe-9b-10b',
      subjectId: 'pe',
      teacherId: 't-pe-2',
      roomId: 'hall',
      lessonsPerWeek: 2,
    }),
  );

  // 8a's mixed split: boys and girls have physical education with one
  // teacher, so the halves can only be paired with technology.
  const boys = studentsOf('8a').slice(0, 2);
  const girls = studentsOf('8a').slice(2);
  units.push(group('8a-boys', ['8a'], boys), group('8a-girls', ['8a'], girls));
  const peBlock = ['pe-8a-boys', 'pe-8a-girls'];
  const techBlock = ['tech-8a-boys', 'tech-8a-girls'];
  rows.push(
    row('pe-8a-boys', {
      groupId: '8a-boys',
      subjectId: 'pe',
      teacherId: 't-pe-1',
      roomId: 'hall',
      lessonsPerWeek: 2,
      mixedBlock: true,
      block: peBlock,
    }),
    row('pe-8a-girls', {
      groupId: '8a-girls',
      subjectId: 'pe',
      teacherId: 't-pe-1',
      roomId: 'hall',
      lessonsPerWeek: 2,
      mixedBlock: true,
      block: peBlock,
    }),
    row('tech-8a-boys', {
      groupId: '8a-boys',
      subjectId: 'tech',
      teacherId: 't-tech',
      roomId: 'workshop',
      lessonsPerWeek: 2,
      mixedBlock: true,
      block: techBlock,
    }),
    row('tech-8a-girls', {
      groupId: '8a-girls',
      subjectId: 'tech',
      teacherId: 't-tech-2',
      roomId: 'workshop-2',
      lessonsPerWeek: 2,
      mixedBlock: true,
      block: techBlock,
    }),
  );

  // The Tutor hour of 5a, taught by its Tutor.
  rows.push(
    row('tutor-5a', {
      classId: '5a',
      subjectId: 'tutor-hour',
      teacherId: 't-math-1',
      lessonsPerWeek: 1,
    }),
  );

  const teacherIds = [...new Set(rows.map((one) => one.teacherId))].sort();
  const teachers = teacherIds.map((id) =>
    id === 'v-history'
      ? teacher(id, { vacancy: true })
      : id === 't-art'
        ? teacher(id, { weekdays: [1, 2, 3] })
        : teacher(id),
  );

  const classroom = (id: string) => ({
    id,
    type: 'classroom',
    status: 'in_use' as const,
    shared: false,
    lessonsAtOnce: 1,
    capacity: 30,
  });
  const rooms = [
    ...[...JUNIOR_CLASSES, ...SENIOR_CLASSES].map((classId) => classroom(`room-${classId}`)),
    { ...classroom('lab-1'), type: 'laboratory' },
    { ...classroom('lab-2'), type: 'laboratory' },
    { ...classroom('workshop'), type: 'workshop' },
    { ...classroom('workshop-2'), type: 'workshop' },
    { ...classroom('hall'), type: 'sports hall', shared: true, lessonsAtOnce: 2, capacity: 60 },
  ];

  const weekDay = (grade: number, weekday: number): EngineDay =>
    weekday > 5
      ? { lessons: false, reason: 'not_working_day' }
      : { lessons: true, day: grade <= 4 ? JUNIOR_DAY : SENIOR_DAY, noRegularLessons: false };

  const classes = [...JUNIOR_CLASSES, ...SENIOR_CLASSES];
  const data: PatternFactsData = {
    branchId: SOLVER_BRANCH,
    startDate: '2026-11-09',
    versionEnd: '2026-12-27',
    teachers,
    subjects: SUBJECTS.map((id) => ({
      id,
      active: true,
      languageRule: true,
      tutorSubject: id === 'tutor-hour',
    })),
    rooms,
    units,
    classStudents: classes.map((classId) => ({ classId, studentIds: studentsOf(classId) })),
    days: ALL_GRADES.flatMap((grade) =>
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ grade, weekday, day: weekDay(grade, weekday) })),
    ),
    year: {
      firstDate: '2026-09-02',
      lastDate: '2027-05-25',
      quarters: [{ firstDate: '2026-11-09', lastDate: '2026-12-27' }],
    },
    travel: [{ branchA: SOLVER_BRANCH, branchB: OTHER_BRANCH, minutes: 30 }],
    classDailyLessons: null,
    rows,
    // t-math-2 teaches in the other branch on Tuesday morning.
    busyElsewhere: [
      {
        id: 'elsewhere-1',
        teacherId: 't-math-2',
        branchId: OTHER_BRANCH,
        weekday: 2,
        start: 480,
        end: 570,
        tutorLesson: false,
      },
    ],
    otherDrafts: [],
    branches: [{ id: OTHER_BRANCH, name: 'South' }],
  };

  return {
    data,
    // The native language of 5a is pinned to the first slot on Monday.
    pins: [{ id: 'pin-1', loadRowId: 'native-5a', weekday: 1, slotPosition: 1 }],
    weights: {
      class_no_gaps: 5,
      teacher_few_gaps: 5,
      subject_spread: 5,
      demanding_early: 5,
      class_even_days: 5,
      main_room: 5,
      part_time_few_days: 5,
      teacher_preferred_times: 5,
    },
    demandingSubjectIds: ['math'],
    partTimeTeacherIds: ['t-art'],
  };
}
