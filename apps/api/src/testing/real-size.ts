import { randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  type GridAnswer,
  type PublishCheck,
} from '@sodiq/shared';
import {
  blockPlacements,
  checkCandidates,
  checkedPlacements,
  newBlockOf,
  NEW_BLOCK_ID,
  patternModel,
  patternPlacements,
  suggestPlaces,
  type PatternBlock,
  type PatternModel,
  type PatternRowData,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import type { DayTemplatesKit } from './day-templates-kit.js';
import { LoadKit } from './load-kit.js';
import { groupMemberValues, MembersKit, memberValues } from './members-kit.js';
import { QUARTERS } from './published-scene.js';

/**
 * The real-size run of the timetable (task 5.12c; `14`, Whole system: Speed
 * tests; the owner's lines of 15 and 20 October 2026): a school of invented
 * data at the size given, its weekly pattern placed by a seed placer (until
 * 5.11 adds the generate step), checked by the rule engine, published branch
 * by branch through the real routes, and timed. `real-size.database.test.ts`
 * runs it small in CI and at the school's size with `REAL_SIZE=full`.
 */

/** The run's clock: Wednesday 26 August 2026, 10:00 in Tashkent, before the year starts. */
export const RUN_CLOCK = '2026-08-26T10:00:00+05:00';
/** The day after the run's clock: the template assignments start then. */
const RUN_TOMORROW = '2026-08-27';
/** Every draft starts, and is published, from Monday 7 September 2026 (review correction 2). */
export const RUN_START = '2026-09-07';
/** A teacher of two branches works until this minute (11:45) in the first and from it in the second. */
const SHARED_SPLIT = 705;
/** Travel time between every pair of branches. */
export const TRAVEL_MINUTES = 30;

/** The size of a run: the classes of each grade 1 to 11 in each branch, and the class size. */
export interface RunSize {
  readonly name: 'small' | 'full';
  /** One list per branch: index 0 is grade 1. */
  readonly classesPerGrade: readonly (readonly number[])[];
  readonly studentsPerClass: number;
  /** Teachers of a subject teach about this many lessons a week; the count follows. */
  readonly lessonsPerTeacher: number;
  /** In each branch after the first, so many subjects take a teacher of the branch before. */
  readonly sharedSubjects: number;
  /** Reads timed per measure, after one warm-up. */
  readonly repeats: number;
}

const only = (grade: number, count: number) =>
  Array.from({ length: 11 }, (_, index) => (index + 1 === grade ? count : 0));

export const SIZES: Record<RunSize['name'], RunSize> = {
  // Two branches, two classes of grade 7 each: an English block across both
  // classes, the mixed split of physical education and technology, and one
  // teacher of the first branch with lessons in the second.
  small: {
    name: 'small',
    classesPerGrade: [only(7, 2), only(7, 2)],
    studentsPerClass: 12,
    lessonsPerTeacher: 14,
    sharedSubjects: 1,
    repeats: 2,
  },
  // 3 branches, 80 classes, 2,000 students (the owner's line of 15 October).
  full: {
    name: 'full',
    classesPerGrade: [
      [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2],
      [2, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2],
    ],
    studentsPerClass: 25,
    lessonsPerTeacher: 12,
    sharedSubjects: 10,
    repeats: 5,
  },
};

/** How a subject is taught in a grade: whole class, in groups across a pair of classes, or split in halves (mixed with another split subject). */
type Way = 'whole' | 'groups' | 'split';

interface Lesson {
  readonly subject: string;
  readonly perWeek: number;
  readonly way: Way;
  readonly roomType?: 'classroom' | 'laboratory' | 'sports_hall' | 'other';
}

/** The weekly load of a class by grade: 24 lessons in grades 1 to 4, 27 to 30 above. */
function curriculumOf(grade: number): Lesson[] {
  if (grade <= 4) {
    return [
      { subject: 'Mathematics', perWeek: 5, way: 'whole' },
      { subject: 'Native language', perWeek: 6, way: 'whole' },
      { subject: 'Reading', perWeek: 3, way: 'whole' },
      { subject: 'Russian', perWeek: 2, way: 'whole' },
      { subject: 'English', perWeek: 2, way: 'whole' },
      { subject: 'Nature', perWeek: 2, way: 'whole' },
      { subject: 'Art', perWeek: 1, way: 'whole' },
      { subject: 'Music', perWeek: 1, way: 'whole' },
      { subject: 'Physical education', perWeek: 2, way: 'whole', roomType: 'sports_hall' },
    ];
  }
  if (grade <= 9) {
    return [
      { subject: 'Mathematics', perWeek: 5, way: 'whole' },
      { subject: 'Native language', perWeek: 3, way: 'whole' },
      { subject: 'Literature', perWeek: 2, way: 'whole' },
      { subject: 'Russian', perWeek: 2, way: 'whole' },
      { subject: 'English', perWeek: 3, way: 'groups' },
      { subject: 'History', perWeek: 2, way: 'whole' },
      { subject: 'Geography', perWeek: 2, way: 'whole' },
      { subject: 'Biology', perWeek: 2, way: 'whole' },
      ...(grade >= 7
        ? [
            { subject: 'Physics', perWeek: 2, way: 'whole' as const },
            {
              subject: 'Chemistry',
              perWeek: 2,
              way: 'whole' as const,
              roomType: 'laboratory' as const,
            },
          ]
        : [
            { subject: 'Nature', perWeek: 2, way: 'whole' as const },
            { subject: 'Art', perWeek: 1, way: 'whole' as const },
          ]),
      { subject: 'Informatics', perWeek: 1, way: 'whole' },
      { subject: 'Physical education', perWeek: 2, way: 'split', roomType: 'sports_hall' },
      { subject: 'Technology', perWeek: 2, way: 'split', roomType: 'other' },
    ];
  }
  return [
    { subject: 'Mathematics', perWeek: 6, way: 'whole' },
    { subject: 'Native language', perWeek: 2, way: 'whole' },
    { subject: 'Literature', perWeek: 2, way: 'whole' },
    { subject: 'Russian', perWeek: 2, way: 'whole' },
    { subject: 'English', perWeek: 3, way: 'groups' },
    { subject: 'History', perWeek: 2, way: 'whole' },
    { subject: 'Geography', perWeek: 1, way: 'whole' },
    { subject: 'Biology', perWeek: 2, way: 'whole' },
    { subject: 'Physics', perWeek: 3, way: 'whole' },
    { subject: 'Chemistry', perWeek: 2, way: 'whole', roomType: 'laboratory' },
    { subject: 'Informatics', perWeek: 2, way: 'whole' },
    { subject: 'Physical education', perWeek: 2, way: 'whole', roomType: 'sports_hall' },
    { subject: 'Law', perWeek: 1, way: 'whole' },
  ];
}

const SUBJECTS = [
  'Mathematics',
  'Native language',
  'Literature',
  'Reading',
  'Russian',
  'English',
  'History',
  'Geography',
  'Biology',
  'Physics',
  'Chemistry',
  'Nature',
  'Informatics',
  'Art',
  'Music',
  'Physical education',
  'Technology',
  'Law',
] as const;

/** Invented names only (`CLAUDE.md`, No real personal data). */
const FIRST_NAMES = ['Aziza', 'Bekzod', 'Dildora', 'Farrux', 'Gulnoza', 'Jahongir', 'Kamola'];
const LAST_NAMES = ['Sobirova', 'Toirov', 'Umarova', 'Valiyev', 'Xolmatova', 'Yoqubov', 'Zokirova'];
const CLASS_NAMES = ['Oxford', 'Cambridge', 'Princeton'];

/** Mulberry32: the same invented data for the same seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A load row as the school is built: its unit, subject, lessons and room need. */
interface PlannedRow {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subject: string;
  readonly perWeek: number;
  readonly roomType: Lesson['roomType'] | null;
  readonly mixed: boolean;
  /** The rows that must have different teachers (one block). */
  readonly blockKey: string;
}

export interface BranchOfRun {
  readonly id: string;
  readonly name: string;
  readonly year: string;
  readonly version: string;
  /** The Academic Vice Principal's cookie. */
  readonly cookie: string;
  readonly classes: readonly { readonly id: string; readonly grade: number }[];
  readonly teachers: readonly string[];
  readonly rows: number;
  readonly groups: number;
  readonly rooms: number;
}

export interface School {
  readonly branches: BranchOfRun[];
  readonly students: number;
  readonly teachers: number;
  readonly sharedTeachers: readonly string[];
}

/** The school of the size given, invented, with one draft per branch and its load rows. */
export async function buildSchool(t: DayTemplatesKit, size: RunSize, seed = 512): Promise<School> {
  const random = seededRandom(seed);
  const migrator = t.database.migrator;
  const load = new LoadKit(migrator);
  const members = new MembersKit(migrator, await load.classes.account());
  const subjects = new Map<string, string>();
  for (const name of SUBJECTS) {
    subjects.set(
      name,
      await load.classes.subject({
        name,
        grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        journalType: 'graded',
      }),
    );
  }
  const subjectId = (name: string) => {
    const id = subjects.get(name);
    if (id === undefined) throw new Error(`No subject ${name}.`);
    return id;
  };
  const branches: BranchOfRun[] = [];
  /** Each branch's teachers of each subject, for the teachers shared with the next branch. */
  const poolsOf: Map<string, string[]>[] = [];
  const sharedTeachers: string[] = [];
  let teacherCount = 0;
  let studentCount = 0;
  let personCount = 0;
  /** The hours to write once every branch is known: each branch's teachers, in branch order. */
  const hours: { branch: string; staffId: string }[] = [];

  for (const [branchIndex, perGrade] of size.classesPerGrade.entries()) {
    const name = `Real size branch ${String(branchIndex + 1)}`;
    const branch = await t.newBranch();
    await migrator.updateTable('branches').set({ name }).where('id', '=', branch).execute();
    const vice = await t.kit.completeSession(
      FIRST_NAMES[branchIndex % FIRST_NAMES.length] ?? 'Aziza',
      `${LAST_NAMES[branchIndex % LAST_NAMES.length] ?? 'Sobirova'}`,
    );
    await t.kit.giveRole(vice.account.id, { role: 'academic_vice_principal', branchId: branch });
    const cookie = vice.cookie;

    // The year with four dated quarters, and the day: 7 lessons of 45 minutes from 08:00.
    const year = await load.classes.year(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
    // The weights of every subject, daily and for each quarter, as a publish needs them.
    const quarterIds = await migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', year)
      .execute();
    const weights = { attendance: 20, classwork: 40, homework: 40 };
    await migrator
      .insertInto('subject_daily_weights')
      .values(
        [...subjects.values()].map((subject) => ({
          branch_id: branch,
          subject_id: subject,
          ...weights,
        })),
      )
      .execute();
    await migrator
      .insertInto('subject_quarter_weights')
      .values(
        [...subjects.values()].flatMap((subject) =>
          quarterIds.map((quarter) => ({
            branch_id: branch,
            subject_id: subject,
            quarter_id: quarter.id,
            ...weights,
          })),
        ),
      )
      .execute();
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const short = await t.createSlotType(branch, 'Break', 'break', 10);
    const long = await t.createSlotType(branch, 'Long break', 'break', 20);
    const day = await t.createTemplate(
      branch,
      'Regular',
      [
        lesson,
        short,
        lesson,
        short,
        lesson,
        long,
        lesson,
        short,
        lesson,
        short,
        lesson,
        short,
        lesson,
      ],
      '08:00',
    );
    await t.assign(branch, day, {}, RUN_TOMORROW);

    // Rooms: a classroom per class and four more, two laboratories, three
    // sports halls and three workshops, on one building and floor.
    const classCount = perGrade.reduce((sum, count) => sum + count, 0);
    const building = await migrator
      .insertInto('buildings')
      .values({ branch_id: branch, name: 'Main building' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const floor = await migrator
      .insertInto('floors')
      .values({ branch_id: branch, building_id: building.id, name: 'First' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const roomRows = [
      ...Array.from({ length: classCount + 4 }, (_, index) => ({
        name: `Room ${String(101 + index)}`,
        type: 'classroom',
      })),
      ...[1, 2].map((index) => ({ name: `Laboratory ${String(index)}`, type: 'laboratory' })),
      ...[1, 2, 3].map((index) => ({ name: `Sports hall ${String(index)}`, type: 'sports_hall' })),
      ...[1, 2, 3].map((index) => ({ name: `Workshop ${String(index)}`, type: 'other' })),
    ];
    const rooms = await migrator
      .insertInto('rooms')
      .values(
        roomRows.map((room) => ({
          branch_id: branch,
          floor_id: floor.id,
          name: room.name,
          type: room.type,
          capacity: 30,
          status: 'in_use',
        })),
      )
      .returning('id')
      .execute();

    // Classes, each with its own classroom, and their students from 1 September.
    const classes: { id: string; grade: number; students: string[] }[] = [];
    for (const [gradeIndex, count] of perGrade.entries()) {
      for (let index = 0; index < count; index += 1) {
        const grade = gradeIndex + 1;
        const room = rooms[classes.length]?.id ?? null;
        const classId = await load.classes.schoolClass(branch, year, {
          grade,
          name: CLASS_NAMES[index] ?? 'Yale',
          room,
          maxSize: 30,
        });
        const students: string[] = [];
        for (let one = 0; one < size.studentsPerClass; one += 1) {
          students.push(await members.student(branch, { grade }));
        }
        studentCount += students.length;
        await migrator
          .insertInto('class_memberships')
          .values(
            students.map((studentId) =>
              memberValues({ branch, classId, studentId, from: '2026-09-01' }),
            ),
          )
          .execute();
        classes.push({ id: classId, grade, students });
      }
    }

    // The rows of the load: whole classes, English groups across a pair of
    // classes of a grade (three groups), and splits in halves.
    const planned: PlannedRow[] = [];
    let groupCount = 0;
    const group = async (
      subject: string,
      classIds: readonly string[],
      students: readonly string[],
      label: string,
    ) => {
      groupCount += 1;
      const groupId = await load.classes.group(branch, year, subjectId(subject), classIds, {
        name: label,
        size: 30,
      });
      await migrator
        .insertInto('group_memberships')
        .values(
          students.map((studentId) =>
            groupMemberValues({
              branch,
              groupId,
              subjectId: subjectId(subject),
              studentId,
              from: '2026-09-01',
            }),
          ),
        )
        .execute();
      return groupId;
    };
    for (const grade of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const ofGrade = classes.filter((one) => one.grade === grade);
      for (const lessonOf of curriculumOf(grade)) {
        if (lessonOf.way === 'whole') {
          for (const one of ofGrade) {
            planned.push({
              classId: one.id,
              groupId: null,
              subject: lessonOf.subject,
              perWeek: lessonOf.perWeek,
              roomType: lessonOf.roomType ?? null,
              mixed: false,
              blockKey: `class:${one.id}:${lessonOf.subject}`,
            });
          }
        } else if (lessonOf.way === 'groups') {
          // Pairs of classes; a class left alone is split in two groups.
          for (let index = 0; index < ofGrade.length; index += 2) {
            const unit = ofGrade.slice(index, index + 2);
            const students = unit.flatMap((one) => one.students);
            const parts = unit.length === 2 ? 3 : 2;
            const key = `groups:${unit.map((one) => one.id).join('+')}:${lessonOf.subject}`;
            for (let part = 0; part < parts; part += 1) {
              const groupId = await group(
                lessonOf.subject,
                unit.map((one) => one.id),
                students.filter((_, at) => at % parts === part),
                `${String(grade)} ${lessonOf.subject} ${String(index / 2 + 1)}-${String(part + 1)}`,
              );
              planned.push({
                classId: null,
                groupId,
                subject: lessonOf.subject,
                perWeek: lessonOf.perWeek,
                roomType: 'classroom',
                mixed: false,
                blockKey: key,
              });
            }
          }
        } else {
          for (const one of ofGrade) {
            const half = Math.ceil(one.students.length / 2);
            for (const [part, students] of [
              one.students.slice(0, half),
              one.students.slice(half),
            ].entries()) {
              const groupId = await group(
                lessonOf.subject,
                [one.id],
                students,
                `${String(grade)}-${String(classes.indexOf(one) + 1)} ${lessonOf.subject} ${part === 0 ? 'boys' : 'girls'}`,
              );
              planned.push({
                classId: null,
                groupId,
                subject: lessonOf.subject,
                perWeek: lessonOf.perWeek,
                roomType: lessonOf.roomType ?? null,
                mixed: true,
                blockKey: `split:${one.id}:${lessonOf.subject}`,
              });
            }
          }
        }
      }
    }

    // Teachers: per subject so many that each teaches about
    // `lessonsPerTeacher`, at least the widest block; in a branch after the
    // first, the first `sharedSubjects` subjects take a teacher of the branch
    // before, who teaches here one row.
    const pools = new Map<string, string[]>();
    const loadOf = new Map<string, number>();
    const assigned = new Map<PlannedRow, string>();
    const previous = poolsOf[branchIndex - 1];
    let sharedHere = 0;
    for (const subject of SUBJECTS) {
      const rows = planned.filter((row) => row.subject === subject);
      if (rows.length === 0) continue;
      const total = rows.reduce((sum, row) => sum + row.perWeek, 0);
      const widest = Math.max(
        ...[...new Set(rows.map((row) => row.blockKey))].map(
          (key) => rows.filter((row) => row.blockKey === key).length,
        ),
      );
      const count = Math.max(widest, Math.ceil(total / size.lessonsPerTeacher));
      const pool: string[] = [];
      for (let index = 0; index < count; index += 1) {
        personCount += 1;
        const person = await load.teacher(branch, {
          subjects: [{ subject: subjectId(subject), grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }],
          noAccount: true,
        });
        await migrator
          .updateTable('staff')
          .set({
            first_name: FIRST_NAMES[personCount % FIRST_NAMES.length] ?? 'Aziza',
            last_name: `${LAST_NAMES[Math.floor(personCount / FIRST_NAMES.length) % LAST_NAMES.length] ?? 'Sobirova'}`,
          })
          .where('id', '=', person.staffId)
          .execute();
        pool.push(person.staffId);
        loadOf.set(person.staffId, 0);
      }
      teacherCount += pool.length;
      pools.set(subject, pool);
      const sharedFrom = previous?.get(subject)?.[0];
      const firstWhole = rows.find((row) => row.classId !== null);
      if (
        sharedFrom !== undefined &&
        sharedHere < size.sharedSubjects &&
        firstWhole !== undefined
      ) {
        sharedHere += 1;
        await migrator
          .insertInto('staff_branches')
          .values({ staff_id: sharedFrom, branch_id: branch, is_main: false })
          .execute();
        sharedTeachers.push(sharedFrom);
        assigned.set(firstWhole, sharedFrom);
      }
      // Busiest first; each row to the least loaded teacher its block does not hold yet.
      const order = rows
        .filter((row) => !assigned.has(row))
        .sort((a, b) => b.perWeek - a.perWeek || random() - 0.5);
      for (const row of order) {
        const taken = new Set(
          rows
            .filter((other) => other.blockKey === row.blockKey && !other.mixed)
            .map((other) => assigned.get(other))
            .filter((id): id is string => id !== undefined),
        );
        const choice = [...pool]
          .filter((id) => !taken.has(id))
          .sort((a, b) => (loadOf.get(a) ?? 0) - (loadOf.get(b) ?? 0))[0];
        if (choice === undefined) throw new Error(`No teacher of ${subject} for a row.`);
        assigned.set(row, choice);
        loadOf.set(choice, (loadOf.get(choice) ?? 0) + row.perWeek);
      }
    }
    poolsOf.push(pools);

    const teachers = [...new Set(assigned.values())];
    for (const staffId of teachers) hours.push({ branch, staffId });

    // The draft from the run's start, and its rows.
    const created = await request(t.kit.server)
      .post('/api/timetable/versions')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .send({ academicYearId: year, startsOn: RUN_START, copyFrom: null });
    if (created.status !== 201) throw new Error(`Draft: ${JSON.stringify(created.body)}`);
    const version = (created.body as { id: string }).id;
    await migrator
      .insertInto('teaching_load_rows')
      .values(
        planned.map((row) => ({
          branch_id: branch,
          version_id: version,
          class_id: row.classId,
          group_id: row.groupId,
          subject_id: subjectId(row.subject),
          teacher_id: assigned.get(row) ?? '',
          lessons_per_week: row.perWeek,
          room_type: row.roomType,
          mixed_block: row.mixed,
        })),
      )
      .execute();

    branches.push({
      id: branch,
      name,
      year,
      version,
      cookie,
      classes: classes.map((one) => ({ id: one.id, grade: one.grade })),
      teachers,
      rows: planned.length,
      groups: groupCount,
      rooms: rooms.length,
    });
  }

  // Every teacher available Monday to Friday, all day; a teacher of two
  // branches until 11:45 in the first and from 11:45 in the second (the
  // hours of one person never overlap: `staff_availability_ranges_no_overlap`).
  // The fourth lesson ends at 11:40 and the fifth starts at 11:50, so only
  // the travel time keeps a teacher from taking both in two branches.
  const shared = new Set(sharedTeachers);
  const homeOf = new Map<string, string>();
  for (const { branch, staffId } of hours) {
    if (!homeOf.has(staffId)) homeOf.set(staffId, branch);
    const [start, end] = !shared.has(staffId)
      ? [0, 1440]
      : homeOf.get(staffId) === branch
        ? [0, SHARED_SPLIT]
        : [SHARED_SPLIT, 1440];
    const entry = await migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    await migrator
      .insertInto('staff_availability_ranges')
      .values(
        [1, 2, 3, 4, 5].map((weekday) => ({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: staffId,
          weekday,
          start_minutes: start,
          end_minutes: end,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })),
      )
      .execute();
  }

  // Travel time between every pair of branches.
  for (const [index, a] of branches.entries()) {
    for (const b of branches.slice(index + 1)) {
      const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      await migrator
        .insertInto('travel_times')
        .values({ branch_low: low, branch_high: high, minutes: TRAVEL_MINUTES })
        .execute();
    }
  }
  return { branches, students: studentCount, teachers: teacherCount, sharedTeachers };
}

/** The API as a branch's Academic Vice Principal. */
export function asVice(t: DayTemplatesKit, branch: BranchOfRun) {
  const server = t.kit.server;
  const withBranch = (call: request.Test) =>
    call.set('Cookie', branch.cookie).set(BRANCH_HEADER, branch.id);
  return {
    get: (path: string) => withBranch(request(server).get(path)),
    post: (path: string, body: object = {}) =>
      withBranch(request(server).post(path)).set(REQUEST_KEY_HEADER, randomUUID()).send(body),
    put: (path: string, body: object) => withBranch(request(server).put(path)).send(body),
  };
}

const ok = (response: Response, status: number, what: string): Response => {
  if (response.status !== status) {
    throw new Error(`${what}: ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return response;
};

/** The board of a version, as the grid route answers it. */
export async function gridOf(t: DayTemplatesKit, branch: BranchOfRun): Promise<GridAnswer> {
  const response = await asVice(t, branch).get(`/api/timetable/versions/${branch.version}/grid`);
  return ok(response, 200, 'grid').body as GridAnswer;
}

export interface Placed {
  readonly lessons: number;
  readonly blocks: number;
  /** The lessons the placer could not place, by class or group, subject and count. */
  readonly notPlaced: readonly {
    readonly unit: string;
    readonly subject: string;
    readonly lessons: number;
  }[];
  readonly seconds: number;
}

/**
 * The seed placer (until 5.11): every block of the draft's rows is placed at
 * the first lesson slot, fewest of its subject and of its classes' lessons on
 * the day first, where its classes, teachers and rooms are free by clock time
 * (a room of the row's type is chosen when the row names one); the rule
 * engine's `checkCandidates` on the grid's own facts has the last word on
 * each place, so a teacher's lesson in a published branch and the travel time
 * to it are kept. Written with Kysely as `writeBlock` writes a block: seed
 * data, no audit entry (decision 5).
 */
export async function placeDraft(t: DayTemplatesKit, branch: BranchOfRun): Promise<Placed> {
  const started = performance.now();
  const grid = await gridOf(t, branch);
  const model = patternModel(grid.facts);
  const rows = grid.facts.rows;
  const roomsOfType = new Map<string, string[]>();
  for (const room of grid.facts.rooms) {
    roomsOfType.set(room.type, [...(roomsOfType.get(room.type) ?? []), room.id]);
  }

  // One item per lesson to place: a block of rows (a whole class row, the
  // groups of a block, a mixed pairing of two halves), once per lesson a week.
  interface Item {
    readonly rows: readonly PatternRowData[];
    readonly classIds: readonly string[];
    /** What the item holds while placed: its classes and its teachers. */
    readonly keys: readonly string[];
    readonly subjects: readonly string[];
    readonly template: PatternBlock;
    readonly cells: readonly {
      weekday: number;
      slotPosition: number;
      start: number;
      end: number;
    }[];
    readonly shared: boolean;
  }
  const elsewhere = new Set(grid.facts.busyElsewhere.map((one) => one.teacherId));
  const items: Item[] = [];
  const itemOf = (rowIds: readonly string[], times: number) => {
    const unitRows = rowIds.map((id) => model.rowOf(id));
    const classIds = [
      ...new Set(
        unitRows.flatMap((row) => model.unitOf(row.classId ?? row.groupId ?? '').classIds),
      ),
    ];
    const first = rowIds[0] ?? '';
    const template =
      rowIds.length === 2 && unitRows.every((row) => row.mixedBlock)
        ? newBlockOf(model, first, rowIds[1])
        : newBlockOf(model, first);
    const cells = [];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      for (const slot of model.dayOfRows(unitRows, weekday)?.slots ?? []) {
        if (slot.kind !== 'lesson') continue;
        const [at] = blockPlacements(model, template, weekday, slot.position) ?? [];
        if (at !== undefined) {
          cells.push({ weekday, slotPosition: slot.position, start: at.start, end: at.end });
        }
      }
    }
    for (let time = 0; time < times; time += 1) {
      items.push({
        rows: unitRows,
        classIds,
        keys: [...classIds, ...unitRows.map((row) => `teacher:${row.teacherId}`)],
        subjects: unitRows.map((row) => row.subjectId),
        template,
        cells,
        shared: unitRows.some((row) => elsewhere.has(row.teacherId)),
      });
    }
  };
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    if (row.mixedBlock) {
      // A class's halves: boys of one subject with girls of the other, and the reverse.
      const classes = model.unitOf(row.groupId ?? '').classIds.join();
      const halves = rows.filter(
        (other) =>
          other.mixedBlock && model.unitOf(other.groupId ?? '').classIds.join() === classes,
      );
      const [first, second] = [...new Set(halves.map((one) => one.subjectId))].map((subject) =>
        halves.filter((one) => one.subjectId === subject).sort((a, b) => (a.id < b.id ? -1 : 1)),
      );
      const [a1, a2] = first ?? [];
      const [b1, b2] = second ?? [];
      if (first?.length === 2 && second?.length === 2 && a1 && a2 && b1 && b2) {
        itemOf([a1.id, b2.id], a1.lessonsPerWeek);
        itemOf([a2.id, b1.id], a2.lessonsPerWeek);
      } else {
        for (const one of halves) itemOf([one.id], one.lessonsPerWeek);
      }
      for (const one of halves) seen.add(one.id);
      continue;
    }
    for (const id of row.block) seen.add(id);
    itemOf(row.block, row.lessonsPerWeek);
  }

  // What is placed, and what each slot holds (classes, teachers, rooms) and
  // each class has on each day, rebuilt after a rearrangement.
  const placed = new Map<string, { block: PatternBlock; item: Item }>();
  const busy = new Map<string, Set<string>>();
  const perDay = new Map<string, number>();
  const at = (weekday: number, start: number) => `${String(weekday)}:${String(start)}`;
  const rooms = (block: PatternBlock) =>
    block.lessons.map((one) => one.roomId).filter((id): id is string => id !== null);
  const holdsAny = (weekday: number, start: number, ids: readonly string[]) => {
    const set = busy.get(at(weekday, start));
    return set !== undefined && ids.some((id) => set.has(id));
  };
  const add = (block: PatternBlock, item: Item) => {
    placed.set(block.id, { block, item });
    const key = at(block.weekday, block.start);
    const set = busy.get(key) ?? new Set<string>();
    for (const id of [...item.keys, ...rooms(block)]) set.add(id);
    busy.set(key, set);
    for (const id of item.classIds) {
      const day = `${id}|${String(block.weekday)}`;
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      for (const subject of item.subjects) {
        const ofSubject = `${id}:${subject}|${String(block.weekday)}`;
        perDay.set(ofSubject, (perDay.get(ofSubject) ?? 0) + 1);
      }
    }
  };
  const rebuild = () => {
    const all = [...placed.values()];
    placed.clear();
    busy.clear();
    perDay.clear();
    for (const one of all) add(one.block, one.item);
  };
  /** The item at a cell with a free room of each row's type; `null` when the slot is taken. */
  const blockAt = (item: Item, cell: Item['cells'][number], id: string): PatternBlock | null => {
    if (holdsAny(cell.weekday, cell.start, item.keys)) return null;
    const chosen: string[] = [];
    const lessons = [];
    for (const one of item.template.lessons) {
      const type = model.rowOf(one.loadRowId).roomType;
      if (type === null) {
        if (one.roomId !== null && holdsAny(cell.weekday, cell.start, [one.roomId])) return null;
        lessons.push({ ...one, id: `${id}:${one.loadRowId}` });
        continue;
      }
      const free = (roomsOfType.get(type) ?? []).find(
        (room) => !chosen.includes(room) && !holdsAny(cell.weekday, cell.start, [room]),
      );
      if (free === undefined) return null;
      chosen.push(free);
      lessons.push({ ...one, id: `${id}:${one.loadRowId}`, roomId: free });
    }
    return { ...item.template, ...cell, id, lessons };
  };
  const day = (key: string, weekday: number) => perDay.get(`${key}|${String(weekday)}`) ?? 0;
  const score = (item: Item, cell: Item['cells'][number]) =>
    Math.max(
      ...item.classIds.map((id) =>
        item.subjects.reduce((sum, subject) => sum + day(`${id}:${subject}`, cell.weekday), 0),
      ),
    ) *
      1000 +
    Math.max(...item.classIds.map((id) => day(id, cell.weekday))) * 10 +
    cell.slotPosition / 100;
  const blockedFor = (changed: readonly PatternBlock[]) =>
    checkCandidates(
      checkedPlacements(
        model,
        [...placed.values()].map((one) => one.block),
      ),
      model.facts,
      patternPlacements(model, changed),
    ).some((one) => one.severity === 'blocked');

  // The item with the fewest free slots first (wider blocks and shared
  // teachers first among equals); the engine has the last word on each place.
  const notPlaced = new Map<string, { unit: string; subject: string; lessons: number }>();
  const left = new Set(items);
  let next = 0;
  while (left.size > 0) {
    let item: Item | undefined;
    let fewest = Number.POSITIVE_INFINITY;
    for (const one of left) {
      const free = one.cells.filter((cell) => blockAt(one, cell, 'probe') !== null).length;
      const rank = free * 10 - one.rows.length - (one.shared ? 5 : 0);
      if (rank < fewest) {
        fewest = rank;
        item = one;
      }
    }
    if (item === undefined) break;
    left.delete(item);
    next += 1;
    const id = `seed:${String(next)}`;
    let done = false;
    for (const cell of [...item.cells].sort((a, b) => score(item, a) - score(item, b))) {
      const block = blockAt(item, cell, id);
      if (block === null || blockedFor([block])) continue;
      add(block, item);
      done = true;
      break;
    }
    if (!done) {
      // "Suggest a place" of the engine: a free slot, or a rearrangement of
      // up to two placed blocks that makes room.
      const fresh: PatternBlock = {
        ...item.template,
        lessons: item.template.lessons.map((one) => ({
          ...one,
          id: `${NEW_BLOCK_ID}:${one.loadRowId}`,
        })),
      };
      const found = suggestPlaces(
        model,
        [...placed.values()].map((one) => one.block),
        fresh,
        { budget: 4000 },
      );
      const suggestion = found.free[0] ?? found.rearrangements[0];
      if (suggestion !== undefined) {
        for (const change of suggestion.changes) {
          if (change.from === null) {
            const block: PatternBlock = {
              ...change.to,
              id,
              lessons: change.to.lessons.map((one) => ({ ...one, id: `${id}:${one.loadRowId}` })),
            };
            placed.set(id, { block, item });
          } else {
            const known = placed.get(change.from.id);
            if (known !== undefined)
              placed.set(change.from.id, { block: change.to, item: known.item });
          }
        }
        rebuild();
        done = true;
      }
    }
    if (!done) {
      for (const row of item.rows) {
        const unit = row.classId ?? row.groupId ?? '';
        const key = `${unit}|${row.subjectId}`;
        const known = notPlaced.get(key) ?? { unit, subject: row.subjectId, lessons: 0 };
        notPlaced.set(key, { ...known, lessons: known.lessons + 1 });
      }
    }
  }
  const blocks = [...placed.values()].map((one) => one.block);

  // Written as `writeBlock` writes them, in one transaction of the migrator.
  await t.database.migrator.transaction().execute(async (transaction) => {
    for (const block of blocks) {
      const written = await transaction
        .insertInto('pattern_blocks')
        .values({
          branch_id: branch.id,
          version_id: branch.version,
          weekday: block.weekday,
          slot_position: block.slotPosition,
          start_minutes: block.start,
          end_minutes: block.end,
          double_pair_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('pattern_entries')
        .values(
          block.lessons.map((one) => ({
            branch_id: branch.id,
            version_id: branch.version,
            block_id: written.id,
            weekday: block.weekday,
            start_minutes: block.start,
            end_minutes: block.end,
            load_row_id: one.loadRowId,
            teacher_id: model.rowOf(one.loadRowId).teacherId,
            room_id: one.roomId,
          })),
        )
        .execute();
    }
  });
  const names = new Map(grid.rows.map((row) => [row.unit.id, row.unit.name] as const));
  const subjectNames = new Map(
    grid.rows.map((row) => [row.subject.id, row.subject.names.en] as const),
  );
  return {
    lessons: blocks.reduce((sum, block) => sum + block.lessons.length, 0),
    blocks: blocks.length,
    notPlaced: [...notPlaced.values()].map((one) => ({
      unit: names.get(one.unit) ?? one.unit,
      subject: subjectNames.get(one.subject) ?? one.subject,
      lessons: one.lessons,
    })),
    seconds: (performance.now() - started) / 1000,
  };
}

/** Steps 1 and 5 of the builder confirmed, as the person does before the publish. */
export async function confirmSteps(t: DayTemplatesKit, branch: BranchOfRun): Promise<unknown> {
  const vice = asVice(t, branch);
  ok(
    await vice.post(`/api/timetable/versions/${branch.version}/templates/confirm`),
    200,
    'templates',
  );
  const readiness = ok(
    await vice.get(`/api/timetable/versions/${branch.version}/readiness`),
    200,
    'readiness',
  ).body as { ready: boolean; rules?: { ready: boolean; weights?: unknown } };
  if (readiness.rules !== undefined && !readiness.rules.ready) {
    ok(
      await vice.post(`/api/timetable/versions/${branch.version}/rules/confirm`, {
        weights: readiness.rules.weights,
        pins: [],
      }),
      200,
      'rules',
    );
  }
  return ok(await vice.get(`/api/timetable/versions/${branch.version}/readiness`), 200, 'readiness')
    .body;
}

/** One measure: the median and the slowest of its timed runs, in milliseconds. */
export interface Timing {
  readonly what: string;
  readonly target: string;
  readonly runs: readonly number[];
}

export const median = (runs: readonly number[]) => {
  const sorted = [...runs].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};

/** Times `work` `repeats` times after one warm-up run that is not counted. */
export async function timed<T>(
  repeats: number,
  work: () => Promise<T>,
): Promise<{ runs: number[]; last: T }> {
  let last = await work();
  const runs: number[] = [];
  for (let index = 0; index < repeats; index += 1) {
    const started = performance.now();
    last = await work();
    runs.push(performance.now() - started);
  }
  return { runs, last };
}

/** Times one run of `work`, not repeated (a write: the publish). */
export async function once<T>(work: () => Promise<T>): Promise<{ runs: number[]; last: T }> {
  const started = performance.now();
  const last = await work();
  return { runs: [performance.now() - started], last };
}

/**
 * The board's check while a lesson is dragged (`12`: check a timetable move
 * for conflicts, under 0.2 seconds): `checkCandidates` of a stored block at
 * every other lesson slot of the week, on the facts the grid answers, as the
 * board marks every cell when a drag starts (`useSlotStatuses`).
 */
export function moveCheck(grid: GridAnswer, repeats: number): { runs: number[]; slots: number } {
  const model: PatternModel = patternModel(grid.facts);
  const blocks: PatternBlock[] = grid.blocks;
  const block = blocks.find((one) => one.lessons.length === 1) ?? blocks[0];
  if (block === undefined) throw new Error('No block to drag.');
  const placements = checkedPlacements(model, blocks);
  const rows = block.lessons.map((one) => model.rowOf(one.loadRowId));
  const cells: PatternBlock[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const slot of model.dayOfRows(rows, weekday)?.slots ?? []) {
      if (slot.kind !== 'lesson') continue;
      if (weekday === block.weekday && slot.position === block.slotPosition) continue;
      cells.push({
        ...block,
        weekday,
        slotPosition: slot.position,
        start: slot.start,
        end: slot.end,
      });
    }
  }
  const checkAll = () => {
    for (const cell of cells)
      checkCandidates(placements, model.facts, patternPlacements(model, [cell]));
  };
  checkAll();
  const runs: number[] = [];
  for (let index = 0; index < repeats; index += 1) {
    const started = performance.now();
    checkAll();
    runs.push(performance.now() - started);
  }
  return { runs, slots: cells.length };
}

/**
 * The travel time against a published branch (`06`, Teachers who work in
 * several branches: Busy elsewhere, Travel time; review correction 2): on the
 * draft of a later branch, a lesson of a shared teacher put in the lesson
 * slot right after one of their lessons of the earlier branch (a break of 10
 * or 20 minutes, shorter than the travel time). Answers the busy-elsewhere
 * lessons of the teacher the draft's facts hold and the rules the engine
 * gives that lesson; `null` when the teacher has no row in the draft.
 */
export function travelProbe(
  grid: GridAnswer,
  teacherId: string,
): { readonly elsewhere: number; readonly rules: readonly string[] } | null {
  const model = patternModel(grid.facts);
  const row = grid.facts.rows.find((one) => one.teacherId === teacherId && one.classId !== null);
  const away = grid.facts.busyElsewhere.filter((one) => one.teacherId === teacherId);
  if (row === undefined) return null;
  for (const lesson of away) {
    const slot = model.dayOfRows([row], lesson.weekday)?.slots.find(
      (one) =>
        one.kind === 'lesson' &&
        one.start >= lesson.end &&
        one.start < lesson.end + TRAVEL_MINUTES &&
        // Free of every lesson of the teacher there, so only the travel time is broken.
        !away.some(
          (other) =>
            other.weekday === lesson.weekday && other.start < one.end && one.start < other.end,
        ),
    );
    if (slot === undefined) continue;
    const probe: PatternBlock = {
      ...newBlockOf(model, row.id),
      id: 'probe',
      weekday: lesson.weekday,
      slotPosition: slot.position,
      start: slot.start,
      end: slot.end,
    };
    const results = checkCandidates(
      checkedPlacements(model, grid.blocks),
      model.facts,
      patternPlacements(model, [probe]),
    );
    return {
      elsewhere: away.length,
      rules: results.filter((one) => one.severity === 'blocked').map((one) => one.rule),
    };
  }
  return { elsewhere: away.length, rules: [] };
}

/** The blocked results of a board by rule, and the warnings by rule. */
export function resultsByRule(
  results: readonly { readonly rule: string; readonly severity: string }[],
): {
  blocked: Record<string, number>;
  warnings: Record<string, number>;
} {
  const blocked: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  for (const one of results) {
    const into = one.severity === 'blocked' ? blocked : warnings;
    into[one.rule] = (into[one.rule] ?? 0) + 1;
  }
  return { blocked, warnings };
}

/** The publish check's refusals and blocked warnings: nothing may stop the publish. */
export const checkStops = (check: PublishCheck) => ({
  refusals: check.refusals.length,
  blocked: check.warnings.filter((one) => one.severity === 'blocked').length,
});

/** What the report says about the machine. */
export async function machineOf(t: DayTemplatesKit): Promise<string> {
  const version = await sql<{ server_version: string }>`show server_version`.execute(
    t.database.migrator,
  );
  const cpu = cpus();
  return `${String(cpu.length)} CPUs (${cpu[0]?.model ?? 'unknown'}), Node ${process.version}, PostgreSQL ${version.rows[0]?.server_version ?? 'unknown'}`;
}

/**
 * A stored block of one lesson and another lesson slot where the rule engine
 * finds nothing blocked for it: the saved move of the run, and its way back.
 */
export function movableBlock(grid: GridAnswer): {
  readonly blockId: string;
  readonly from: { readonly weekday: number; readonly slotPosition: number };
  readonly to: { readonly weekday: number; readonly slotPosition: number };
} | null {
  const model = patternModel(grid.facts);
  const blocks: PatternBlock[] = grid.blocks;
  const placements = checkedPlacements(model, blocks);
  for (const block of blocks.filter((one) => one.lessons.length === 1)) {
    const rows = block.lessons.map((one) => model.rowOf(one.loadRowId));
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      for (const slot of model.dayOfRows(rows, weekday)?.slots ?? []) {
        if (slot.kind !== 'lesson') continue;
        if (weekday === block.weekday && slot.position === block.slotPosition) continue;
        const moved = {
          ...block,
          weekday,
          slotPosition: slot.position,
          start: slot.start,
          end: slot.end,
        };
        const results = checkCandidates(placements, model.facts, patternPlacements(model, [moved]));
        if (results.some((one) => one.severity === 'blocked')) continue;
        return {
          blockId: block.id,
          from: { weekday: block.weekday, slotPosition: block.slotPosition },
          to: { weekday, slotPosition: slot.position },
        };
      }
    }
  }
  return null;
}
