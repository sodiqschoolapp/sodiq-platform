import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BRANCH_HEADER,
  HOME_KINDS,
  MENU_ITEMS,
  REQUEST_KEY_HEADER,
  type AttendanceSaved,
  type GridAnswer,
  type PublishCheck,
  type Role,
  type ScoresSaved,
  type WorkSaved,
} from '@sodiq/shared';
import {
  checkCandidates,
  checkTimetable,
  checkedPlacements,
  patternModel,
  patternPlacements,
  type PatternBlock,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { QUARTERS } from '../../testing/published-scene.js';
import { LoadKit } from '../../testing/load-kit.js';
import {
  percentile95,
  runLoad,
  writeSessions,
  type LoadAction,
  type LoadPerson,
  type LoadTimes,
} from '../../testing/load-run.js';
import {
  asVice,
  buildSchool,
  checkStops,
  confirmSteps,
  gridOf,
  machineOf,
  median,
  moveCheck,
  once,
  placeDraft,
  RUN_CLOCK,
  RUN_START,
  SIZES,
  timed,
  type BranchOfRun,
  type School,
  type Timing,
} from '../../testing/real-size.js';
import {
  DENSITY,
  fillJournals,
  FILLED_UNTIL,
  journalCounts,
  SPEED_CLOCK,
  type Filled,
} from '../../testing/speed-data.js';

/**
 * The speed run (task 10.1; `12`, Speed targets; `14`, Whole system: Speed
 * tests). A school of invented data is built, placed and published branch by
 * branch (`real-size.ts`), its journals filled for a year up to the
 * measuring day (`speed-data.ts`), and every target of `12` measured through
 * the real routes against it, then again under the load of the people of
 * `12`, Load (`load-run.ts`). The report is written to
 * `apps/api/speed-report-<size>.md` (git-ignored; the Speed workflow keeps it).
 *
 * Small on every pull request (2 branches, 4 classes, 10 users for 20 s): the
 * routes answer and the counts add up, no time is asserted. `SPEED_SIZE=triple`
 * (the Speed workflow) runs three times the estimated yearly data with 1,000
 * users for 10 minutes, and fails on a missed target: a read on the slowest of
 * its repeats, an action under load on its 95th percentile (plan decision 4).
 */

const size = SIZES[process.env.SPEED_SIZE === 'triple' ? 'triple' : 'small'];
const TRIPLE = size.name === 'triple';
const LIMIT = TRIPLE ? 5 * 60 * 60_000 : 10 * 60_000;
const REPORT = resolve(import.meta.dirname, `../../../speed-report-${size.name}.md`);
const LOAD = TRIPLE
  ? { users: 1000, durationMs: 10 * 60_000, gapMs: [5000, 15000] as const }
  : { users: 10, durationMs: 20_000, gapMs: [500, 1500] as const };

/** The targets of `12`, Speed targets, in milliseconds. */
const TARGET = { page: 1000, journal: 1000, save: 300, move: 200, report: 2000, search: 200 };

/**
 * The first read of every page of the left menu (`MENU_ITEMS`) and of every
 * home page (`HOME_KIND`), as the role that opens it: what the page asks the
 * server before it can draw (plan, "Open any page"). A test holds it complete
 * against the menu. The home of the roles of a later release has no read.
 */
type PageKey = (typeof MENU_ITEMS)[number] | `home:${(typeof HOME_KINDS)[number]}`;

interface Ids {
  readonly quarter: string;
  readonly classId: string;
  readonly studentId: string;
  readonly teacherStaffId: string;
  readonly date: string;
}

const PAGE_READS: Record<
  Exclude<PageKey, 'home' | 'home:later_release'>,
  { role: Role; reads: (ids: Ids) => string[] }
> = {
  'home:academic_vice_principal': {
    role: 'academic_vice_principal',
    reads: () => [
      '/api/timetable/attention',
      '/api/timetable/conflicts-summary',
      '/api/results/early-warning',
      '/api/journal/lessons-today',
      '/api/results/closing',
      '/api/plans/requests?view=deciding',
      '/api/journal/unlocks?view=deciding',
      '/api/people/students/no-class',
      '/api/people/relatives/no-valid-phone',
    ],
  },
  'home:teaching': {
    role: 'teacher',
    reads: () => [
      '/api/timetable/home',
      '/api/journal/reminders',
      '/api/journal/journals',
      '/api/results/early-warning?for=own_journals',
    ],
  },
  'home:tutor': {
    role: 'tutor',
    reads: () => ['/api/journal/attendance-today', '/api/timetable/home', '/api/journal/reminders'],
  },
  'home:attendance_overview': {
    role: 'head_tutor',
    reads: () => ['/api/journal/attendance-today'],
  },
  'home:branch_summary': {
    role: 'principal',
    reads: () => ['/api/results/branch-summary'],
  },
  setup: { role: 'academic_vice_principal', reads: () => ['/api/setup/checklist'] },
  people: {
    role: 'academic_vice_principal',
    reads: () => ['/api/people/students', '/api/people/staff'],
  },
  classes: { role: 'academic_vice_principal', reads: () => ['/api/classes', '/api/groups'] },
  timetable: {
    role: 'academic_vice_principal',
    reads: (ids) => [
      '/api/timetable/versions',
      `/api/timetable/views/class?date=${ids.date}&span=week&classId=${ids.classId}`,
      `/api/timetable/views/teacher?date=${ids.date}&span=week&staffId=${ids.teacherStaffId}`,
    ],
  },
  journal: { role: 'teacher', reads: () => ['/api/journal/journals'] },
  results: {
    role: 'academic_vice_principal',
    reads: (ids) => [
      `/api/results/rating/classes?quarterId=${ids.quarter}`,
      `/api/results/students/${ids.studentId}`,
    ],
  },
  plans: { role: 'teacher', reads: () => ['/api/plans'] },
  requests: {
    role: 'academic_vice_principal',
    reads: () => ['/api/journal/unlocks?view=deciding', '/api/plans/requests?view=deciding'],
  },
  audit_log: { role: 'academic_vice_principal', reads: () => ['/api/audit/entries'] },
};

let t: DayTemplatesKit;

beforeAll(async () => {
  t = await dayTemplatesKit({ start: RUN_CLOCK });
});

afterAll(async () => {
  await t.close();
});

describe('the page reads of the speed run', () => {
  it('cover every page of the menu and every home page with a read', () => {
    const pages: string[] = [
      ...MENU_ITEMS.filter((item) => item !== 'home'),
      ...HOME_KINDS.filter((kind) => kind !== 'later_release').map((kind) => `home:${kind}`),
    ];
    expect(Object.keys(PAGE_READS).sort()).toEqual(pages.sort());
  });
});

/** A person of the speed run: an account with one role in a branch, signed in. */
interface Person {
  readonly role: Role;
  readonly accountId: string;
  readonly cookie: string;
  readonly branch: BranchOfRun;
  /** A Teacher's staff record and a lesson of theirs begun this morning. */
  readonly staffId?: string;
  readonly lessonToday?: string;
}

const as = (person: Person) => {
  const server = t.kit.server;
  return {
    get: (path: string) =>
      request(server).get(path).set('Cookie', person.cookie).set(BRANCH_HEADER, person.branch.id),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(path)
        .set('Cookie', person.cookie)
        .set(BRANCH_HEADER, person.branch.id)
        .set(REQUEST_KEY_HEADER, crypto.randomUUID())
        .send(body),
    put: (path: string, body: object) =>
      request(server)
        .put(path)
        .set('Cookie', person.cookie)
        .set(BRANCH_HEADER, person.branch.id)
        .send(body),
  };
};

describe(`the speed run, ${size.name} (task 10.1)`, () => {
  it(
    'meets every target of 12 on a year of data, alone and under load',
    async () => {
      const startedAt = performance.now();
      const school: School = await buildSchool(t, size);
      const timings: Timing[] = [];
      const fills: { branch: string; filled: Filled }[] = [];
      const notes: string[] = [];
      let load: LoadTimes = {};
      let counts = { lessons: 0, cells: 0, history: 0 };
      let lockCount = 0;

      const write = async (failure: string | null) => {
        await writeFile(
          REPORT,
          report({
            failure,
            school,
            timings,
            fills,
            counts,
            load,
            notes,
            lockCount,
            machine: await machineOf(t),
            total: (performance.now() - startedAt) / 1000,
          }),
        );
      };
      /** A read timed and, at triple size, asserted on its slowest repeat. */
      const measure = async (
        what: string,
        target: number,
        work: () => Promise<{ status: number; body: unknown }>,
      ) => {
        const runs = await timed(size.repeats, async () => {
          const response = await work();
          expect(response.status, `${what}: ${JSON.stringify(response.body)}`).toBeLessThan(300);
          return response;
        });
        timings.push({ what, target: `under ${String(target / 1000)} s`, runs: runs.runs });
        if (TRIPLE) expect(Math.max(...runs.runs), what).toBeLessThan(target);
        return runs.last;
      };

      try {
        // Placed, checked and published branch by branch, as the real-size run does.
        for (const branch of school.branches) {
          const placed = await placeDraft(t, branch);
          expect(placed.notPlaced, `${branch.name}: lessons not placed`).toEqual([]);
          expect(placed.doubles, `${branch.name}: doubles placed`).toBeGreaterThan(0);
          const readiness = (await confirmSteps(t, branch)) as { ready: boolean };
          expect(readiness.ready, `${branch.name}: ${JSON.stringify(readiness)}`).toBe(true);
          const board = await timed(size.repeats, () => gridOf(t, branch));
          timings.push({
            what: `${branch.name}: open the board of the draft`,
            target: 'under 1 s',
            runs: board.runs,
          });
          if (TRIPLE) expect(Math.max(...board.runs), 'open the board').toBeLessThan(TARGET.page);
          const move = moveCheck(board.last, size.repeats);
          timings.push({
            what: `${branch.name}: check a move at every slot of the week (${String(move.slots)} slots)`,
            target: 'under 0.2 s',
            runs: move.runs,
          });
          if (TRIPLE) expect(Math.max(...move.runs), 'check a move').toBeLessThan(TARGET.move);
          // The narrowed check equals the full one at every slot of one block (plan, Fixes).
          expect(sameAsFull(board.last), `${branch.name}: narrowed and full check`).toBe(true);
          const vice = asVice(t, branch);
          const check = await timed(size.repeats, async () => {
            const response = await vice.get(
              `/api/timetable/versions/${branch.version}/publish-check?startsOn=${RUN_START}`,
            );
            expect(response.status, JSON.stringify(response.body)).toBe(200);
            return response.body as PublishCheck;
          });
          // Answer 5 of the owner: the publish check's gap is accepted and reported.
          timings.push({
            what: `${branch.name}: publish check`,
            target: 'reported (1 s, gap accepted)',
            runs: check.runs,
          });
          expect(checkStops(check.last)).toEqual({ refusals: 0, blocked: 0 });
          const published = await once(() =>
            vice.post(`/api/timetable/versions/${branch.version}/publish`, { startsOn: RUN_START }),
          );
          expect(published.last.status, JSON.stringify(published.last.body)).toBe(200);
          timings.push({
            what: `${branch.name}: publish`,
            target: 'under 60 s',
            runs: published.runs,
          });
          expect(Math.max(...published.runs), 'publish').toBeLessThan(60_000);
        }
        lockCount = await doublePairs(t);

        // The measuring day: the clock and the sessions move to it.
        t.clock.set(new Date(SPEED_CLOCK).toISOString());
        await t.database.migrator
          .updateTable('sessions')
          .set({ created_at: new Date(SPEED_CLOCK), last_used_at: new Date(SPEED_CLOCK) })
          .execute();
        const people = new Map<string, Person[]>();
        for (const branch of school.branches) people.set(branch.id, await peopleOf(t, branch));
        // The whole year at triple size; quarter 4 only in the small run, so a
        // pull request's run stays short (the filler's rate still shows).
        const filled = await fillJournals(
          t,
          school.branches.map((branch) => ({
            branch,
            writer: (people.get(branch.id) ?? [])[0]?.accountId ?? '',
          })),
          { from: TRIPLE ? RUN_START : (QUARTERS[3]?.[0] ?? RUN_START) },
        );
        for (const branch of school.branches) {
          const one = filled.get(branch.id);
          if (one !== undefined) fills.push({ branch: branch.name, filled: one });
        }
        const written = fills.reduce((sum, one) => sum + one.filled.cells, 0);
        const seconds = fills[0]?.filled.seconds ?? 0;
        notes.push(
          `The filler wrote ${String(written)} cells in ${seconds.toFixed(0)} s (${(written / Math.max(seconds, 0.001)).toFixed(0)} cells a second, the triggers on).`,
        );
        t.clock.set(new Date(SPEED_CLOCK).toISOString());
        counts = await journalCounts(t);
        expect(counts.cells, 'cells written').toBeGreaterThan(0);
        expect(counts.history, 'a history line per cell, and the corrections').toBeGreaterThan(
          counts.cells,
        );

        for (const branch of school.branches) {
          const own = people.get(branch.id) ?? [];
          const person = (role: Role) => {
            const found = own.find((one) => one.role === role);
            if (found === undefined) throw new Error(`No ${role} in ${branch.name}.`);
            return found;
          };
          const ids = await idsOf(t, branch, person('teacher'));

          // Open any page: under 1 s (the reads of a page together, as the browser sends them).
          for (const [page, { role, reads }] of Object.entries(PAGE_READS)) {
            const api = as(person(role));
            await measure(`${branch.name}: open ${page} (${role})`, TARGET.page, async () => {
              const paths = reads(ids);
              const answers = await Promise.all(paths.map((path) => api.get(path)));
              const failed = answers.findIndex((one) => one.status >= 300);
              const answer = answers[failed];
              return answer === undefined
                ? { status: 200, body: null }
                : {
                    status: answer.status,
                    body: { path: paths[failed], answer: answer.body as unknown },
                  };
            });
          }

          // Open a journal for a quarter: under 1 s.
          const journal = await busiestJournal(t, branch, ids.quarter3);
          await measure(
            `${branch.name}: open a journal for quarter 3 (${String(journal.lessons)} lessons)`,
            TARGET.journal,
            () =>
              as(person('academic_vice_principal')).get(
                `/api/journal/journals/${journal.id}?quarterId=${ids.quarter3}`,
              ),
          );

          // Save a journal cell: under 0.3 s, on a lesson of today as its teacher.
          const teacher = as(person('teacher'));
          const lesson = ids.lessonToday;
          const [first = '', second = ''] = await expectedOf(t, lesson);
          // Each save sends the version the last one answered, as the grid does;
          // present and late in turn, so every save changes the cell.
          let version: number | null = null;
          let mark: 1 | 2 = 2;
          await measure(`${branch.name}: save one attendance cell`, TARGET.save, async () => {
            mark = mark === 1 ? 2 : 1;
            const response = await teacher.post(`/api/journal/lessons/${lesson}/attendance`, {
              saves: [{ studentId: first, mark, version }],
            });
            version = (response.body as AttendanceSaved).cells[0]?.version ?? null;
            return response;
          });
          await measure(`${branch.name}: all present for a class`, TARGET.save, () =>
            teacher.post(`/api/journal/lessons/${lesson}/all-present`),
          );
          const work = await teacher.post(`/api/journal/lessons/${lesson}/works`, {
            kind: 'classwork',
          });
          expect(work.status, JSON.stringify(work.body)).toBeLessThan(300);
          const added = work.body as WorkSaved;
          const total = await teacher.put(`/api/journal/lessons/${lesson}/works/total`, {
            column: { workId: added.id },
            total: 30,
            version: added.version,
          });
          expect(total.status, JSON.stringify(total.body)).toBeLessThan(300);
          let scoreVersion: number | null = null;
          let score = 0;
          await measure(`${branch.name}: save a score`, TARGET.save, async () => {
            score = (score + 1) % 30;
            const response = await teacher.post(`/api/journal/lessons/${lesson}/scores`, {
              saves: [
                { studentId: second, column: { workId: added.id }, score, version: scoreVersion },
              ],
            });
            scoreVersion = (response.body as ScoresSaved).cells[0]?.version ?? null;
            return response;
          });

          // Open a report: under 2 s.
          const reports: [string, Person, string][] = [
            [
              'the rating of the classes',
              person('academic_vice_principal'),
              `/api/results/rating/classes?quarterId=${ids.quarter}`,
            ],
            [
              'the rating list of a class',
              person('academic_vice_principal'),
              `/api/results/rating/class?quarterId=${ids.quarter}&classId=${ids.classId}`,
            ],
            [
              'the early-warning list',
              person('academic_vice_principal'),
              '/api/results/early-warning',
            ],
            ['the branch summary', person('principal'), '/api/results/branch-summary'],
            ['attendance today', person('head_tutor'), '/api/journal/attendance-today'],
            [
              'the conflicts summary',
              person('academic_vice_principal'),
              '/api/timetable/conflicts-summary',
            ],
            [
              'the lessons of today',
              person('academic_vice_principal'),
              '/api/journal/lessons-today',
            ],
            [
              'the counts per teacher of quarter 4',
              person('academic_vice_principal'),
              `/api/journal/discipline?from=${ids.quarterStart}&to=${ids.date}`,
            ],
            ['the audit log', person('academic_vice_principal'), '/api/audit/entries'],
          ];
          for (const [what, who, path] of reports) {
            await measure(`${branch.name}: ${what}`, TARGET.report, () => as(who).get(path));
          }
          await measure(
            `${branch.name}: the personal-data report of a student`,
            TARGET.report,
            () => as(person('super_admin')).post(`/api/people/students/${ids.studentId}/report`),
          );

          // Search: under 0.2 s, with two, four and seven typed characters.
          for (const kind of ['students', 'staff', 'relatives', 'classes', 'groups']) {
            for (const typed of [
              ids.name.slice(0, 2),
              ids.name.slice(0, 4),
              ids.name.slice(0, 7),
            ]) {
              await measure(`${branch.name}: search ${kind} for "${typed}"`, TARGET.search, () =>
                as(person('academic_vice_principal')).get(
                  `/api/search/${kind}?q=${encodeURIComponent(typed)}`,
                ),
              );
            }
          }
        }

        // Load: the people of the school at once, with the same times.
        const loadPeople: LoadPerson[] = [];
        for (const branch of school.branches) {
          const ids = await idsOf(
            t,
            branch,
            (people.get(branch.id) ?? []).find((one) => one.role === 'teacher') ?? null,
          );
          for (const one of people.get(branch.id) ?? []) {
            if (!['teacher', 'tutor', 'head_teacher', 'academic_vice_principal'].includes(one.role))
              continue;
            loadPeople.push({
              role: one.role,
              accountId: one.accountId,
              branchId: branch.id,
              // A Teacher saves on a lesson of their own and reads their own week.
              actions: actionsOf(one.role, {
                ...ids,
                lessonToday: one.lessonToday ?? '',
                teacherStaffId: one.staffId ?? ids.teacherStaffId,
              }),
            });
          }
        }
        const users = await writeSessions(
          t.database.migrator,
          loadPeople,
          LOAD.users,
          new Date(SPEED_CLOCK),
        );
        load = await runLoad(t.kit.server, users, LOAD);
        for (const [name, times] of Object.entries(load)) {
          expect(times.runs.length, `${name}: ran`).toBeGreaterThan(0);
          expect(times.failures, `${name}: ${JSON.stringify(times.statuses)}`).toBe(0);
          if (TRIPLE)
            expect(percentile95(times.runs), `${name} under load`).toBeLessThan(targetOf(name));
        }
      } catch (error) {
        await write(error instanceof Error ? error.message : String(error));
        throw error;
      }
      await write(null);
    },
    LIMIT,
  );
});

/** The ids the measures of a branch name. */
async function idsOf(t: DayTemplatesKit, branch: BranchOfRun, teacher: Person | null) {
  const migrator = t.database.migrator;
  const quarters = await migrator
    .selectFrom('quarters')
    .select(['id', 'number', sql<string>`start_date::text`.as('start')])
    .where('academic_year_id', '=', branch.year)
    .orderBy('number')
    .execute();
  const classId = branch.classes[0]?.id ?? '';
  const student = await migrator
    .selectFrom('class_memberships')
    .innerJoin('students', 'students.id', 'class_memberships.student_id')
    .select(['students.id', 'students.last_name'])
    .where('class_memberships.class_id', '=', classId)
    .orderBy('students.id')
    .executeTakeFirstOrThrow();
  return {
    quarter: quarters[3]?.id ?? '',
    quarter3: quarters[2]?.id ?? '',
    quarterStart: quarters[3]?.start ?? '',
    date: SPEED_CLOCK.slice(0, 10),
    classId,
    studentId: student.id,
    name: student.last_name,
    teacherStaffId: teacher?.staffId ?? branch.teachers[0] ?? '',
    lessonToday: teacher?.lessonToday ?? '',
  };
}

/**
 * The people of a branch, signed in at the measuring day: an Academic Vice
 * Principal, a Principal, a Head Tutor, a Head Teacher of Mathematics, a Super
 * Admin, Teachers who had a lesson this morning (their staff records given
 * the account) and a Tutor of the first class. Invented names only.
 */
async function peopleOf(t: DayTemplatesKit, branch: BranchOfRun): Promise<Person[]> {
  const migrator = t.database.migrator;
  const classes = new LoadKit(migrator).classes;
  const people: Person[] = [];
  const signIn = async (role: Role, extra: { subjectIds?: string[]; staffId?: string } = {}) => {
    const index = people.length;
    const browser = await t.kit.completeSession('Zarina', `Speedova${'a'.repeat(index % 5)}`);
    if (extra.staffId !== undefined) {
      await migrator
        .updateTable('staff')
        .set({ account_id: browser.account.id })
        .where('id', '=', extra.staffId)
        .execute();
    }
    const assignment = await t.kit.giveRole(browser.account.id, {
      role,
      ...(role === 'super_admin' ? {} : { branchId: branch.id }),
      ...(extra.subjectIds === undefined ? {} : { subjectIds: extra.subjectIds }),
    });
    return { browser, assignment };
  };
  const add = async (role: Role, extra: { subjectIds?: string[]; staffId?: string } = {}) => {
    const { browser, assignment } = await signIn(role, extra);
    const person = { role, accountId: browser.account.id, cookie: browser.cookie, branch };
    people.push(person);
    return { person, assignment };
  };
  await add('academic_vice_principal');
  await add('principal');
  await add('head_tutor');
  await add('super_admin');
  const mathematics = await migrator
    .selectFrom('subjects')
    .select('id')
    .where('name_en', '=', 'Mathematics')
    .executeTakeFirstOrThrow();
  await add('head_teacher', { subjectIds: [mathematics.id] });
  // Teachers with a whole-class lesson begun this morning, the earliest first.
  const morning = await migrator
    .selectFrom('lessons')
    .select(['id', 'teacher_id', 'class_id'])
    .where('branch_id', '=', branch.id)
    .where('lesson_date', '=', SPEED_CLOCK.slice(0, 10))
    .where('starts_at', '<', new Date(SPEED_CLOCK))
    .where('class_id', 'is not', null)
    .where('cancel_cause', 'is', null)
    .orderBy('starts_at')
    .orderBy('id')
    .execute();
  // A teacher of two branches given an account in the first keeps it (`staff_account_link_fixed`).
  const linked = new Set(
    (
      await migrator
        .selectFrom('staff')
        .select('id')
        .where('id', 'in', [...branch.teachers])
        .where('account_id', 'is not', null)
        .execute()
    ).map((one) => one.id),
  );
  const teachers = new Map<string, string>();
  for (const lesson of morning) {
    const staffId = lesson.teacher_id;
    if (staffId !== null && !teachers.has(staffId) && !linked.has(staffId)) {
      teachers.set(staffId, lesson.id);
    }
  }
  const wanted = TRIPLE ? 20 : 3;
  for (const [staffId, lessonId] of [...teachers].slice(0, wanted)) {
    const { person } = await add('teacher', { staffId });
    people[people.indexOf(person)] = { ...person, staffId, lessonToday: lessonId };
  }
  const tutorStaff = branch.teachers.find((id) => !teachers.has(id) && !linked.has(id));
  const tutor = await add('tutor', tutorStaff === undefined ? {} : { staffId: tutorStaff });
  await classes.tutorRow(branch.id, branch.classes[0]?.id ?? '', tutor.assignment.id, {
    from: new Date(SPEED_CLOCK),
    givenBy: people[0]?.accountId ?? '',
  });
  return people;
}

/** The journal of the branch with the most lessons in the quarter. */
async function busiestJournal(
  t: DayTemplatesKit,
  branch: BranchOfRun,
  quarterId: string,
): Promise<{ id: string; lessons: number }> {
  const found = await sql<{ id: string; lessons: number }>`
    select j.id, count(*)::int as lessons
    from journals j
    join quarters q on q.id = ${quarterId}::uuid
    join lessons l on l.subject_id = j.subject_id
      and (l.class_id = j.class_id or l.group_id = j.group_id)
      and l.lesson_date between q.start_date and q.end_date
    where j.branch_id = ${branch.id}::uuid
    group by j.id
    order by lessons desc, j.id
    limit 1
  `.execute(t.database.migrator);
  const row = found.rows[0];
  if (row === undefined) throw new Error(`No journal in ${branch.name}.`);
  return row;
}

/** The expected students of a lesson (`lesson_expected_students`), in id order. */
async function expectedOf(t: DayTemplatesKit, lessonId: string): Promise<string[]> {
  const found = await sql<{ id: string }>`
    select s.id from lesson_expected_students(${lessonId}::uuid) as s(id) order by s.id
  `.execute(t.database.migrator);
  return found.rows.map((one) => one.id);
}

/** The most double pairs of a branch's dated lessons: the pair locks its publish took (5.12d). */
async function doublePairs(t: DayTemplatesKit): Promise<number> {
  const found = await sql<{ n: number }>`
    select coalesce(max(n), 0)::int as n from (
      select count(distinct double_pair_id) as n from lesson_blocks
      where double_pair_id is not null group by branch_id
    ) per_branch
  `.execute(t.database.migrator);
  return found.rows[0]?.n ?? 0;
}

/**
 * The narrowed `checkCandidates` against the full check filtered to the
 * candidate, at every lesson slot of the week of one block (plan, Fixes: the
 * speed run asserts both equal).
 */
function sameAsFull(grid: GridAnswer): boolean {
  const model = patternModel(grid.facts);
  const blocks: PatternBlock[] = grid.blocks;
  const block = blocks.find((one) => one.lessons.length === 1) ?? blocks[0];
  if (block === undefined) return true;
  const placements = checkedPlacements(model, blocks);
  const rows = block.lessons.map((one) => model.rowOf(one.loadRowId));
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const slot of model.dayOfRows(rows, weekday)?.slots ?? []) {
      if (slot.kind !== 'lesson') continue;
      const moved = {
        ...block,
        weekday,
        slotPosition: slot.position,
        start: slot.start,
        end: slot.end,
      };
      const candidates = patternPlacements(model, [moved]);
      const ids = new Set(candidates.map((one) => one.id));
      const full = checkTimetable(
        [...placements.filter((one) => !ids.has(one.id)), ...candidates],
        model.facts,
      ).filter((result) => result.lessonIds.some((id) => ids.has(id)));
      const narrowed = checkCandidates(placements, model.facts, candidates);
      if (JSON.stringify(full) !== JSON.stringify(narrowed)) return false;
    }
  }
  return true;
}

/** The actions of a role under load (plan, Load: the mix of a role). */
function actionsOf(role: Role, ids: Awaited<ReturnType<typeof idsOf>>): LoadAction[] {
  const get = (name: string, path: string): LoadAction => ({ name, method: 'GET', path });
  const search = get(
    'search students',
    `/api/search/students?q=${encodeURIComponent(ids.name.slice(0, 4))}`,
  );
  const classWeek = get(
    'the published week of a class',
    `/api/timetable/views/class?date=${ids.date}&span=week&classId=${ids.classId}`,
  );
  if (role === 'teacher') {
    return [
      get('home (teacher)', '/api/timetable/home'),
      get('the journals list', '/api/journal/journals'),
      ...(ids.lessonToday === ''
        ? []
        : [
            {
              name: 'save all present',
              method: 'POST' as const,
              path: `/api/journal/lessons/${ids.lessonToday}/all-present`,
            },
          ]),
      search,
      get(
        'the published week of a teacher',
        `/api/timetable/views/teacher?date=${ids.date}&span=week&staffId=${ids.teacherStaffId}`,
      ),
    ];
  }
  if (role === 'tutor') {
    return [get('home (tutor)', '/api/journal/attendance-today'), search, classWeek];
  }
  if (role === 'head_teacher') {
    // Head Teachers see no class's week (`views.service.ts`, the scope table).
    return [
      get('the journals list', '/api/journal/journals'),
      get('home (head teacher)', '/api/journal/reminders'),
      search,
    ];
  }
  return [
    get('home (vice principal)', '/api/timetable/conflicts-summary'),
    get('report: the early-warning list', '/api/results/early-warning'),
    get(
      'report: the rating of the classes',
      `/api/results/rating/classes?quarterId=${ids.quarter}`,
    ),
    search,
    classWeek,
  ];
}

/** The target of an action under load, by its name. */
function targetOf(name: string): number {
  if (name.startsWith('save')) return TARGET.save;
  if (name.startsWith('search')) return TARGET.search;
  if (name.startsWith('report')) return TARGET.report;
  return TARGET.page;
}

const ms = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)} ms`;

/** Three times the estimate of `edge/system-behaviour`, Data volume, at its lower end. */
const BAR = { lessons: 510_000, cells: 24_000_000, history: 45_000_000 };

function report(input: {
  failure: string | null;
  school: School;
  timings: readonly Timing[];
  fills: readonly { branch: string; filled: Filled }[];
  counts: { lessons: number; cells: number; history: number };
  load: LoadTimes;
  notes: readonly string[];
  lockCount: number;
  machine: string;
  total: number;
}): string {
  const classes = input.school.branches.reduce((sum, one) => sum + one.classes.length, 0);
  return [
    `# Speed run (${size.name})`,
    '',
    `Run by \`apps/api/src/modules/timetable/speed.database.test.ts\` (\`SPEED_SIZE=${size.name}\`). Published from ${RUN_START}; journals filled to ${FILLED_UNTIL} (${String(DENSITY.classworks)} classworks a lesson, a homework every second lesson, ${String(DENSITY.corrections)} % of the scores corrected once); measured at ${SPEED_CLOCK}. Machine: ${input.machine}; one API process and its database on one machine.`,
    '',
    ...(input.failure === null
      ? []
      : [
          '## Stopped',
          '',
          `The run stopped at a failed step: ${input.failure.split('\n')[0] ?? ''}`,
          '',
        ]),
    '## Data',
    '',
    '| | Reached | Three times the estimate (`edge/system-behaviour`) |',
    '| --- | --- | --- |',
    `| Branches, classes, students | ${String(input.school.branches.length)}, ${String(classes)}, ${String(input.school.students)} | |`,
    `| Dated lessons | ${String(input.counts.lessons)} | ${String(BAR.lessons)} |`,
    `| Journal cells | ${String(input.counts.cells)} | ${String(BAR.cells)} |`,
    `| Cell history entries | ${String(input.counts.history)} | ${String(BAR.history)} |`,
    `| Double pairs of the busiest branch (pair locks of its publish) | ${String(input.lockCount)} | |`,
    '',
    ...input.fills.map(
      (one) =>
        `- ${one.branch}: ${String(one.filled.days)} school days, ${String(one.filled.lessons)} lessons filled.`,
    ),
    ...input.notes.map((note) => `- ${note}`),
    '',
    '## Times',
    '',
    `Each read timed ${String(size.repeats)} times after one warm-up; a write once. ${TRIPLE ? 'Asserted on the slowest.' : 'Not asserted in the small run.'}`,
    '',
    '| Measure | Target (`12`) | Median | Slowest |',
    '| --- | --- | --- | --- |',
    ...input.timings.map(
      (one) =>
        `| ${one.what} | ${one.target} | ${ms(median(one.runs))} | ${ms(Math.max(...one.runs))} |`,
    ),
    '',
    `## Under load (${String(LOAD.users)} users for ${String(LOAD.durationMs / 1000)} s, ${String(LOAD.gapMs[0] / 1000)} to ${String(LOAD.gapMs[1] / 1000)} s between actions)`,
    '',
    '| Action | Target | Requests | Median | 95th percentile | Answers |',
    '| --- | --- | --- | --- | --- | --- |',
    ...Object.entries(input.load).map(
      ([name, times]) =>
        `| ${name} | under ${String(targetOf(name) / 1000)} s | ${String(times.runs.length)} | ${ms(median(times.runs))} | ${ms(percentile95(times.runs))} | ${JSON.stringify(times.statuses)} |`,
    ),
    '',
    `The whole run took ${input.total.toFixed(0)} s.`,
    '',
  ].join('\n');
}
