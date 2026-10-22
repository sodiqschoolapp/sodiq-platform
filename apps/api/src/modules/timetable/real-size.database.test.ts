import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GridAnswer, PublishCheck } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import {
  asVice,
  buildSchool,
  checkStops,
  confirmSteps,
  gridOf,
  machineOf,
  median,
  moveCheck,
  movableBlock,
  once,
  placeDraft,
  resultsByRule,
  RUN_CLOCK,
  RUN_START,
  SIZES,
  timed,
  TRAVEL_MINUTES,
  type BranchOfRun,
  type Placed,
  type School,
  type Timing,
} from '../../testing/real-size.js';

/**
 * The real-size run (task 5.12c; `14`, Whole system: Speed tests; `12`, Speed
 * targets; the owner's lines of 15 and 20 October 2026). A school of invented
 * data is built, each branch's weekly pattern placed by the seed placer,
 * checked by the rule engine, and published branch by branch through the
 * real routes, each later branch checked after the earlier ones are published
 * (a shared teacher's lessons there are busy elsewhere, with the travel time);
 * the board, a move, the publish check, the publish and the published week
 * are timed and written to `apps/api/real-size-report.md`.
 *
 * Small (2 branches, 4 classes) in CI; `REAL_SIZE=full` runs the school's
 * size (3 branches, 80 classes, 2,000 students): decision 2 of the plan.
 * The run fails on a lesson not placed, a blocked result on any board, a
 * publish check that would refuse, or a publish that is refused; the times are
 * reported against the targets, not asserted (they depend on the machine).
 */

const size = SIZES[process.env.REAL_SIZE === 'full' ? 'full' : 'small'];
const LIMIT = size.name === 'full' ? 3 * 60 * 60_000 : 10 * 60_000;
const REPORT = resolve(import.meta.dirname, '../../../real-size-report.md');

let t: DayTemplatesKit;

beforeAll(async () => {
  t = await dayTemplatesKit({ start: RUN_CLOCK });
});

afterAll(async () => {
  await t.close();
});

const blockedOf = (grid: GridAnswer) => grid.results.filter((one) => one.severity === 'blocked');

describe(`the real-size run, ${size.name} (task 5.12c)`, () => {
  it(
    'places every lesson, finds no blocked result, publishes every branch and times each step',
    async () => {
      const startedAt = performance.now();
      const school: School = await buildSchool(t, size);
      const built = (performance.now() - startedAt) / 1000;
      const timings: Timing[] = [];
      const placedOf = new Map<string, Placed>();
      const boards: {
        branch: string;
        when: string;
        blocked: Record<string, number>;
        warnings: Record<string, number>;
      }[] = [];
      const checks: { branch: string; refusals: number; blocked: number; warnings: number }[] = [];
      let lessonsWritten = 0;

      for (const branch of school.branches) {
        const vice = asVice(t, branch);
        const placed = await placeDraft(t, branch);
        placedOf.set(branch.id, placed);
        expect(placed.notPlaced, `${branch.name}: lessons not placed`).toEqual([]);

        const readiness = (await confirmSteps(t, branch)) as { ready: boolean };
        expect(readiness.ready, `${branch.name}: ${JSON.stringify(readiness)}`).toBe(true);

        const board = await timed(size.repeats, () => gridOf(t, branch));
        timings.push({
          what: `${branch.name}: open the board of the draft`,
          target: 'under 1 s',
          runs: board.runs,
        });
        expect(blockedOf(board.last), `${branch.name}: blocked on the draft's board`).toEqual([]);
        boards.push({ branch: branch.name, when: 'draft', ...resultsByRule(board.last.results) });

        const move = moveCheck(board.last, size.repeats);
        timings.push({
          what: `${branch.name}: check a move (one slot)`,
          target: 'under 0.2 s',
          runs: move.one,
        });
        timings.push({
          what: `${branch.name}: check a move at every slot of the week (${String(move.slots)} slots, as a drag starts)`,
          target: 'reported',
          runs: move.week,
        });

        // A saved move on the board and back, through the route.
        const target = movableBlock(board.last);
        if (target !== null) {
          const there = await once(() =>
            vice.post(
              `/api/timetable/versions/${branch.version}/pattern/${target.blockId}/move`,
              target.to,
            ),
          );
          expect(there.last.status, JSON.stringify(there.last.body)).toBe(200);
          const back = await once(() =>
            vice.post(
              `/api/timetable/versions/${branch.version}/pattern/${target.blockId}/move`,
              target.from,
            ),
          );
          expect(back.last.status, JSON.stringify(back.last.body)).toBe(200);
          timings.push({
            what: `${branch.name}: a saved move (route, write)`,
            target: 'under 1 s',
            runs: [...there.runs, ...back.runs],
          });
        }

        const check = await timed(size.repeats, async () => {
          const response = await vice.get(
            `/api/timetable/versions/${branch.version}/publish-check?startsOn=${RUN_START}`,
          );
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          return response.body as PublishCheck;
        });
        timings.push({
          what: `${branch.name}: publish check`,
          target: 'under 1 s',
          runs: check.runs,
        });
        const stops = checkStops(check.last);
        checks.push({ branch: branch.name, ...stops, warnings: check.last.warnings.length });
        expect(stops, `${branch.name}: ${JSON.stringify(check.last.refusals)}`).toEqual({
          refusals: 0,
          blocked: 0,
        });

        const before = await lessonCount(t, branch);
        const published = await once(() =>
          vice.post(`/api/timetable/versions/${branch.version}/publish`, { startsOn: RUN_START }),
        );
        expect(published.last.status, JSON.stringify(published.last.body)).toBe(200);
        const written = (await lessonCount(t, branch)) - before;
        lessonsWritten += written;
        timings.push({
          what: `${branch.name}: publish (${String(written)} dated lessons written)`,
          target: 'reported',
          runs: published.runs,
        });
      }

      // Every published board read again once all are published: still nothing blocked.
      for (const branch of school.branches) {
        const board = await timed(size.repeats, () => gridOf(t, branch));
        timings.push({
          what: `${branch.name}: open the board of the published version`,
          target: 'under 1 s',
          runs: board.runs,
        });
        expect(blockedOf(board.last), `${branch.name}: blocked on the published board`).toEqual([]);
        boards.push({
          branch: branch.name,
          when: 'published, all branches',
          ...resultsByRule(board.last.results),
        });
        const vice = asVice(t, branch);
        const classId = branch.classes[0]?.id ?? '';
        const classWeek = await timed(size.repeats, async () => {
          const response = await vice.get(
            `/api/timetable/views/class?date=${RUN_START}&span=week&classId=${classId}`,
          );
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          return response;
        });
        timings.push({
          what: `${branch.name}: the published week of a class`,
          target: 'under 1 s',
          runs: classWeek.runs,
        });
        const teacher =
          school.sharedTeachers.find((id) => branch.teachers.includes(id)) ??
          branch.teachers[0] ??
          '';
        const teacherWeek = await timed(size.repeats, async () => {
          const response = await vice.get(
            `/api/timetable/views/teacher?date=${RUN_START}&span=week&staffId=${teacher}`,
          );
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          return response;
        });
        timings.push({
          what: `${branch.name}: the published week of a teacher`,
          target: 'under 1 s',
          runs: teacherWeek.runs,
        });
      }

      // A teacher shared between branches teaches in both on one day, the
      // travel time kept between the two branches' lessons (`06`, Travel time).
      const gaps = await sharedDays(t, school);
      expect(
        gaps.length,
        'a shared teacher with lessons in two branches on one day',
      ).toBeGreaterThan(0);
      for (const gap of gaps)
        expect(gap.minutes, JSON.stringify(gap)).toBeGreaterThanOrEqual(TRAVEL_MINUTES);

      await writeFile(
        REPORT,
        report({
          school,
          built,
          placedOf,
          timings,
          boards,
          checks,
          lessonsWritten,
          gaps,
          machine: await machineOf(t),
          total: (performance.now() - startedAt) / 1000,
        }),
      );
      console.info(`The real-size report: ${REPORT}`);
    },
    LIMIT,
  );
});

async function lessonCount(t: DayTemplatesKit, branch: BranchOfRun): Promise<number> {
  const row = await t.database.migrator
    .selectFrom('lessons')
    .select((select) => select.fn.countAll<string>().as('count'))
    .where('branch_id', '=', branch.id)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

interface Gap {
  readonly teacher: string;
  readonly weekday: number;
  readonly minutes: number;
}

/** For each shared teacher and weekday with lessons in two branches: the least gap between them. */
async function sharedDays(t: DayTemplatesKit, school: School): Promise<Gap[]> {
  const versions = school.branches.map((one) => one.version);
  const entries = await t.database.migrator
    .selectFrom('pattern_entries')
    .select(['teacher_id', 'branch_id', 'weekday', 'start_minutes', 'end_minutes'])
    .where('version_id', 'in', versions)
    .where(
      'teacher_id',
      'in',
      school.sharedTeachers.length === 0 ? [''] : [...school.sharedTeachers],
    )
    .execute();
  const gaps: Gap[] = [];
  for (const teacher of new Set(school.sharedTeachers)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const ofDay = entries.filter((one) => one.teacher_id === teacher && one.weekday === weekday);
      let least: number | null = null;
      for (const a of ofDay) {
        for (const b of ofDay) {
          if (a.branch_id >= b.branch_id) continue;
          const gap = Math.max(b.start_minutes - a.end_minutes, a.start_minutes - b.end_minutes);
          least = least === null ? gap : Math.min(least, gap);
        }
      }
      if (least !== null) gaps.push({ teacher, weekday, minutes: least });
    }
  }
  return gaps;
}

const ms = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)} ms`;

function report(input: {
  school: School;
  built: number;
  placedOf: Map<string, Placed>;
  timings: Timing[];
  boards: {
    branch: string;
    when: string;
    blocked: Record<string, number>;
    warnings: Record<string, number>;
  }[];
  checks: { branch: string; refusals: number; blocked: number; warnings: number }[];
  lessonsWritten: number;
  gaps: Gap[];
  machine: string;
  total: number;
}): string {
  const { school } = input;
  const classes = school.branches.reduce((sum, one) => sum + one.classes.length, 0);
  const lines = [
    `# Real-size run (${size.name})`,
    '',
    `Run by \`apps/api/src/modules/timetable/real-size.database.test.ts\` (\`REAL_SIZE=${size.name}\`), data and placer in \`apps/api/src/testing/real-size.ts\`. Clock: ${RUN_CLOCK}; every version published from ${RUN_START}. Machine: ${input.machine}; one API process and its database on one machine, no network.`,
    '',
    '## Size',
    '',
    `| | Count |`,
    `| --- | --- |`,
    `| Branches | ${String(school.branches.length)} |`,
    `| Classes | ${String(classes)} |`,
    `| Students | ${String(school.students)} |`,
    `| Teachers | ${String(school.teachers)} (${String(new Set(school.sharedTeachers).size)} teach in two branches) |`,
    `| Groups (English across two classes, halves of splits) | ${String(school.branches.reduce((sum, one) => sum + one.groups, 0))} |`,
    `| Load rows | ${String(school.branches.reduce((sum, one) => sum + one.rows, 0))} |`,
    `| Rooms | ${String(school.branches.reduce((sum, one) => sum + one.rooms, 0))} |`,
    `| Dated lessons written by the publishes | ${String(input.lessonsWritten)} |`,
    '',
    `Built in ${input.built.toFixed(0)} s; the whole run took ${input.total.toFixed(0)} s.`,
    '',
    '## Placement (seed placer, until 5.11)',
    '',
    '| Branch | Blocks | Lessons | Not placed | Time |',
    '| --- | --- | --- | --- | --- |',
    ...school.branches.map((branch) => {
      const placed = input.placedOf.get(branch.id);
      return `| ${branch.name} | ${String(placed?.blocks ?? 0)} | ${String(placed?.lessons ?? 0)} | ${placed === undefined || placed.notPlaced.length === 0 ? 'none' : placed.notPlaced.map((one) => `${one.unit} ${one.subject} ×${String(one.lessons)}`).join(', ')} | ${(placed?.seconds ?? 0).toFixed(1)} s |`;
    }),
    '',
    '## Rule engine',
    '',
    '| Board | When | Blocked | Warnings by rule |',
    '| --- | --- | --- | --- |',
    ...input.boards.map(
      (one) =>
        `| ${one.branch} | ${one.when} | ${Object.keys(one.blocked).length === 0 ? 'none' : JSON.stringify(one.blocked)} | ${
          Object.entries(one.warnings)
            .map(([rule, count]) => `${rule} ${String(count)}`)
            .join(', ') || 'none'
        } |`,
    ),
    '',
    '| Publish check | Refusals | Blocked | Warnings |',
    '| --- | --- | --- | --- |',
    ...input.checks.map(
      (one) =>
        `| ${one.branch} | ${String(one.refusals)} | ${String(one.blocked)} | ${String(one.warnings)} |`,
    ),
    '',
    `Shared teachers on a day in two branches: ${String(input.gaps.length)} teacher-days; the least gap between their lessons in two branches is ${String(Math.min(...input.gaps.map((one) => one.minutes)))} minutes (travel time ${String(TRAVEL_MINUTES)}).`,
    '',
    '## Times',
    '',
    `Each read timed ${String(size.repeats)} times after one warm-up; a write once.`,
    '',
    '| Measure | Target (`12`) | Median | Slowest |',
    '| --- | --- | --- | --- |',
    ...input.timings.map(
      (one) =>
        `| ${one.what} | ${one.target} | ${ms(median(one.runs))} | ${ms(Math.max(...one.runs))} |`,
    ),
    '',
    '## Left out',
    '',
    '- A journal page: the journal does not exist yet (task 6.2 times it on this data; decision 1).',
    "- The generate step and the solver's time (task 5.11).",
    '- 1,000 simultaneous users (task 10.1, Speed tests; decision 3).',
    '',
  ];
  return lines.join('\n');
}
