// A small school of two branches whose placements meet often, for the
// property of task 10.1 (the narrowed `checkCandidates` equals the full
// check): lessons and exams, busy-elsewhere lessons, shared rooms, blocks,
// doubles, load rows, travel, load limits, other drafts, in pattern and dated
// mode. Every teacher, room, unit, subject and load row a placement may name
// is in the facts. Invented names only.
import fc from 'fast-check';
import { dayTimes, type DaySlotInput } from '../day.js';
import type {
  CheckOptions,
  EngineDay,
  EngineLoadRow,
  EngineTeacher,
  EngineUnit,
  Facts,
  Placement,
} from '../placement.js';

const lesson = (length: number): DaySlotInput => ({ kind: 'lesson', lengthMinutes: length });
const pause = (length: number): DaySlotInput => ({ kind: 'break', lengthMinutes: length });

/** 08:00–08:45, 08:50–09:35, 09:55–10:40, 10:40–11:25, 11:30–12:15. */
const SENIOR = dayTimes(480, [
  lesson(45),
  pause(5),
  lesson(45),
  pause(20),
  lesson(45),
  lesson(45),
  pause(5),
  lesson(45),
]);
/** Grade 10 has another third lesson, so a group of grades 9 and 10 can miss a slot. */
const TENTH = dayTimes(480, [lesson(45), pause(5), lesson(45), pause(15), lesson(50)]);

const SLOTS = SENIOR.slots.filter((slot) => slot.lessonNumber !== null);

const A = 'branch-a';
const B = 'branch-b';
const C = 'branch-c';

const TEACHERS = ['t1', 't2', 't3', 't4'] as const;
const ROOMS = ['r1', 'r2', 'gym', 'small', 'repair'] as const;
const CLASSES = ['c1', 'c2', 'c3'] as const;
const STUDENTS: Record<string, string[]> = {
  c1: ['s1', 's2', 's3'],
  c2: ['s4', 's5'],
  c3: ['s6', 's7'],
};
const GROUPS: Record<string, readonly string[]> = { g1: ['c1', 'c2'], g2: ['c3'] };
const SUBJECTS = ['math', 'english', 'old'] as const;
const ROWS = ['row1', 'row2', 'row3', 'row4'] as const;
const BLOCKS = ['b1', 'b2', 'b3'] as const;
const PAIRS = ['d1', 'd2'] as const;

const week = (from: number, to: number) =>
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: from, end: to }));

function teacher(id: string, extra: Partial<EngineTeacher>): EngineTeacher {
  return {
    id,
    vacancy: false,
    out: false,
    branchIds: [A, B],
    subjects: [{ subjectId: 'math', grades: [7, 9, 10] }],
    languages: ['uz'],
    availability: [
      { branchId: A, validFrom: '2026-09-01', validUntil: null, ranges: week(480, 780) },
      { branchId: B, validFrom: '2026-09-01', validUntil: null, ranges: week(480, 780) },
    ],
    weeklyLessons: null,
    dailyLessons: null,
    ...extra,
  };
}

const unit = (id: string, kind: 'class' | 'group', grades: number[]): EngineUnit => ({
  id,
  kind,
  grades,
  language: 'uz',
  tutorOnStart: null,
});

export interface SchoolCase {
  readonly facts: Facts;
  readonly placements: readonly Placement[];
  /** The candidates, placed among `placements` (replacing those of the same ids). */
  readonly candidates: readonly Placement[];
  readonly options: CheckOptions;
}

function schoolFacts(
  mode: Facts['mode'],
  loadRows: readonly EngineLoadRow[],
  otherDrafts: readonly Placement[],
): Facts {
  const dayOf = (_branchId: string, grade: number, day: string): EngineDay => {
    if (day === '5' || day === '2026-11-13') {
      return { lessons: false, reason: 'day_off' };
    }
    return {
      lessons: true,
      day: grade === 10 ? TENTH : SENIOR,
      noRegularLessons: day === '2026-11-12',
    };
  };
  const year = {
    firstDate: '2026-09-02',
    lastDate: '2027-05-31',
    quarters: [{ firstDate: '2026-11-09', lastDate: '2026-11-15' }],
  };
  return {
    mode,
    startDate: '2026-11-09',
    versionEnd: '2026-12-27',
    teachers: new Map(
      [
        teacher('t1', { weeklyLessons: 3, dailyLessons: 2 }),
        teacher('t2', {
          // From 16 November no hours on Mondays: a later entry of a pattern.
          availability: [
            {
              branchId: A,
              validFrom: '2026-09-01',
              validUntil: '2026-11-16',
              ranges: week(480, 780),
            },
            {
              branchId: A,
              validFrom: '2026-11-16',
              validUntil: null,
              ranges: week(480, 780).filter((range) => range.weekday !== 1),
            },
            { branchId: B, validFrom: '2026-09-01', validUntil: null, ranges: week(480, 780) },
          ],
        }),
        teacher('t3', { languages: ['ru'], dailyLessons: 1 }),
        teacher('t4', { vacancy: true, branchIds: [A] }),
      ].map((one) => [one.id, one]),
    ),
    subjects: new Map(
      [
        { id: 'math', active: true, languageRule: true, tutorSubject: false },
        { id: 'english', active: true, languageRule: false, tutorSubject: false },
        { id: 'old', active: false, languageRule: false, tutorSubject: false },
      ].map((one) => [one.id, one]),
    ),
    rooms: new Map(
      [
        { id: 'r1', status: 'in_use' as const, shared: false, lessonsAtOnce: 1, capacity: 3 },
        { id: 'r2', status: 'in_use' as const, shared: false, lessonsAtOnce: 1, capacity: 30 },
        { id: 'gym', status: 'in_use' as const, shared: true, lessonsAtOnce: 2, capacity: 4 },
        { id: 'small', status: 'closed' as const, shared: true, lessonsAtOnce: 1, capacity: 2 },
        {
          id: 'repair',
          status: 'under_repair' as const,
          shared: false,
          lessonsAtOnce: 1,
          capacity: 30,
          closed: [{ day: '2026-11-10', start: 500, end: 560 }],
        },
      ].map((one) => [one.id, one]),
    ),
    units: new Map(
      [
        unit('c1', 'class', [7]),
        unit('c2', 'class', [7]),
        unit('c3', 'class', [9]),
        unit('g1', 'group', [7]),
        unit('g2', 'group', [9, 10]),
      ].map((one) => [one.id, one]),
    ),
    classStudents: (classId) => STUDENTS[classId] ?? [],
    dayOf,
    years: new Map([
      [A, year],
      [B, year],
      [C, year],
    ]),
    travelMinutes: (x, y) => (x === C || y === C ? null : 30),
    classDailyLessons: (branchId) => (branchId === A ? 3 : null),
    loadRows,
    otherDrafts,
  };
}

const days = (mode: Facts['mode']) =>
  mode === 'pattern' ? ['1', '2', '5'] : ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-16'];

const arbitraryTime = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom(...SLOTS).map((slot) => [slot.start, slot.end] as const),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.integer({ min: 470, max: 740 }), fc.integer({ min: 20, max: 100 }))
      .map(([start, length]) => [start, start + length] as const),
  },
);

const arbitraryRaw = (mode: Facts['mode']) =>
  fc.record({
    kind: fc.constantFrom<'lesson' | 'exam'>('lesson', 'lesson', 'lesson', 'lesson', 'exam'),
    branchId: fc.constantFrom(A, A, A, B, C),
    day: fc.constantFrom(...days(mode)),
    time: arbitraryTime,
    unit: fc.constantFrom<string>(...CLASSES, 'g1', 'g2'),
    examClasses: fc.subarray([...CLASSES], { minLength: 1 }),
    studentsLeft: fc.subarray(['s1', 's4', 's6']),
    exempt: fc.subarray(['s2', 's5']),
    // A student in a lesson of another class (moved between classes in the week).
    guests: fc.subarray(['s3', 's7'], { maxLength: 1 }),
    teachers: fc.subarray([...TEACHERS], { minLength: 1, maxLength: 2 }),
    room: fc.option(fc.constantFrom(...ROOMS), { nil: null, freq: 6 }),
    examRooms: fc.subarray([...ROOMS], { minLength: 1, maxLength: 2 }),
    subject: fc.constantFrom(...SUBJECTS),
    row: fc.option(fc.constantFrom(...ROWS), { nil: null, freq: 4 }),
    block: fc.option(fc.constantFrom(...BLOCKS), { nil: null, freq: 2 }),
    pair: fc.option(fc.constantFrom(...PAIRS), { nil: null, freq: 2 }),
    fixedOdds: fc.integer({ min: 0, max: 9 }),
    substitute: fc.boolean(),
    relaxed: fc.constantFrom<boolean | undefined>(undefined, undefined, false),
  });

type Raw = ReturnType<typeof arbitraryRaw> extends fc.Arbitrary<infer T> ? T : never;

function toPlacement(raw: Raw, id: string): Placement {
  const [start, end] = raw.time;
  if (raw.kind === 'exam') {
    const students = raw.examClasses.flatMap((classId) => STUDENTS[classId] ?? []);
    return {
      id,
      kind: 'exam',
      branchId: raw.branchId,
      day: raw.day,
      start,
      end,
      blockId: null,
      doublePairId: null,
      classId: null,
      groupId: null,
      classIds: raw.examClasses,
      studentIds: students,
      exemptStudentIds: [],
      subjectId: raw.subject === 'old' ? null : raw.subject,
      loadRowId: null,
      teacherIds: raw.teachers,
      substitute: false,
      roomId: null,
      examRooms: raw.examRooms.map((roomId, index) => ({ roomId, students: index + 3 })),
      fixed: raw.fixedOdds === 0,
    };
  }
  const group = GROUPS[raw.unit];
  const classIds = group === undefined ? [raw.unit] : [...group];
  const members = classIds.flatMap((classId) => STUDENTS[classId] ?? []);
  const left = new Set([...raw.studentsLeft, ...raw.exempt]);
  return {
    id,
    kind: 'lesson',
    branchId: raw.branchId,
    day: raw.day,
    start,
    end,
    blockId: raw.block ?? `own-${id}`,
    doublePairId: raw.pair,
    classId: group === undefined ? raw.unit : null,
    groupId: group === undefined ? null : raw.unit,
    classIds,
    studentIds: [
      ...members.filter((studentId) => !left.has(studentId)),
      ...raw.guests.filter((studentId) => !members.includes(studentId)),
    ],
    exemptStudentIds: members.filter((studentId) => raw.exempt.includes(studentId)),
    subjectId: raw.subject,
    loadRowId: raw.row,
    teacherIds: raw.teachers.slice(0, 1),
    substitute: raw.substitute,
    ...(raw.relaxed === undefined ? {} : { relaxed: raw.relaxed }),
    roomId: raw.room,
    examRooms: [],
    fixed: raw.fixedOdds === 0,
    ...(raw.unit === 'g2' && raw.fixedOdds === 1 ? { gradesOff: [10] } : {}),
  };
}

const arbitraryRows = fc.tuple(
  fc.array(fc.integer({ min: 0, max: 3 }), { minLength: ROWS.length, maxLength: ROWS.length }),
  fc.array(fc.boolean(), { minLength: ROWS.length, maxLength: ROWS.length }),
  fc.array(fc.boolean(), { minLength: ROWS.length, maxLength: ROWS.length }),
);

/** A school case of one mode: the placements, the candidates among them, and the options. */
export const arbitrarySchool = (mode: Facts['mode']): fc.Arbitrary<SchoolCase> =>
  fc
    .record({
      raws: fc.array(arbitraryRaw(mode), { minLength: 1, maxLength: 30 }),
      drafts: fc.array(arbitraryRaw(mode), { maxLength: 3 }),
      rows: arbitraryRows,
      picks: fc.uniqueArray(fc.nat({ max: 29 }), { minLength: 1, maxLength: 3 }),
      moved: fc.array(fc.option(arbitraryRaw(mode), { nil: null, freq: 2 }), {
        minLength: 3,
        maxLength: 3,
      }),
      noSubjectTeacherFree: fc.boolean(),
      availabilityFrom: fc.constantFrom<string | undefined>(undefined, '2026-11-09'),
    })
    .map((drawn) => {
      const [perWeek, doubles, short] = drawn.rows;
      const loadRows: EngineLoadRow[] = ROWS.map((id, index) => ({
        id,
        lessonsPerWeek: perWeek[index] ?? 1,
        deliberatelyShort: short[index] ?? false,
        doubleLessons: doubles[index] ?? true,
        ...(mode === 'pattern'
          ? index < 2
            ? { block: ['row1', 'row2'], partners: [] }
            : { block: [id], partners: index === 2 ? ['row4'] : ['row3'] }
          : {}),
      }));
      const placements = drawn.raws.map((raw, index) =>
        toPlacement(raw, `p${String(index).padStart(2, '0')}`),
      );
      const otherDrafts = drawn.drafts.map((raw, index) => ({
        ...toPlacement(raw, `o${String(index)}`),
        branchId: B,
      }));
      const picks = [...new Set(drawn.picks.map((pick) => pick % placements.length))];
      const candidates = picks.flatMap((pick, index) => {
        const own = placements[pick];
        if (own === undefined) return [];
        const moved = drawn.moved[index];
        // A candidate is a placement moved (another time, teacher, room…) or
        // the same one; a busy-elsewhere lesson is never dragged.
        const next = moved === null || moved === undefined ? own : toPlacement(moved, own.id);
        return [{ ...next, fixed: false }];
      });
      return {
        facts: schoolFacts(mode, loadRows, otherDrafts),
        placements,
        candidates,
        options: {
          ...(drawn.noSubjectTeacherFree ? { noSubjectTeacherFree: true } : {}),
          ...(drawn.availabilityFrom === undefined
            ? {}
            : { availabilityFrom: drawn.availabilityFrom }),
        },
      };
    });
