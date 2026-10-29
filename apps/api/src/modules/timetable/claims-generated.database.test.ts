import { overlappingPairs, type Placement } from '@sodiq/timetable-rules';
import fc from 'fast-check';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../database/transactions.js';
import { claimsHarness, NOW } from '../../testing/claims-harness.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { heldEntry } from '../../testing/held-entry.js';
import { at, type LessonSource, type LessonUnit } from '../../testing/lessons-kit.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

// The quality plan's timetable layers (docs/spec/14-quality-plan.md,
// Timetable; task 5.12a, pull request #201, plan D) and the tests that prove
// each, by file and test or describe name:
//
// - Database rules: the exclusion constraints and triggers of 0058 and 0060,
//   `lessons.database.test.ts`, `pattern.database.test.ts`,
//   `claims-recheck.database.test.ts`, and the generated tests of this file.
// - One rule engine: `packages/timetable-rules` (`check.test.ts`), called by
//   the grid and the API (`pattern.test.ts`, `publish.test.ts`).
// - Generated tests: this file (random dated lessons, pattern entries and
//   edits, against the database) and the engine's: `check.test.ts` ("finds
//   exactly the overlapping pairs of each resource"), `pattern-place.test.ts`
//   ("random edits of a pattern": "never leave a teacher, room, class or
//   student in two places"). "Lessons with data were not lost": this file,
//   since task 6.1b-1 (the From line of 5.12a): marks saved through
//   `saveCells` and blocks deleted among the edits.
// - Scenario tests, the named cases:
//   - parallel groups: `lessons.database.test.ts` ("passes the two halves of
//     a split in one block", "refuses two groups that share a class in two
//     blocks at once"), `pattern.test.ts` ("places and moves the groups of a
//     split as one block, with no room of their own"), `publish.test.ts`
//     ("keeps a block of three groups on a republish, then splits it ...");
//   - shortened days: `publish.test.ts` (describe "the lessons kept on a
//     shortened day"), `calendar-lessons.test.ts` (describe "the shortened
//     day's choice");
//   - a holiday inside a week: `publish.test.ts` ("writes no lesson on a
//     holiday inside a week, and the whole week on either side"),
//     `calendar-lessons.test.ts` (describe "a day off");
//   - a version starting mid-week: `publish.test.ts` ("starts a version on a
//     Wednesday: no lesson on the Monday and Tuesday before it", "publishes a
//     second version from a Wednesday over stored lessons: Monday and Tuesday
//     of its week stay the earlier version");
//   - substitution: `substitutions.test.ts` (describe "the substitution of a
//     lesson"), `journal-substitutions.test.ts` (describe "the substitution
//     from an absence or a vacancy"), `substitutions-kept.test.ts` (describe
//     "the sorting of stored substitutions");
//   - cancel and restore: `day-changes.test.ts` (describe "one-day changes:
//     cancel and restore");
//   - a student in a class lesson and a group lesson: `check.test.ts`
//     ("refuses a student in two lessons at once: a class lesson against a
//     group lesson, two groups"), `lessons.database.test.ts` ("refuses a
//     class lesson and a group lesson of that class in two blocks at once"),
//     `claims-recheck.database.test.ts` (describe "a membership that puts a
//     student in two lessons of a block"), the membership routes
//     (`classes/membership-lesson-clash.test.ts`), and this file.
// - Publish preview: `publish.test.ts` (describe "the impact preview and the
//   transition week", and describe "the preview against the publish (14,
//   Publish preview)": every lesson the publish writes or leaves alone,
//   against the preview's lines).
// - Generator: task 5.11.
//
// The generated test of the dated lessons: random sequences of blocks added,
// moved, a lesson's teacher or room changed, a lesson cancelled or restored,
// a mark saved or a block deleted (task 6.1b-1),
// written as `sodiq_app` through the branch filter of both branches. After
// each operation the database's answer equals a model's (docs/spec/edge-cases/
// developer-rules.md: Teacher in one place, Room in one use, Class in one
// block), and the stored lessons equal the model's. The model compares clock
// times through `overlappingPairs` of the rule engine. Two templates of
// different slot lengths give the times, so slot numbers never line up with
// times, and two teachers work in both branches.
//
// What the generator never reaches, and how: every date is after `NOW` in the
// first quarter (`lesson_block_date`, `lesson_block_quarter`,
// `lessons_delete_past`); each block stands on a published version and a
// pattern block of its own kind (`LessonsKit.source`: `lesson_block_version`,
// `lessons_check`); a group lesson carries its group's subject
// (`lesson_group_subject`); no vacancy is closed (`lessons_vacancy_closed`); no
// exam is written (`lessons_exam_group_slots`); the shared room's capacity is
// far above every student of the fixture, so `room_shared_capacity` is never
// reached (capacity has its own tests, `lessons.database.test.ts`). Any refusal
// other than the modelled ones fails the run.

/** The constraints of the model, by the rule each stands for. */
const MODELLED = {
  time_claims_teacher_excl: 'teacher',
  time_claims_room_excl: 'room',
  room_shared_full: 'room',
  time_claims_class_excl: 'class',
  lesson_block_student_twice: 'student',
} as const;

type Rule = (typeof MODELLED)[keyof typeof MODELLED];

/** Two school days of quarter 1, after `NOW`. */
const DATES = ['2026-10-19', '2026-10-20'] as const;
const LATER_DAY = DATES[1];
/** The first day of the fixture's memberships. */
const FIRST_DAY = '2026-09-01';

/** Lesson times of two templates (minutes after midnight): 45 minutes for grades 5–11, 40 for 1–4. */
const TIMES = [
  [480, 525],
  [530, 575],
  [595, 640],
  [480, 520],
  [525, 565],
  [570, 610],
] as const;

const SHARED_MOST = 2;
const RUNS = 200;
const PATTERN_RUNS = 100;

/** The constraints of the pattern's model (developer-rules, Pattern entries: the same teacher, room and class rules per version). */
const PATTERN_MODELLED = {
  pattern_entries_teacher_excl: 'teacher',
  pattern_entries_room_excl: 'room',
  pattern_room_shared_full: 'room',
  pattern_block_classes_excl: 'class',
} as const;

type PatternOperation =
  | { op: 'add'; kind: number; weekday: number; time: number; rooms: number[] }
  | { op: 'move'; block: number; weekday: number; time: number }
  | { op: 'room'; block: number; lesson: number; room: number }
  | { op: 'remove'; block: number };

const patternOperation: fc.Arbitrary<PatternOperation> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      op: fc.constant('add' as const),
      kind: fc.nat(),
      weekday: fc.nat(),
      time: fc.nat(),
      rooms: fc.array(fc.nat(), { minLength: 2, maxLength: 2 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant('move' as const),
      block: fc.nat(),
      weekday: fc.nat(),
      time: fc.nat(),
    }),
  },
  fc.record({
    op: fc.constant('room' as const),
    block: fc.nat(),
    lesson: fc.nat(),
    room: fc.nat(),
  }),
  fc.record({ op: fc.constant('remove' as const), block: fc.nat() }),
);
const OPERATIONS = 25;

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A kind of block: its lessons' units, branch and source. */
interface Kind {
  branch: string;
  units: { classId: string | null; groupId: string | null; subjectId: string }[];
  source: LessonSource;
}

interface ModelLesson {
  id: string;
  teacherId: string | null;
  roomId: string | null;
  cancelled: boolean;
  /**
   * Task 6.1b-1: the marks saved on it through `saveCells`, by student, with
   * the version of each cell; a lesson with one holds data.
   */
  cells: Map<string, { mark: number; version: number }>;
}

interface ModelBlock {
  id: string;
  kind: number;
  date: string;
  start: number;
  end: number;
  lessons: ModelLesson[];
}

type Operation =
  | { op: 'add'; kind: number; date: number; time: number; teachers: number[]; rooms: number[] }
  | { op: 'move'; block: number; date: number; time: number }
  | { op: 'teacher'; block: number; lesson: number; teacher: number }
  | { op: 'room'; block: number; lesson: number; room: number }
  | { op: 'cancel'; block: number; lesson: number }
  | { op: 'restore'; block: number; lesson: number }
  // Task 6.1b-1 (the From line of 5.12a): a mark saved, a block deleted.
  | {
      op: 'cell';
      block: number;
      lesson: number;
      student: number;
      mark: number;
      /** A student of the fixture who is not expected in the lesson. */
      outsider: boolean;
    }
  | { op: 'delete'; block: number };

const operation: fc.Arbitrary<Operation> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      op: fc.constant('add' as const),
      kind: fc.nat(),
      date: fc.nat(),
      time: fc.nat(),
      teachers: fc.array(fc.nat(), { minLength: 2, maxLength: 2 }),
      rooms: fc.array(fc.nat(), { minLength: 2, maxLength: 2 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant('move' as const),
      block: fc.nat(),
      date: fc.nat(),
      time: fc.nat(),
    }),
  },
  fc.record({
    op: fc.constant('teacher' as const),
    block: fc.nat(),
    lesson: fc.nat(),
    teacher: fc.nat(),
  }),
  fc.record({
    op: fc.constant('room' as const),
    block: fc.nat(),
    lesson: fc.nat(),
    room: fc.nat(),
  }),
  fc.record({ op: fc.constant('cancel' as const), block: fc.nat(), lesson: fc.nat() }),
  fc.record({ op: fc.constant('restore' as const), block: fc.nat(), lesson: fc.nat() }),
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant('cell' as const),
      block: fc.nat(),
      lesson: fc.nat(),
      student: fc.nat(),
      mark: fc.integer({ min: 0, max: 3 }),
      outsider: fc.boolean(),
    }),
  },
  fc.record({ op: fc.constant('delete' as const), block: fc.nat() }),
);

const pick = <T>(list: readonly T[], index: number): T => {
  const found = list[index % list.length];
  if (found === undefined) throw new Error('Nothing to pick from.');
  return found;
};

/** The error of a refused write, or a failure when it went through. */
interface Refused {
  code?: string;
  constraint?: string;
}

/**
 * Task 6.1b-1: the answer the model expects of a cell or a delete, apart
 * from the time claims: accepted, or refused by the database's constraint or
 * the writer's code.
 */
type DataAnswer =
  | { kind: 'accepted' }
  | { kind: 'constraint'; name: 'lesson_holds_data' }
  | { kind: 'code'; name: 'lesson_cancelled_cell' | 'cell_closed' };

/** Rolls the run back at its end, so no run sees another's rows. */
class RunOver extends Error {}

describe('the time claims against a model, on random lessons and edits (14, Generated tests)', () => {
  const h = claimsHarness();
  /** Task 6.1b-1: the audit of the cells, at the harness's moment. */
  const audit = new Audit(new FixedClock(NOW));

  const fixture = {
    kinds: [] as Kind[],
    /** Teachers by branch; `null` is a lesson with nobody recorded. */
    teachers: new Map<string, (string | null)[]>(),
    rooms: new Map<string, (string | null)[]>(),
    shared: new Set<string>(),
    /** The students of each class and group, each from a date. */
    members: new Map<string, { student: string; from: string }[]>(),
    /** The classes of each group. */
    groupClasses: new Map<string, string[]>(),
    /** Task 6.1b-1: the account the cells name. */
    account: '',
  };

  async function prepare(): Promise<void> {
    if (fixture.kinds.length > 0) return;
    const north = h.state.north;
    const south = h.state.south;
    const kit = h.state.kit;
    fixture.account = await kit.load.classes.account();
    const seventhA = await h.schoolClass(north);
    const seventhB = await h.schoolClass(north);
    const seventhC = await h.schoolClass(north);
    const southern = await h.schoolClass(south);
    const pupilsA = await kit.pupils(north, seventhA, 4);
    const pupilsB = await kit.pupils(north, seventhB, 2);
    const always = (students: string[]) =>
      students.map((student) => ({ student, from: FIRST_DAY }));
    fixture.members.set(seventhA, always(pupilsA));
    fixture.members.set(seventhB, always(pupilsB));
    fixture.members.set(seventhC, always(await kit.pupils(north, seventhC, 2)));
    fixture.members.set(southern, always(await kit.pupils(south, southern, 2)));
    const [a1 = '', a2 = '', a3 = '', a4 = ''] = pupilsA;
    const [b1 = ''] = pupilsB;

    const subject = () => kit.load.classes.subject({ grades: [7] });
    const group = async (
      classes: string[],
      subjectId: string,
      members: string[],
      later: { student: string; from: string }[] = [],
    ) => {
      const id = await h.group(north, classes, subjectId);
      for (const student of members) await kit.inGroup(north, id, subjectId, student);
      for (const one of later) await kit.inGroup(north, id, subjectId, one.student, one.from);
      fixture.members.set(id, [...always(members), ...later]);
      fixture.groupClasses.set(id, classes);
      return id;
    };
    // A split of 7A in English; a mixed pair of 7A (sport and technology),
    // whose technology group a sportsman joins on the second date, so the
    // pair holds a student twice from that date only (Membership by date);
    // a chess and an art group that share a pupil; a music group of 7A and 7B.
    const english = await subject();
    const englishOne = await group([seventhA], english, [a1, a2]);
    const englishTwo = await group([seventhA], english, [a3, a4]);
    const sport = await subject();
    const technology = await subject();
    const boys = await group([seventhA], sport, [a1, a3]);
    const girls = await group([seventhA], technology, [a2, a4], [{ student: a1, from: LATER_DAY }]);
    const chess = await subject();
    const art = await subject();
    const chessClub = await group([seventhA], chess, [a1]);
    const artClub = await group([seventhA], art, [a1, a2]);
    const music = await subject();
    const choir = await group([seventhA, seventhB], music, [a3, b1]);

    const lessonSubject = h.state.subject;
    const kinds: { branch: string; units: LessonUnit[] }[] = [
      { branch: north, units: [{ classId: seventhA, groupId: null, subjectId: lessonSubject }] },
      { branch: north, units: [{ classId: seventhB, groupId: null, subjectId: lessonSubject }] },
      { branch: north, units: [{ classId: seventhC, groupId: null, subjectId: lessonSubject }] },
      {
        branch: north,
        units: [
          { classId: null, groupId: englishOne, subjectId: english },
          { classId: null, groupId: englishTwo, subjectId: english },
        ],
      },
      {
        branch: north,
        units: [
          { classId: null, groupId: boys, subjectId: sport },
          { classId: null, groupId: girls, subjectId: technology },
        ],
      },
      // Always a student twice while both lessons are held.
      {
        branch: north,
        units: [
          { classId: null, groupId: chessClub, subjectId: chess },
          { classId: null, groupId: artClub, subjectId: art },
        ],
      },
      { branch: north, units: [{ classId: null, groupId: choir, subjectId: music }] },
      // A class lesson of 7B and the choir, which holds a pupil of 7B.
      {
        branch: north,
        units: [
          { classId: seventhB, groupId: null, subjectId: lessonSubject },
          { classId: null, groupId: choir, subjectId: music },
        ],
      },
      { branch: south, units: [{ classId: southern, groupId: null, subjectId: lessonSubject }] },
    ];
    for (const kind of kinds) {
      const source = await kit.source(kind.branch, h.yearOf(kind.branch), kind.units);
      fixture.kinds.push({ branch: kind.branch, units: [...kind.units], source });
    }

    const both = [await h.teacher(north), await h.teacher(north)];
    for (const teacher of both) {
      // Teachers of both branches (06, Teachers who work in several branches).
      await h.state.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: teacher, branch_id: south, is_main: false })
        .execute();
    }
    const vacancy = await kit.load.vacancy(north);
    fixture.teachers.set(north, [null, ...both, await h.teacher(north), vacancy]);
    fixture.teachers.set(south, [null, ...both, await h.teacher(south)]);
    const hall = await kit.room(north, { most: SHARED_MOST, capacity: 1000 });
    fixture.shared.add(hall);
    // The shared room three times, so three lessons meet in it often enough.
    fixture.rooms.set(north, [
      null,
      await kit.room(north),
      await kit.room(north),
      hall,
      hall,
      hall,
    ]);
    fixture.rooms.set(south, [null, await kit.room(south)]);
  }

  const kindOf = (block: ModelBlock): Kind => pick(fixture.kinds, block.kind);

  /** The students of a held lesson: its class's or its group's. */
  const studentsOf = (unit: Kind['units'][number], date: string) =>
    (fixture.members.get(unit.classId ?? unit.groupId ?? '') ?? [])
      .filter((one) => one.from <= date)
      .map((one) => one.student);

  /** The classes a lesson occupies: its class, or its group's classes. */
  const classesOf = (unit: Kind['units'][number]) =>
    unit.classId !== null ? [unit.classId] : (fixture.groupClasses.get(unit.groupId ?? '') ?? []);

  function placementOf(
    block: ModelBlock,
    id: string,
    classIds: string[],
    extra: Partial<Placement>,
  ): Placement {
    return {
      id,
      kind: 'lesson',
      branchId: kindOf(block).branch,
      day: block.date,
      start: block.start,
      end: block.end,
      blockId: block.id,
      doublePairId: null,
      classId: null,
      groupId: null,
      classIds,
      studentIds: [],
      exemptStudentIds: [],
      subjectId: null,
      loadRowId: null,
      teacherIds: [],
      substitute: false,
      roomId: null,
      examRooms: [],
      fixed: false,
      ...extra,
    };
  }

  /** The rules the held lessons of the blocks break (developer-rules), none when they break none. */
  function broken(blocks: readonly ModelBlock[], students = true): Set<Rule> {
    const rules = new Set<Rule>();
    const lessons: Placement[] = [];
    const claims: Placement[] = [];
    for (const block of blocks) {
      const kind = kindOf(block);
      const classes = new Set<string>();
      const seen = new Set<string>();
      for (const [index, lesson] of block.lessons.entries()) {
        if (lesson.cancelled) continue;
        const unit = pick(kind.units, index);
        lessons.push(
          placementOf(block, lesson.id, [], {
            teacherIds: lesson.teacherId === null ? [] : [lesson.teacherId],
            roomId: lesson.roomId,
          }),
        );
        for (const one of classesOf(unit)) classes.add(one);
        // Student twice: inside one block only.
        for (const student of students ? studentsOf(unit, block.date) : []) {
          if (seen.has(student)) rules.add('student');
          seen.add(student);
        }
      }
      // The block's class claims: one per class of its held lessons.
      if (classes.size > 0) claims.push(placementOf(block, block.id, [...classes], {}));
    }
    if (overlappingPairs(lessons, (one) => one.teacherIds).length > 0) rules.add('teacher');
    const rooms = overlappingPairs(lessons, (one) =>
      one.roomId === null || fixture.shared.has(one.roomId) ? [] : [one.roomId],
    );
    if (rooms.length > 0) rules.add('room');
    for (const room of fixture.shared) {
      // The most at once is reached at a start.
      const inRoom = lessons.filter((one) => one.roomId === room);
      for (const one of inRoom) {
        const atOnce = inRoom.filter(
          (other) => other.day === one.day && other.start <= one.start && one.start < other.end,
        ).length;
        if (atOnce > SHARED_MOST) rules.add('room');
      }
    }
    if (overlappingPairs(claims, (one) => one.classIds).length > 0) rules.add('class');
    return rules;
  }

  async function step(
    transaction: Transaction,
    work: () => Promise<void>,
  ): Promise<Refused | undefined> {
    await sql`savepoint generated_step`.execute(transaction);
    try {
      await work();
      await sql`release savepoint generated_step`.execute(transaction);
      return undefined;
    } catch (error) {
      await sql`rollback to savepoint generated_step`.execute(transaction);
      return error as Refused;
    }
  }

  async function addBlock(transaction: Transaction, kind: Kind, block: ModelBlock): Promise<void> {
    const written = await transaction
      .insertInto('lesson_blocks')
      .values({
        branch_id: kind.branch,
        academic_year_id: h.yearOf(kind.branch),
        quarter_id: h.quarterOf(kind.branch, block.date),
        lesson_date: block.date,
        starts_at: at(block.date, clock(block.start)),
        ends_at: at(block.date, clock(block.end)),
        version_id: kind.source.versionId,
        pattern_block_id: kind.source.patternBlockId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    block.id = written.id;
    for (const [index, lesson] of block.lessons.entries()) {
      const unit = pick(kind.units, index);
      const from = pick(kind.source.lessons, index);
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: kind.branch,
          block_id: written.id,
          lesson_date: block.date,
          starts_at: at(block.date, clock(block.start)),
          ends_at: at(block.date, clock(block.end)),
          class_id: unit.classId,
          group_id: unit.groupId,
          subject_id: unit.subjectId,
          load_row_id: from.loadRowId,
          pattern_entry_id: from.patternEntryId,
          teacher_id: lesson.teacherId,
          room_id: lesson.roomId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      lesson.id = row.id;
    }
  }

  /** The stored blocks and lessons, in the model's shape. */
  async function stored(transaction: Transaction) {
    const rows = await transaction
      .selectFrom('lessons')
      .select([
        'id',
        'block_id',
        sql<string>`lesson_date::text`.as('date'),
        'starts_at',
        'ends_at',
        'teacher_id',
        'room_id',
        'cancel_cause',
      ])
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      block: row.block_id,
      date: row.date,
      start: row.starts_at.getTime(),
      end: row.ends_at.getTime(),
      teacherId: row.teacher_id,
      roomId: row.room_id,
      cancelled: row.cancel_cause !== null,
    }));
  }

  /** Task 6.1b-1: the stored cells with a mark, by lesson and student. */
  async function cellsStored(transaction: Transaction) {
    const rows = await transaction
      .selectFrom('journal_cells')
      .select(['lesson_id', 'student_id', 'mark', 'version'])
      .where('mark', 'is not', null)
      .execute();
    return rows
      .map((row) => `${row.lesson_id}|${row.student_id}|${String(row.mark)}|${String(row.version)}`)
      .sort();
  }

  function cellsExpected(blocks: readonly ModelBlock[]) {
    return blocks
      .flatMap((block) =>
        block.lessons.flatMap((lesson) =>
          [...lesson.cells].map(
            ([student, cell]) =>
              `${lesson.id}|${student}|${String(cell.mark)}|${String(cell.version)}`,
          ),
        ),
      )
      .sort();
  }

  function expected(blocks: readonly ModelBlock[]) {
    return blocks
      .flatMap((block) =>
        block.lessons.map((lesson) => ({
          id: lesson.id,
          block: block.id,
          date: block.date,
          start: at(block.date, clock(block.start)).getTime(),
          end: at(block.date, clock(block.end)).getTime(),
          teacherId: lesson.teacherId,
          roomId: lesson.roomId,
          cancelled: lesson.cancelled,
        })),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The next state of the model after one operation, and the write that makes it, or nothing to do. */
  function plan(
    blocks: readonly ModelBlock[],
    one: Operation,
  ):
    | {
        next: ModelBlock[];
        write: (transaction: Transaction) => Promise<void>;
        /** Task 6.1b-1: the answer of a cell or a delete, which the time claims do not decide. */
        data?: DataAnswer;
      }
    | undefined {
    const copy = blocks.map((block) => ({
      ...block,
      lessons: block.lessons.map((lesson) => ({ ...lesson, cells: new Map(lesson.cells) })),
    }));
    if (one.op === 'add') {
      const kindIndex = one.kind % fixture.kinds.length;
      const kind = pick(fixture.kinds, kindIndex);
      const [start, end] = pick(TIMES, one.time);
      const block: ModelBlock = {
        id: '',
        kind: kindIndex,
        date: pick(DATES, one.date),
        start,
        end,
        lessons: kind.units.map((_, index) => ({
          id: '',
          teacherId: pick(fixture.teachers.get(kind.branch) ?? [], one.teachers[index] ?? 0),
          roomId: pick(fixture.rooms.get(kind.branch) ?? [], one.rooms[index] ?? 0),
          cancelled: false,
          cells: new Map(),
        })),
      };
      copy.push(block);
      return { next: copy, write: (transaction) => addBlock(transaction, kind, block) };
    }
    if (copy.length === 0) return undefined;
    const block = pick(copy, one.block);
    const kind = kindOf(block);
    if (one.op === 'delete') {
      // Task 6.1b-1 (06, Protection): a lesson that holds data is never deleted.
      const holds = block.lessons.some((lesson) => lesson.cells.size > 0);
      return {
        next: copy.filter((other) => other !== block),
        data: holds ? { kind: 'constraint', name: 'lesson_holds_data' } : { kind: 'accepted' },
        write: async (transaction) => {
          await transaction
            .deleteFrom('lessons')
            .where(
              'id',
              'in',
              block.lessons.map((lesson) => lesson.id),
            )
            .execute();
          await transaction.deleteFrom('lesson_blocks').where('id', '=', block.id).execute();
        },
      };
    }
    if (one.op === 'move') {
      const [start, end] = pick(TIMES, one.time);
      block.date = pick(DATES, one.date);
      block.start = start;
      block.end = end;
      return {
        next: copy,
        write: async (transaction) => {
          await transaction
            .updateTable('lesson_blocks')
            .set({
              lesson_date: block.date,
              starts_at: at(block.date, clock(start)),
              ends_at: at(block.date, clock(end)),
            })
            .where('id', '=', block.id)
            .execute();
        },
      };
    }
    const lesson = pick(block.lessons, one.lesson);
    if (one.op === 'cell') {
      // Task 6.1b-1: a mark of an expected student, saved as the writer saves it.
      const unit = pick(kind.units, block.lessons.indexOf(lesson));
      const expectedHere = studentsOf(unit, block.date);
      const everyone = [
        ...new Set([...fixture.members.values()].flat().map((member) => member.student)),
      ];
      const students = one.outsider
        ? everyone.filter((student) => !expectedHere.includes(student))
        : expectedHere;
      // An outsider on a cancelled lesson meets two refusals; the model keeps to one.
      if (students.length === 0 || (one.outsider && lesson.cancelled)) return undefined;
      const student = pick(students, one.student);
      const before = lesson.cells.get(student);
      return {
        next: copy,
        data: one.outsider
          ? { kind: 'code', name: 'cell_closed' }
          : lesson.cancelled
            ? { kind: 'code', name: 'lesson_cancelled_cell' }
            : { kind: 'accepted' },
        write: async (transaction) => {
          const [saved] = await saveCells(transaction, audit, { accountId: fixture.account }, [
            {
              lessonId: lesson.id,
              studentId: student,
              workId: null,
              value: one.mark,
              version: before?.version ?? null,
            },
          ]);
          // The model takes the version the database gave.
          if (saved !== undefined) {
            lesson.cells.set(student, { mark: one.mark, version: saved.version });
          }
        },
      };
    }
    const update = (values: {
      teacher_id?: string | null;
      room_id?: string | null;
      cancel_cause?: 'reason' | null;
      cancel_reason?: string | null;
    }) => ({
      next: copy,
      write: async (transaction: Transaction) => {
        await transaction.updateTable('lessons').set(values).where('id', '=', lesson.id).execute();
      },
    });
    switch (one.op) {
      case 'teacher':
        lesson.teacherId = pick(fixture.teachers.get(kind.branch) ?? [], one.teacher);
        return update({ teacher_id: lesson.teacherId });
      case 'room':
        lesson.roomId = pick(fixture.rooms.get(kind.branch) ?? [], one.room);
        return update({ room_id: lesson.roomId });
      case 'cancel':
        if (lesson.cancelled) return undefined;
        lesson.cancelled = true;
        return update({ cancel_cause: 'reason', cancel_reason: 'Generated test' });
      case 'restore':
        if (!lesson.cancelled) return undefined;
        lesson.cancelled = false;
        return update({ cancel_cause: null, cancel_reason: null });
    }
  }

  it('refuses exactly the dated lessons that put a teacher, room, class or student in two places', async () => {
    await prepare();
    const north = h.state.north;
    const south = h.state.south;
    let accepted = 0;
    let refused = 0;
    const reached = new Set<string>();
    const dataAnswers = new Set<string>();
    await fc.assert(
      fc.asyncProperty(
        fc.array(operation, { minLength: 15, maxLength: OPERATIONS }),
        async (operations) => {
          try {
            await h.state.transactions.run([north, south], async (transaction) => {
              // Every check at its statement, so a refusal belongs to its step.
              await sql`set constraints all immediate`.execute(transaction);
              await heldEntry(transaction, north);
              await heldEntry(transaction, south);
              let blocks: ModelBlock[] = [];
              for (const one of operations) {
                const planned = plan(blocks, one);
                if (planned === undefined) continue;
                const failure = await step(transaction, () => planned.write(transaction));
                const { data } = planned;
                if (data !== undefined) {
                  // Task 6.1b-1: a cell or a delete, against the model's answer.
                  if (data.kind === 'accepted') {
                    expect(failure, `refused ${JSON.stringify(one)}`).toBeUndefined();
                    blocks = planned.next;
                    dataAnswers.add(`${one.op}:accepted`);
                  } else {
                    expect(
                      data.kind === 'constraint' ? failure?.constraint : failure?.code,
                      `accepted ${JSON.stringify(one)}`,
                    ).toBe(data.name);
                    dataAnswers.add(`${one.op}:${data.name}`);
                  }
                  expect(await stored(transaction)).toEqual(expected(blocks));
                  // Every lesson the model says holds data is stored with its cells.
                  expect(await cellsStored(transaction)).toEqual(cellsExpected(blocks));
                  continue;
                }
                const rules = broken(planned.next);
                if (failure === undefined) {
                  expect(rules, `accepted ${JSON.stringify(one)}`).toEqual(new Set());
                  blocks = planned.next;
                  accepted += 1;
                } else {
                  const rule =
                    failure.constraint !== undefined && Object.hasOwn(MODELLED, failure.constraint)
                      ? MODELLED[failure.constraint as keyof typeof MODELLED]
                      : undefined;
                  // Any other refusal is a fault of the generator or a rule the model lacks.
                  expect(
                    rule,
                    `refused ${JSON.stringify(one)}: ${String(failure.code)} ${String(failure.constraint)}`,
                  ).toBeDefined();
                  expect(rules.has(rule as Rule), `refused by ${String(failure.constraint)}`).toBe(
                    true,
                  );
                  refused += 1;
                  reached.add(failure.constraint ?? '');
                }
                expect(await stored(transaction)).toEqual(expected(blocks));
                // Task 6.1b-1: a move, a cancel, a restore, a teacher or room
                // change keeps every lesson's cells.
                expect(await cellsStored(transaction)).toEqual(cellsExpected(blocks));
              }
              throw new RunOver();
            });
          } catch (error) {
            if (!(error instanceof RunOver)) throw error;
          }
        },
      ),
      { numRuns: RUNS },
    );
    // Both answers were reached, thousands of edits were checked (decision 5),
    // and each modelled constraint refused at least once.
    expect(accepted).toBeGreaterThan(RUNS * 5);
    expect(refused).toBeGreaterThan(RUNS);
    expect(accepted + refused).toBeGreaterThan(2000);
    expect([...reached].sort()).toEqual(Object.keys(MODELLED).sort());
    // Task 6.1b-1: every answer of a cell and a delete was reached.
    expect([...dataAnswers].sort()).toEqual([
      'cell:accepted',
      'cell:cell_closed',
      'cell:lesson_cancelled_cell',
      'delete:accepted',
      'delete:lesson_holds_data',
    ]);
    // About 30 s of generated edits on its own (task 10.2b: it timed out at the default 30 s on
    // CI beside the new database tests of its part); the time of the run, not what it checks.
  }, 120_000);

  /** A draft of the north with one load row per unit, the units' teachers shared so that rows clash. */
  async function draft(): Promise<{
    versionId: string;
    rows: Map<string, { id: string; teacher: string }>;
  }> {
    const north = h.state.north;
    const kit = h.state.kit;
    const versionId = await kit.load.version(north, h.yearOf(north), { startsOn: '2026-10-26' });
    const teachers: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      teachers.push((await kit.load.teacher(north, { languages: ['uz', 'ru'] })).staffId);
    }
    const rows = new Map<string, { id: string; teacher: string }>();
    for (const kind of fixture.kinds) {
      if (kind.branch !== north) continue;
      for (const unit of kind.units) {
        const key = `${unit.classId ?? unit.groupId ?? ''}|${unit.subjectId}`;
        if (rows.has(key)) continue;
        const teacher = pick(teachers, rows.size);
        // Every grade of the subject (staff_subject_grades), as LessonsKit.source does.
        await sql`
          insert into staff_subjects (staff_id, subject_id, grades)
          select ${teacher}::uuid, s.id, s.grades from subjects s where s.id = ${unit.subjectId}::uuid
          on conflict (staff_id, subject_id) do update set grades = excluded.grades
        `.execute(h.state.database.migrator);
        const id = await kit.load.row({
          branch_id: north,
          version_id: versionId,
          class_id: unit.classId,
          group_id: unit.groupId,
          subject_id: unit.subjectId,
          teacher_id: teacher,
        });
        rows.set(key, { id, teacher });
      }
    }
    return { versionId, rows };
  }

  it('refuses exactly the pattern entries that put a teacher, room or class in two places (developer-rules, Pattern entries)', async () => {
    await prepare();
    const north = h.state.north;
    const { versionId, rows } = await draft();
    const kinds = fixture.kinds.flatMap((kind, index) => (kind.branch === north ? [index] : []));
    const rowOf = (unit: Kind['units'][number]) => {
      const found = rows.get(`${unit.classId ?? unit.groupId ?? ''}|${unit.subjectId}`);
      if (found === undefined) throw new Error('No load row for the unit.');
      return found;
    };
    let accepted = 0;
    let refused = 0;
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(
        fc.array(patternOperation, { minLength: 15, maxLength: OPERATIONS }),
        async (operations) => {
          try {
            await h.state.transactions.run([north], async (transaction) => {
              await sql`set constraints all immediate`.execute(transaction);
              let blocks: ModelBlock[] = [];
              for (const one of operations) {
                const copy = blocks.map((block) => ({
                  ...block,
                  lessons: block.lessons.map((lesson) => ({ ...lesson })),
                }));
                let write: () => Promise<void>;
                if (one.op === 'add') {
                  const kindIndex = pick(kinds, one.kind);
                  const kind = pick(fixture.kinds, kindIndex);
                  const [start, end] = pick(TIMES, one.time);
                  const block: ModelBlock = {
                    id: '',
                    kind: kindIndex,
                    date: String(1 + (one.weekday % 2)),
                    start,
                    end,
                    lessons: kind.units.map((unit, index) => ({
                      id: '',
                      teacherId: rowOf(unit).teacher,
                      roomId: pick(fixture.rooms.get(north) ?? [], one.rooms[index] ?? 0),
                      cancelled: false,
                      cells: new Map(),
                    })),
                  };
                  copy.push(block);
                  write = async () => {
                    const written = await transaction
                      .insertInto('pattern_blocks')
                      .values({
                        branch_id: north,
                        version_id: versionId,
                        weekday: Number(block.date),
                        slot_position: 1,
                        start_minutes: start,
                        end_minutes: end,
                      })
                      .returning('id')
                      .executeTakeFirstOrThrow();
                    block.id = written.id;
                    for (const [index, lesson] of block.lessons.entries()) {
                      const row = rowOf(pick(kind.units, index));
                      const entry = await transaction
                        .insertInto('pattern_entries')
                        .values({
                          branch_id: north,
                          version_id: versionId,
                          block_id: written.id,
                          weekday: Number(block.date),
                          start_minutes: start,
                          end_minutes: end,
                          load_row_id: row.id,
                          teacher_id: row.teacher,
                          room_id: lesson.roomId,
                        })
                        .returning('id')
                        .executeTakeFirstOrThrow();
                      lesson.id = entry.id;
                    }
                  };
                } else {
                  if (copy.length === 0) continue;
                  const index = one.block % copy.length;
                  const block = pick(copy, index);
                  if (one.op === 'move') {
                    const [start, end] = pick(TIMES, one.time);
                    block.date = String(1 + (one.weekday % 2));
                    block.start = start;
                    block.end = end;
                    write = async () => {
                      await transaction
                        .updateTable('pattern_blocks')
                        .set({
                          weekday: Number(block.date),
                          start_minutes: start,
                          end_minutes: end,
                        })
                        .where('id', '=', block.id)
                        .execute();
                    };
                  } else if (one.op === 'room') {
                    const lesson = pick(block.lessons, one.lesson);
                    lesson.roomId = pick(fixture.rooms.get(north) ?? [], one.room);
                    write = async () => {
                      await transaction
                        .updateTable('pattern_entries')
                        .set({ room_id: lesson.roomId })
                        .where('id', '=', lesson.id)
                        .execute();
                    };
                  } else {
                    copy.splice(index, 1);
                    write = async () => {
                      await transaction
                        .deleteFrom('pattern_blocks')
                        .where('id', '=', block.id)
                        .execute();
                    };
                  }
                }
                // No student rule in the pattern: the engine names it there
                // (check.test.ts), and the dated lessons refuse it.
                const rules = broken(copy, false);
                const failure = await step(transaction, write);
                if (failure === undefined) {
                  expect(rules, `accepted ${JSON.stringify(one)}`).toEqual(new Set());
                  blocks = copy;
                  accepted += 1;
                } else {
                  const rule =
                    failure.constraint !== undefined &&
                    Object.hasOwn(PATTERN_MODELLED, failure.constraint)
                      ? PATTERN_MODELLED[failure.constraint as keyof typeof PATTERN_MODELLED]
                      : undefined;
                  expect(
                    rule,
                    `refused ${JSON.stringify(one)}: ${String(failure.code)} ${String(failure.constraint)}`,
                  ).toBeDefined();
                  expect(rules.has(rule as Rule), `refused by ${String(failure.constraint)}`).toBe(
                    true,
                  );
                  refused += 1;
                  reached.add(failure.constraint ?? '');
                }
                expect(await storedPattern(transaction, versionId)).toEqual(
                  expectedPattern(blocks),
                );
              }
              throw new RunOver();
            });
          } catch (error) {
            if (!(error instanceof RunOver)) throw error;
          }
        },
      ),
      { numRuns: PATTERN_RUNS },
    );
    expect(accepted).toBeGreaterThan(PATTERN_RUNS * 5);
    expect(refused).toBeGreaterThan(PATTERN_RUNS);
    expect(accepted + refused).toBeGreaterThan(1000);
    expect([...reached].sort()).toEqual(Object.keys(PATTERN_MODELLED).sort());
  });

  /** The stored entries of the draft, in the model's shape. */
  async function storedPattern(transaction: Transaction, versionId: string) {
    const rows = await transaction
      .selectFrom('pattern_entries')
      .select([
        'id',
        'block_id',
        'weekday',
        'start_minutes',
        'end_minutes',
        'teacher_id',
        'room_id',
      ])
      .where('version_id', '=', versionId)
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      block: row.block_id,
      day: String(row.weekday),
      start: row.start_minutes,
      end: row.end_minutes,
      teacherId: row.teacher_id,
      roomId: row.room_id,
    }));
  }

  function expectedPattern(blocks: readonly ModelBlock[]) {
    return blocks
      .flatMap((block) =>
        block.lessons.map((lesson) => ({
          id: lesson.id,
          block: block.id,
          day: block.date,
          start: block.start,
          end: block.end,
          teacherId: lesson.teacherId,
          roomId: lesson.roomId,
        })),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
});
