import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GridAnswer, PublishCheck } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
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
  travelProbe,
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
 * are timed and written to `apps/api/real-size-report-<size>.md` (git-ignored).
 *
 * Small (2 branches, 4 classes) in CI; `REAL_SIZE=full` runs the school's
 * size (3 branches, 80 classes, 2,000 students): decision 2 of the plan.
 * The run fails on a lesson not placed, a blocked result on any board, a
 * publish check that would refuse, or a publish that is refused; the times are
 * reported against the targets, not asserted (they depend on the machine).
 */

const size = SIZES[process.env.REAL_SIZE === 'full' ? 'full' : 'small'];
const LIMIT = size.name === 'full' ? 3 * 60 * 60_000 : 10 * 60_000;
const REPORT = resolve(import.meta.dirname, `../../../real-size-report-${size.name}.md`);
/** Every measure the report gives for each branch (the plan's table). */
const MEASURES = [
  'open the board of the draft',
  'check a move',
  'a saved move',
  'publish check',
  'publish (',
  'open the board of the published version',
  'the published week of a class',
  'the published week of a teacher',
  'open a journal for a quarter',
] as const;
const STEPS = ['templates', 'load', 'teachers', 'rooms', 'rules'] as const;

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

      const readyOf = new Map<string, Record<string, boolean>>();
      const probes: { branch: string; elsewhere: number; rules: readonly string[] }[] = [];

      let gaps: Gap[] = [];
      const write = async (failure: string | null) => {
        const text = report({
          failure,
          readyOf,
          probes,
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
        });
        await writeFile(REPORT, text);
        return text;
      };

      // A step that fails still leaves the report of every step before it.
      try {
        for (const [index, branch] of school.branches.entries()) {
          const vice = asVice(t, branch);
          // A later branch's draft holds the shared teachers' lessons of the
          // branches published before it, and the engine keeps the travel time
          // to them (review correction 2; `06`, Busy elsewhere, Travel time).
          if (index > 0) {
            const empty = await gridOf(t, branch);
            // Only the teachers shared with a branch already published: one
            // shared with a later branch has no lesson elsewhere yet (5.12d,
            // the first full run to reach a second branch).
            const published = new Set(
              school.branches.slice(0, index).flatMap((earlier) => earlier.teachers),
            );
            for (const teacher of new Set(school.sharedTeachers)) {
              if (!published.has(teacher)) continue;
              const probe = travelProbe(empty, teacher);
              if (probe === null) continue;
              probes.push({ branch: branch.name, ...probe });
              expect(
                probe.elsewhere,
                `${branch.name}: busy elsewhere of a shared teacher`,
              ).toBeGreaterThan(0);
              expect(
                probe.rules,
                `${branch.name}: the lesson right after one in another branch`,
              ).toContain('travel_time');
            }
            expect(
              probes.filter((one) => one.branch === branch.name).length,
              `${branch.name}: a shared teacher probed`,
            ).toBeGreaterThan(0);
          }
          const placed = await placeDraft(t, branch);
          placedOf.set(branch.id, placed);
          expect(placed.notPlaced, `${branch.name}: lessons not placed`).toEqual([]);

          // Every step of the builder ready (review correction 3): the
          // templates confirmed, every row placed, every teacher's hours over
          // their lessons, the rooms of the rows there, the rules confirmed.
          const readiness = (await confirmSteps(t, branch)) as Record<
            (typeof STEPS)[number],
            { ready: boolean }
          > & { ready: boolean };
          expect(readiness.ready, `${branch.name}: ${JSON.stringify(readiness)}`).toBe(true);
          readyOf.set(
            branch.name,
            Object.fromEntries(STEPS.map((step) => [step, readiness[step].ready])),
          );

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
            what: `${branch.name}: check a move at every slot of the week (${String(move.slots)} slots, as the board marks them when a drag starts)`,
            target: 'under 0.2 s',
            runs: move.runs,
          });

          // A saved move on the board and back, through the route.
          const target = movableBlock(board.last);
          expect(target, `${branch.name}: a block with a free slot to move to`).not.toBeNull();
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
          expect(blockedOf(board.last), `${branch.name}: blocked on the published board`).toEqual(
            [],
          );
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

        // Task 6.2 (From 5.12c, decision 1 of #203; decision 18): the journal
        // of each branch's first class with the most lessons in quarter 1,
        // filled with a full quarter of marks and a classwork per lesson,
        // opened for the quarter with the clock after its last day.
        for (const branch of school.branches) {
          const journal = await fullQuarterJournal(t, branch);
          const at = new Date(`${journal.after}T12:00:00+05:00`);
          t.clock.set(at.toISOString());
          await t.database.migrator
            .updateTable('sessions')
            .set({ created_at: at, last_used_at: at })
            .execute();
          try {
            const vice = asVice(t, branch);
            const opened = await timed(size.repeats, async () => {
              const response = await vice.get(
                `/api/journal/journals/${journal.id}?quarterId=${journal.quarterId}`,
              );
              expect(response.status, JSON.stringify(response.body)).toBe(200);
              return response;
            });
            timings.push({
              what: `${branch.name}: open a journal for a quarter (${String(journal.lessons)} lessons, ${String(journal.cells)} cells)`,
              target: 'under 1 s',
              runs: opened.runs,
            });
            // `12`, Speed targets: "Open a journal for a quarter: under 1 second".
            expect(
              median(opened.runs),
              `${branch.name}: open a journal for a quarter`,
            ).toBeLessThan(1000);
          } finally {
            t.clock.set(RUN_CLOCK);
            await t.database.migrator
              .updateTable('sessions')
              .set({ created_at: new Date(RUN_CLOCK), last_used_at: new Date(RUN_CLOCK) })
              .execute();
          }
        }

        // Task 7.1b (plan of pull request #213): every journal of a graded
        // subject in each branch given a plan with an item on every row of each
        // quarter; one transaction marks them all and the follow before its
        // commit lays every plan again, as a change of the whole branch does.
        for (const branch of school.branches) {
          const planned = await fullPlans(t, branch);
          const followed = await timed(size.repeats, () =>
            t.app.get(Transactions).run([branch.id], async (transaction) => {
              await transaction
                .insertInto('lesson_plan_follow_marks')
                .values(planned.journals.map((id) => ({ branch_id: branch.id, journal_id: id })))
                .execute();
            }),
          );
          timings.push({
            what: `${branch.name}: the plans follow a change of the whole branch (${String(planned.plans)} plans, ${String(planned.items)} items)`,
            target: 'under 3 s',
            runs: followed.runs,
          });
          expect(median(followed.runs), `${branch.name}: the plans follow`).toBeLessThan(3000);
        }

        // A teacher shared between branches teaches in both on one day, the
        // travel time kept between the two branches' lessons (`06`, Travel time).
        gaps = await sharedDays(t, school);
        expect(
          gaps.length,
          'a shared teacher with lessons in two branches on one day',
        ).toBeGreaterThan(0);
        for (const gap of gaps)
          expect(gap.minutes, JSON.stringify(gap)).toBeGreaterThanOrEqual(TRAVEL_MINUTES);
      } catch (error) {
        await write(error instanceof Error ? error.message : String(error));
        throw error;
      }

      // The report holds every measure of every branch.
      for (const branch of school.branches) {
        for (const measure of MEASURES) {
          expect(
            timings.filter((one) => one.what.startsWith(`${branch.name}: ${measure}`)),
            `${branch.name}: ${measure}`,
          ).not.toEqual([]);
        }
      }
      const text = await write(null);
      for (const one of timings) expect(text).toContain(`| ${one.what} |`);
    },
    LIMIT,
  );
});

/**
 * Task 6.2: the journal of the branch's first class with the most dated
 * lessons in quarter 1, given a classwork with a total on each of them and a
 * mark and a number for every expected student, written as the migrator in
 * one statement per lesson (the history line of each by the trigger); the
 * day after the quarter, from which every lesson of it is held.
 */
async function fullQuarterJournal(
  t: DayTemplatesKit,
  branch: BranchOfRun,
): Promise<{
  id: string;
  quarterId: string;
  after: string;
  lessons: number;
  cells: number;
}> {
  const migrator = t.database.migrator;
  const classId = branch.classes[0]?.id ?? '';
  const quarter = await migrator
    .selectFrom('quarters')
    .innerJoin('classes', 'classes.academic_year_id', 'quarters.academic_year_id')
    .select([
      'quarters.id',
      sql<string>`quarters.start_date::text`.as('start'),
      sql<string>`quarters.end_date::text`.as('end'),
      sql<string>`(quarters.end_date + 1)::text`.as('after'),
    ])
    .where('classes.id', '=', classId)
    .where('quarters.number', '=', 1)
    .executeTakeFirstOrThrow();
  const busiest = await migrator
    .selectFrom('lessons')
    .innerJoin('journals', (join) =>
      join
        .onRef('journals.class_id', '=', 'lessons.class_id')
        .onRef('journals.subject_id', '=', 'lessons.subject_id'),
    )
    .select([
      'journals.id',
      'lessons.subject_id',
      (select) => select.fn.countAll<string>().as('count'),
    ])
    .where('lessons.class_id', '=', classId)
    .where('lessons.lesson_date', '>=', quarter.start)
    .where('lessons.lesson_date', '<=', quarter.end)
    .groupBy(['journals.id', 'lessons.subject_id'])
    .orderBy('count', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  const lessons = await migrator
    .selectFrom('lessons')
    .select(['id', 'starts_at'])
    .where('class_id', '=', classId)
    .where('subject_id', '=', busiest.subject_id)
    .where('lesson_date', '>=', quarter.start)
    .where('lesson_date', '<=', quarter.end)
    .where('cancel_cause', 'is', null)
    .execute();
  const writer = await migrator
    .selectFrom('accounts')
    .select('id')
    .limit(1)
    .executeTakeFirstOrThrow();
  let cells = 0;
  for (const [index, lesson] of lessons.entries()) {
    await migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${lesson.starts_at.toISOString()}, true)`.execute(
        transaction,
      );
      const work = await transaction
        .insertInto('journal_works')
        .values({ branch_id: branch.id, lesson_id: lesson.id, kind: 'classwork', total: 30 })
        .returning('id')
        .executeTakeFirstOrThrow();
      // The plan's two works per lesson: a homework checked at it too.
      const homework = await transaction
        .insertInto('journal_works')
        .values({ branch_id: branch.id, lesson_id: lesson.id, kind: 'homework', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow();
      const written = await sql<{ n: number }>`
        with expected as (
          select s.student_id, row_number() over (order by s.student_id) as n
          from lesson_expected_students(${lesson.id}::uuid) as s(student_id)
        ), inserted as (
          insert into journal_cells
            (branch_id, lesson_id, student_id, work_id, mark, score, version, changed_by, changed_how, changed_at)
          select ${branch.id}::uuid, ${lesson.id}::uuid, e.student_id, null,
                 case when (e.n + ${index}) % 11 = 0 then 0 when (e.n + ${index}) % 7 = 0 then 2 else 1 end,
                 null, 1, ${writer.id}::uuid, 'entry', ${lesson.starts_at}::timestamptz
          from expected e
          union all
          select ${branch.id}::uuid, ${lesson.id}::uuid, e.student_id, ${work.id}::uuid, null,
                 (e.n * 7 + ${index}) % 31, 1, ${writer.id}::uuid, 'entry', ${lesson.starts_at}::timestamptz
          from expected e
          union all
          select ${branch.id}::uuid, ${lesson.id}::uuid, e.student_id, ${homework.id}::uuid, null,
                 (e.n * 3 + ${index}) % 11, 1, ${writer.id}::uuid, 'entry', ${lesson.starts_at}::timestamptz
          from expected e
          returning 1
        )
        select count(*)::int as n from inserted
      `.execute(transaction);
      cells += written.rows[0]?.n ?? 0;
    });
  }
  return {
    id: busiest.id,
    quarterId: quarter.id,
    after: quarter.after,
    lessons: lessons.length,
    cells,
  };
}

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
  failure: string | null;
  readyOf: Map<string, Record<string, boolean>>;
  probes: { branch: string; elsewhere: number; rules: readonly string[] }[];
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
    ...(input.failure === null
      ? []
      : [
          '## Stopped',
          '',
          `The run stopped at a failed step: ${input.failure.split('\n')[0] ?? ''}`,
          '',
        ]),
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
    ...school.branches
      .filter((branch) => input.placedOf.has(branch.id))
      .map((branch) => {
        const placed = input.placedOf.get(branch.id);
        return `| ${branch.name} | ${String(placed?.blocks ?? 0)} | ${String(placed?.lessons ?? 0)} | ${placed === undefined || placed.notPlaced.length === 0 ? 'none' : placed.notPlaced.map((one) => `${one.unit} ${one.subject} ×${String(one.lessons)}`).join(', ')} | ${(placed?.seconds ?? 0).toFixed(1)} s |`;
      }),
    '',
    '## Builder steps',
    '',
    '| Branch | Templates | Load | Teachers | Rooms | Rules |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[...input.readyOf].map(
      ([branch, steps]) =>
        `| ${branch} | ${STEPS.map((step) => (steps[step] === true ? 'ready' : 'not ready')).join(' | ')} |`,
    ),
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
    `Shared teachers on a day in two branches: ${String(input.gaps.length)} teacher-days; the least gap between their lessons in two branches is ${input.gaps.length === 0 ? 'not measured' : `${String(Math.min(...input.gaps.map((one) => one.minutes)))} minutes`} (travel time ${String(TRAVEL_MINUTES)}).`,
    '',
    ...input.probes.map(
      (one) =>
        `${one.branch}, draft before placement: a shared teacher has ${String(one.elsewhere)} lessons busy elsewhere; a lesson put right after one of them is blocked by ${one.rules.join(', ')}.`,
    ),
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
    "- The generate step and the solver's time (task 5.11).",
    '- 1,000 simultaneous users (task 10.1, Speed tests; decision 3).',
    "- Double lessons: the owner's lines name groups, splits and shared teachers; no row of the data allows doubles, so every block is single.",
    '',
  ];
  return lines.join('\n');
}

/**
 * Task 7.1b: a plan for every journal of a graded subject of the branch and
 * every dated quarter, with an item on each of its rows (the quarter's lessons
 * not cancelled), written as the migrator; laid on its rows by the first follow.
 */
async function fullPlans(
  t: DayTemplatesKit,
  branch: BranchOfRun,
): Promise<{ journals: string[]; plans: number; items: number }> {
  const migrator = t.database.migrator;
  const journals = await migrator
    .selectFrom('journals')
    .innerJoin('subjects', 'subjects.id', 'journals.subject_id')
    .select(['journals.id', 'journals.class_id', 'journals.group_id', 'journals.subject_id'])
    .where('journals.branch_id', '=', branch.id)
    .where('journals.academic_year_id', '=', branch.year)
    .where('subjects.journal_type', '=', 'graded')
    .orderBy('journals.id')
    .execute();
  const quarters = await migrator
    .selectFrom('quarters')
    .select([
      'id',
      sql<string>`start_date::text`.as('start'),
      sql<string>`end_date::text`.as('end'),
    ])
    .where('academic_year_id', '=', branch.year)
    .where('start_date', 'is not', null)
    .execute();
  let plans = 0;
  let items = 0;
  for (const journal of journals) {
    for (const quarter of quarters) {
      let query = migrator
        .selectFrom('lessons')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('branch_id', '=', branch.id)
        .where('subject_id', '=', journal.subject_id)
        .where('cancel_cause', 'is', null)
        .where('lesson_date', '>=', quarter.start)
        .where('lesson_date', '<=', quarter.end);
      query =
        journal.class_id === null
          ? query.where('group_id', '=', journal.group_id)
          : query.where('class_id', '=', journal.class_id);
      const rows = (await query.executeTakeFirstOrThrow()).count;
      if (rows === 0) continue;
      // Task 7.2: the journal's plan records are made with it (0117).
      const plan = await migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id as id')
        .where('journal_id', '=', journal.id)
        .where('quarter_id', '=', quarter.id)
        .executeTakeFirstOrThrow();
      const written = await migrator
        .insertInto('lesson_plan_items')
        .values(
          Array.from({ length: rows }, (_, index) => ({
            branch_id: branch.id,
            plan_id: plan.id,
            topic: `Topic ${String(index + 1)}`,
          })),
        )
        .returning(['id', 'topic'])
        .execute();
      // Task 7.1c: the row of each item in the journal, by its topic (the
      // order of `returning` is not relied on).
      await migrator
        .insertInto('lesson_plan_places')
        .values(
          written.map((one) => ({
            branch_id: branch.id,
            plan_id: plan.id,
            journal_id: journal.id,
            item_id: one.id,
            position: Number(one.topic.slice('Topic '.length)),
          })),
        )
        .execute();
      plans += 1;
      items += rows;
    }
  }
  return { journals: journals.map((one) => one.id), plans, items };
}
