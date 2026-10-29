import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import {
  BRANCH_HEADER,
  HOME_KINDS,
  MENU_ITEMS,
  REQUEST_KEY_HEADER,
  type AttendanceSaved,
  type GridAnswer,
  type PreparedStamp,
  type PublishCheck,
  type Role,
  type ScoresSaved,
  type WorkSaved,
} from '@sodiq/shared';
import {
  candidateChecker,
  checkCandidates,
  checkTimetable,
  checkedPlacements,
  patternModel,
  patternPlacements,
  type PatternBlock,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  attachedKit,
  dayTemplatesKit,
  type AppKit,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import {
  inputsNotWatched,
  prepareBranch,
  tablesReadByPreparation,
  withoutStamp,
} from '../../testing/prepared-kit.js';
import { QUARTERS } from '../../testing/published-scene.js';
import { PreparedTotals } from '../results/prepared/prepare.job.js';
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
  movableBlock,
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
import { Deadline, speedPhaseOf } from '../../testing/speed-phases.js';
import { QuerySpans } from '../../testing/speed-spans.js';

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
 * `SPEED_SIZE=full` runs the school's own size the same way, by hand, and
 * reports the times without asserting them.
 */

const SIZE_NAME = process.env.SPEED_SIZE;
const size = SIZES[SIZE_NAME === 'triple' || SIZE_NAME === 'full' ? SIZE_NAME : 'small'];
/** The times are asserted at three times the data only. */
const TRIPLE = size.name === 'triple';
/** The whole year filled and the 1,000 users: every size but the small one. */
const LARGE = size.name !== 'small';
const LIMIT = LARGE ? 5 * 60 * 60_000 : 10 * 60_000;
const REPORT = resolve(import.meta.dirname, `../../../speed-report-${size.name}.md`);
/**
 * Task 10.1b: the phase of this process (`speed-phases.ts`). The build phase leaves its database
 * under `KEPT` and the state of the run in `STATE` (both git-ignored); the measuring phase reads
 * them back, the database restored by the Speed workflow under `SPEED_DATABASE`.
 */
const PHASE = speedPhaseOf(process.env.SPEED_PHASE);
const STATE = resolve(import.meta.dirname, `../../../speed-state-${size.name}.json`);
const KEPT = `sodiq_speed_${size.name}`;
/** The queries of the measuring phase, for where the time of a missed target went. */
const spans = new QuerySpans();
const LOAD = LARGE
  ? { users: 1000, durationMs: 10 * 60_000, gapMs: [5000, 15000] as const }
  : { users: 10, durationMs: 20_000, gapMs: [500, 1500] as const };

/** The targets of `12`, Speed targets, in milliseconds. */
const TARGET = { page: 1000, journal: 1000, save: 300, move: 200, report: 2000, search: 200 };

/**
 * The first read of every page of the left menu (`MENU_ITEMS`) and of every
 * home page (`HOME_KIND`), as the role that opens it: what the page asks the
 * server before it can draw (plan, "Open any page"), and the pages under a
 * menu item the plan names (`setup/rooms`: the item, then the page). A test
 * holds it complete against the menu. The home of the roles of a later
 * release has no read.
 */
type MenuItem = (typeof MENU_ITEMS)[number];
type PageKey = MenuItem | `home:${(typeof HOME_KINDS)[number]}` | `${MenuItem}/${string}`;

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
  'setup/rooms': { role: 'academic_vice_principal', reads: () => ['/api/setup/rooms'] },
  'setup/subjects': { role: 'academic_vice_principal', reads: () => ['/api/setup/subjects'] },
  'setup/settings': { role: 'academic_vice_principal', reads: () => ['/api/setup/settings'] },
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

/** The kit of the build phase; `t` is the kit of the phase running now. */
let builder: DayTemplatesKit | undefined;
let t: AppKit;

beforeAll(async () => {
  if (PHASE === 'measure') {
    t = await attachedKit(process.env.SPEED_DATABASE ?? KEPT, {
      start: SPEED_CLOCK,
      drop: false,
      log: spans.log,
    });
    return;
  }
  // The job queue: an exemption's notice is a job (`Notifications.send`). Kept after the build
  // phase: under its own name for the workflow's dump, under the run's prefix when both phases
  // run here (dropped by the measuring phase, or with the run's databases).
  builder = await dayTemplatesKit({
    start: RUN_CLOCK,
    jobs: true,
    kept: PHASE === 'build' ? KEPT : `${inject('testRunPrefix')}speed`,
  });
  t = builder;
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
    const keys = Object.keys(PAGE_READS);
    expect(keys.filter((key) => !key.includes('/')).sort()).toEqual(pages.sort());
    // A page under an item is under one of the menu.
    for (const key of keys.filter((one) => one.includes('/'))) {
      expect(MENU_ITEMS, key).toContain(key.slice(0, key.indexOf('/')));
    }
  });
});

/**
 * What the build phase hands to the measuring phase, as JSON: the school, its people signed in
 * (their sessions are rows of the handed database), and what the build measured. Invented data only.
 */
/** The queries behind a measure that missed its target (task 10.1b, Step 1 of the plan). */
interface Breakdown {
  readonly what: string;
  /** The requests the queries were summed over: the first run and the timed ones. */
  readonly runs: number;
  readonly queries: number;
  readonly ms: number;
  readonly slowest: readonly { text: string; count: number; ms: number }[];
}

interface SpeedState {
  readonly school: School;
  readonly people: Record<string, Person[]>;
  readonly timings: Timing[];
  readonly fills: { branch: string; filled: Filled }[];
  readonly notes: string[];
  counts: { lessons: number; cells: number; history: number };
  lockCount: number;
  buildSeconds: number;
}

/** A person of the speed run: an account with one role in a branch, signed in. */
interface Person {
  readonly role: Role;
  readonly accountId: string;
  readonly cookie: string;
  readonly branch: BranchOfRun;
  /** A Teacher's staff record and a lesson of theirs begun this morning. */
  readonly staffId?: string;
  readonly lessonToday?: string;
  /** The journal of that lesson. */
  readonly journalToday?: string;
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
      // The run stops itself before Vitest would (ten minutes at the large sizes, one in the small
      // run), writes its report and fails with the steps it did not reach (task 10.1b: a timeout
      // wrote nothing).
      const deadline = new Deadline(startedAt + LIMIT - (LARGE ? 10 : 1) * 60_000);
      let state: SpeedState;
      let load: LoadTimes = {};
      const breakdown: Breakdown[] = [];

      const write = async (failure: string | null, written?: string) => {
        await writeFile(
          REPORT,
          report({
            failure,
            written: written ?? null,
            phase: PHASE,
            school: state.school,
            timings: state.timings,
            fills: state.fills,
            counts: state.counts,
            load,
            breakdown,
            notes: state.notes,
            lockCount: state.lockCount,
            machine: await machineOf(t),
            total: state.buildSeconds + (performance.now() - startedAt) / 1000,
          }),
        );
      };
      /** A read timed and, at triple size, asserted on its slowest repeat. */
      const measure = async (
        what: string,
        target: number,
        work: () => Promise<{ status: number; body: unknown }>,
      ) => {
        deadline.check(what);
        const checked = async () => {
          const response = await work();
          expect(response.status, `${what}: ${JSON.stringify(response.body)}`).toBeLessThan(300);
          return response;
        };
        // A read whose first run is already over five times its target is timed once: its
        // repeats would hold the run for hours and tell nothing more.
        spans.reset();
        const started = performance.now();
        const first = await checked();
        const once = performance.now() - started;
        const runs =
          once > 5 * target ? { runs: [once], last: first } : await timed(size.repeats, checked);
        state.timings.push({ what, target: `under ${String(target / 1000)} s`, runs: runs.runs });
        if (Math.max(...runs.runs) >= target) {
          breakdown.push({ what, runs: runs.runs.length + 1, ...spans.summary(5) });
        }
        if (TRIPLE) expect.soft(Math.max(...runs.runs), what).toBeLessThan(target);
        return runs.last;
      };

      try {
        if (PHASE === 'measure') {
          state = JSON.parse(await readFile(STATE, 'utf8')) as SpeedState;
        } else {
          state = await buildPhase();
          await writeFile(STATE, JSON.stringify(state));
          if (PHASE === 'build') {
            await write(null, 'the build phase');
            return;
          }
          // Both phases in one process (a pull request): the same hand-over as the workflow's.
          state = JSON.parse(await readFile(STATE, 'utf8')) as SpeedState;
          const built = t.database.name;
          await t.close();
          t = await attachedKit(built, { start: SPEED_CLOCK, drop: true, log: spans.log });
        }
        await measurePhase();
      } catch (error) {
        await write(error instanceof Error ? error.message : String(error));
        throw error;
      }
      await write(null);

      /** Build, place, publish, sign in, fill: the data the measuring phase reads. */
      async function buildPhase(): Promise<SpeedState> {
        if (builder === undefined) throw new Error('The build phase has no kit.');
        const school: School = await buildSchool(builder, size);
        const people: Record<string, Person[]> = {};
        let counts = { lessons: 0, cells: 0, history: 0 };
        state = {
          school,
          people,
          timings: [],
          fills: [],
          notes: [],
          counts,
          lockCount: 0,
          buildSeconds: 0,
        };
        const { timings, fills, notes } = state;
        // Placed, checked and published branch by branch, as the real-size run does.
        for (const branch of school.branches) {
          const placed = await placeDraft(t, branch);
          expect(placed.notPlaced, `${branch.name}: lessons not placed`).toEqual([]);
          expect(placed.doubles, `${branch.name}: doubles placed`).toBeGreaterThan(0);
          const readiness = (await confirmSteps(t, branch)) as { ready: boolean };
          expect(readiness.ready, `${branch.name}: ${JSON.stringify(readiness)}`).toBe(true);
          deadline.check(`${branch.name}: open the board`);
          const board = await timed(size.repeats, () => gridOf(t, branch));
          timings.push({
            what: `${branch.name}: open the board of the draft`,
            target: 'under 1 s',
            runs: board.runs,
          });
          if (TRIPLE)
            expect.soft(Math.max(...board.runs), 'open the board').toBeLessThan(TARGET.page);
          const move = moveCheck(board.last, size.repeats);
          timings.push({
            what: `${branch.name}: check a move at every slot of the week (${String(move.slots)} slots)`,
            target: 'under 0.2 s',
            runs: move.runs,
          });
          if (TRIPLE) expect.soft(Math.max(...move.runs), 'check a move').toBeLessThan(TARGET.move);
          // The narrowed check equals the full one at every slot of one block (plan, Fixes).
          expect(sameAsFull(board.last), `${branch.name}: narrowed and full check`).toBe(true);
          const vice = asVice(t, branch);
          // A saved move on the board and back, through the route (5.12c; plan, "Check a move").
          const target = movableBlock(board.last);
          expect(target, `${branch.name}: a block with a free slot to move to`).not.toBeNull();
          if (target !== null) {
            const moves: number[] = [];
            for (const to of [target.to, target.from]) {
              deadline.check(`${branch.name}: a saved move`);
              const moved = await once(() =>
                vice.post(
                  `/api/timetable/versions/${branch.version}/pattern/${target.blockId}/move`,
                  to,
                ),
              );
              expect(moved.last.status, JSON.stringify(moved.last.body)).toBe(200);
              moves.push(...moved.runs);
            }
            timings.push({
              what: `${branch.name}: a saved move (route, write)`,
              target: 'under 1 s',
              runs: moves,
            });
            if (TRIPLE) expect.soft(Math.max(...moves), 'a saved move').toBeLessThan(TARGET.page);
          }
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
            // `edge/system-behaviour`, "A publish takes a while": under 60 s for a branch
            // of the school's size; a branch of `triple` holds three, so it is reported.
            target: 'reported (60 s for a real branch)',
            runs: published.runs,
          });
        }
        state.lockCount = await doublePairs(t);

        // The measuring day: the clock and the sessions move to it.
        t.clock.set(new Date(SPEED_CLOCK).toISOString());
        await t.database.migrator
          .updateTable('sessions')
          .set({ created_at: new Date(SPEED_CLOCK), last_used_at: new Date(SPEED_CLOCK) })
          .execute();
        for (const branch of school.branches) people[branch.id] = await peopleOf(t, branch);
        // A few temporary exemptions per class before the year is filled, so the
        // readers' exemption paths are measured (the plan's data generator).
        let exemptions = 0;
        for (const branch of school.branches) {
          const vice = (people[branch.id] ?? []).find(
            (one) => one.role === 'academic_vice_principal',
          );
          if (vice !== undefined) exemptions += await exemptionsOf(t, branch, vice);
        }
        notes.push(`${String(exemptions)} temporary exemptions, two in each class.`);
        // The whole year at triple size; quarter 4 only in the small run, so a
        // pull request's run stays short (the filler's rate still shows).
        const filled = await fillJournals(
          t,
          school.branches.map((branch) => ({
            branch,
            writer: (people[branch.id] ?? [])[0]?.accountId ?? '',
          })),
          { from: LARGE ? RUN_START : (QUARTERS[3]?.[0] ?? RUN_START) },
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
        state.counts = counts;
        expect(counts.cells, 'cells written').toBeGreaterThan(0);
        expect(counts.history, 'a history line per cell, and the corrections').toBeGreaterThan(
          counts.cells,
        );

        state.buildSeconds = (performance.now() - startedAt) / 1000;
        return state;
      }

      /** Prepare, read, save, search and load, on the data of the build phase. */
      async function measurePhase(): Promise<void> {
        // Correction 1 of the plan review: the transaction ids of the change rows and of the
        // prepared rows belong to the cluster that built the data; after a restore into another
        // cluster they mean nothing, so the measuring phase starts with nothing prepared.
        await sql`truncate report_changes, report_prepared, report_prepared_lessons`.execute(
          t.database.migrator,
        );
        const { school, people, timings } = state;
        for (const branch of school.branches) {
          const own = people[branch.id] ?? [];
          const person = (role: Role) => {
            const found = own.find((one) => one.role === role);
            if (found === undefined) throw new Error(`No ${role} in ${branch.name}.`);
            return found;
          };
          const ids = await idsOf(t, branch, person('teacher'));

          // Task 9.3b-1, the prepared report totals: nothing is prepared yet, so every report
          // is calculated from source and says "updating"; the preparation reads only watched
          // inputs; once prepared, each report gives the same figures, "updated at" and not
          // updating; and a second preparation finds nothing behind.
          // Task 9.3b-2: the reports of `08` over the journal read the prepared units too.
          const reportChoices = (
            await as(person('academic_vice_principal')).get('/api/results/reports/choices')
          ).body as { subjects: { id: string }[] };
          const masteredSubject = reportChoices.subjects[0]?.id ?? '';
          const prepared: [string, Person, string][] = [
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
            [
              'the early-warning list of own journals',
              person('teacher'),
              '/api/results/early-warning?for=own_journals',
            ],
            ['the branch summary', person('principal'), '/api/results/branch-summary'],
            ['attendance today', person('head_tutor'), '/api/journal/attendance-today'],
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
            [
              'the attendance report of quarter 4',
              person('academic_vice_principal'),
              `/api/results/reports/attendance?from=${ids.quarterStart}&to=${ids.date}`,
            ],
            [
              'the results table of a class',
              person('academic_vice_principal'),
              `/api/results/reports/results-table?quarterId=${ids.quarter}&classId=${ids.classId}`,
            ],
            [
              'subject mastery',
              person('academic_vice_principal'),
              `/api/results/reports/subject-mastery?quarterId=${ids.quarter}&subjectId=${masteredSubject}`,
            ],
            // Task 10.1b: the closing checklist reads the prepared closing units.
            ['the closing checklist', person('academic_vice_principal'), '/api/results/closing'],
          ];
          // Task 10.1b, decision 1 (Look first): at triple size the passes from source, which hold
          // the prepared figures equal to the source, run on the first branch only, for the run's
          // time; every pull request runs them on every branch of the small school.
          const checked = !TRIPLE || branch === school.branches[0];
          const fromSource = new Map<string, unknown>();
          for (const [what, who, path] of checked ? prepared : []) {
            const response = await as(who).get(path);
            expect(response.status, `${what}: ${JSON.stringify(response.body)}`).toBe(200);
            const stamp = (response.body as { prepared: PreparedStamp }).prepared;
            expect(stamp, `${what}: before any preparation`).toEqual({
              updatedAt: null,
              updating: true,
            });
            fromSource.set(what, withoutStamp(response.body));
          }
          if (checked) {
            const read = await tablesReadByPreparation(t, branch.id);
            expect(
              await inputsNotWatched(t, read),
              `${branch.name}: the inputs of the preparation`,
            ).toEqual({
              unwatched: [],
              schoolInputsWithBranch: [],
              watchedWithoutBranch: [],
            });
          }
          const units = await once(() => prepareBranch(t, branch.id));
          timings.push({
            what: `${branch.name}: prepare every report total (${String(units.last)} units)`,
            target: 'reported',
            runs: units.runs,
          });
          expect(units.last, `${branch.name}: units prepared`).toBeGreaterThan(0);
          for (const [what, who, path] of checked ? prepared : []) {
            const response = await as(who).get(path);
            const stamp = (response.body as { prepared: PreparedStamp }).prepared;
            expect(stamp.updating, `${what}: after the preparation`).toBe(false);
            expect(stamp.updatedAt, `${what}: updated at`).toBe(
              new Date(SPEED_CLOCK).toISOString(),
            );
            expect(withoutStamp(response.body), `${what}: the same figures`).toEqual(
              fromSource.get(what),
            );
          }
          if (checked) {
            expect(await prepareBranch(t, branch.id), `${branch.name}: nothing behind`).toBe(0);
            // Plan decision 5, the named risk: right after a branch-wide change (a weight) every
            // unit is behind, and the reads are worked out from source until the next run.
            await t.database.migrator
              .updateTable('subject_quarter_weights')
              .set((eb) => ({ attendance: eb.ref('attendance') }))
              .where('branch_id', '=', branch.id)
              .execute();
            for (const [what, who, path] of prepared.slice(0, 3)) {
              const behind = await once(() => as(who).get(path));
              const stamp = (behind.last.body as { prepared: PreparedStamp }).prepared;
              expect(stamp.updating, `${what}: right after a weight change`).toBe(true);
              timings.push({
                what: `${branch.name}: ${what} right after a weight change (every unit behind)`,
                target: 'reported',
                runs: behind.runs,
              });
            }
            const again = await once(() => prepareBranch(t, branch.id));
            timings.push({
              what: `${branch.name}: prepare again after a weight change (${String(again.last)} units)`,
              target: 'reported',
              runs: again.runs,
            });
          }

          // Task 9.3b-2, decisions 9 and 10: the reports worked out on read, timed against `08`'s 2 s.
          const vice = as(person('academic_vice_principal'));
          await measure(`${branch.name}: the timetable load report of a week`, TARGET.report, () =>
            vice.get(`/api/timetable/reports/load?week=${ids.date}`),
          );
          for (const report of ['completeness', 'progress', 'requests']) {
            await measure(`${branch.name}: the plan report ${report}`, TARGET.report, () =>
              vice.get(`/api/plans/reports/${report}?quarterId=${ids.quarter}`),
            );
          }

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
            (people[branch.id] ?? []).find((one) => one.role === 'teacher') ?? null,
          );
          for (const one of people[branch.id] ?? []) {
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
                journalToday: one.journalToday ?? '',
                teacherStaffId: one.staffId ?? ids.teacherStaffId,
              }),
            });
          }
        }
        deadline.checkFor('the load', LOAD.durationMs + 60_000);
        const users = await writeSessions(
          t.database.migrator,
          loadPeople,
          LOAD.users,
          new Date(SPEED_CLOCK),
        );
        // Task 10.1b (review of the plan, finding 5): the preparation runs every minute during the
        // load, as the worker runs it on the live system, so the saves of the load put their own
        // units behind and the job catches up.
        const loading = runLoad(t.kit.server, users, LOAD);
        let done = false;
        const preparing = (async () => {
          let runs = 0;
          const started = performance.now();
          while (!done) {
            await t.app.get(PreparedTotals, { strict: false }).run();
            runs += 1;
            const next = started + runs * 60_000;
            while (!done && performance.now() < next) await delay(1000);
          }
          return runs;
        })();
        load = await loading.finally(() => {
          done = true;
        });
        state.notes.push(
          `Under load the preparation of the totals ran ${String(await preparing)} times, once a minute.`,
        );
        for (const [name, times] of Object.entries(load)) {
          expect(times.runs.length, `${name}: ran`).toBeGreaterThan(0);
          // At the large sizes every action is reported before the run fails.
          (LARGE ? expect.soft : expect)(
            times.failures,
            `${name}: ${JSON.stringify(times.statuses)}`,
          ).toBe(0);
          if (TRIPLE)
            expect
              .soft(percentile95(times.runs), `${name} under load`)
              .toBeLessThan(targetOf(name));
        }
      }
    },
    LIMIT,
  );
});

/** The ids the measures of a branch name. */
async function idsOf(t: AppKit, branch: BranchOfRun, teacher: Person | null) {
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
    journalToday: teacher?.journalToday ?? '',
  };
}

/** The Super Admin of the run, signed in with the first branch's people. */
let superAdmin: Person | undefined;

/**
 * The people of a branch, signed in at the measuring day: an Academic Vice
 * Principal, a Principal, a Head Tutor, a Head Teacher of Mathematics, a Super
 * Admin, Teachers who had a lesson this morning (their staff records given
 * the account) and a Tutor of the first class. Invented names only.
 */
async function peopleOf(t: AppKit, branch: BranchOfRun): Promise<Person[]> {
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
  // One Super Admin for the school (at most 3 accounts, `TooManySuperAdminsError`), in every branch.
  if (superAdmin === undefined) superAdmin = (await add('super_admin')).person;
  else people.push({ ...superAdmin, branch });
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
  const wanted = LARGE ? 20 : 3;
  for (const [staffId, lessonId] of [...teachers].slice(0, wanted)) {
    const { person } = await add('teacher', { staffId });
    const journal = await migrator
      .selectFrom('lessons')
      .innerJoin('journals', (join) =>
        join
          .onRef('journals.class_id', '=', 'lessons.class_id')
          .onRef('journals.subject_id', '=', 'lessons.subject_id'),
      )
      .select('journals.id')
      .where('lessons.id', '=', lessonId)
      .executeTakeFirst();
    people[people.indexOf(person)] = {
      ...person,
      staffId,
      lessonToday: lessonId,
      ...(journal === undefined ? {} : { journalToday: journal.id }),
    };
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
  t: AppKit,
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
async function expectedOf(t: AppKit, lessonId: string): Promise<string[]> {
  const found = await sql<{ id: string }>`
    select s.id from lesson_expected_students(${lessonId}::uuid) as s(id) order by s.id
  `.execute(t.database.migrator);
  return found.rows.map((one) => one.id);
}

/** The most double pairs of a branch's dated lessons: the pair locks its publish took (5.12d). */
async function doublePairs(t: AppKit): Promise<number> {
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
 * speed run asserts both equal), and the board's `candidateChecker` built once
 * for the drag.
 */
function sameAsFull(grid: GridAnswer): boolean {
  const model = patternModel(grid.facts);
  const blocks: PatternBlock[] = grid.blocks;
  const block = blocks.find((one) => one.lessons.length === 1) ?? blocks[0];
  if (block === undefined) return true;
  const placements = checkedPlacements(model, blocks);
  const board = candidateChecker(placements, model.facts);
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
      if (JSON.stringify(full) !== JSON.stringify(board(candidates))) return false;
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
      ...(ids.journalToday === ''
        ? []
        : [
            get(
              'open a journal for a quarter',
              `/api/journal/journals/${ids.journalToday}?quarterId=${ids.quarter}`,
            ),
          ]),
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
  /** The step after which a partial report was written; `null` for the report at the end. */
  written: string | null;
  phase: string;
  school: School;
  timings: readonly Timing[];
  fills: readonly { branch: string; filled: Filled }[];
  counts: { lessons: number; cells: number; history: number };
  load: LoadTimes;
  breakdown: readonly Breakdown[];
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
    ...(input.written === null
      ? []
      : [
          '## Partial',
          '',
          `Written after ${input.written} (phase ${input.phase}); the steps after it follow in a later report.`,
          '',
        ]),
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
    `Each read timed ${String(size.repeats)} times after one warm-up; a write once. ${TRIPLE ? 'Asserted on the slowest.' : 'Not asserted at this size.'}`,
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
    '| Action | Target | Requests | Median | 95th percentile | Answers | Updating |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(input.load).map(
      ([name, times]) =>
        `| ${name} | under ${String(targetOf(name) / 1000)} s | ${String(times.runs.length)} | ${ms(median(times.runs))} | ${ms(percentile95(times.runs))} | ${JSON.stringify(times.statuses)} | ${String(times.updating)} |`,
    ),
    '',
    ...(input.breakdown.length === 0
      ? []
      : [
          '## Where the time went',
          '',
          "Each measure that missed its target: the time of its queries summed over its runs, and the slowest query texts by their sum; the rest of its time is the server's own work.",
          '',
          ...input.breakdown.flatMap((one) => [
            `- **${one.what}**: ${String(one.queries)} queries in ${String(one.runs)} requests, ${ms(one.ms)} in all.`,
            ...one.slowest.map(
              (query) =>
                `  - ${ms(query.ms)}, ${String(query.count)}×: \`${query.text.slice(0, 300)}\``,
            ),
          ]),
          '',
        ]),
    `The whole run took ${input.total.toFixed(0)} s.`,
    '',
  ].join('\n');
}

/**
 * Two temporary exemptions in each class, written through the route as the
 * Academic Vice Principal before the journals are filled: a school week of
 * quarter 3 for one student and the week of the measuring day for another.
 */
async function exemptionsOf(t: AppKit, branch: BranchOfRun, vice: Person) {
  let made = 0;
  for (const one of branch.classes) {
    const students = await t.database.migrator
      .selectFrom('class_memberships')
      .select('student_id')
      .where('class_id', '=', one.id)
      .orderBy('student_id')
      .limit(2)
      .execute();
    for (const [index, student] of students.entries()) {
      const [startDate, endDate] =
        index === 0 ? ['2027-02-01', '2027-02-05'] : ['2027-05-17', '2027-05-21'];
      const response = await as(vice).post('/api/exemptions', {
        studentIds: [student.student_id],
        kind: 'temporary',
        subjectIds: null,
        startDate,
        endDate,
        slots: null,
        category: 'illness',
        detail: 'Speed run',
        choices: [],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      made += 1;
    }
  }
  return made;
}
