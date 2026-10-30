// The solver on a sample branch, re-checked by the rule engine (task 5.10,
// Done when: "on sample data of one branch the solver returns a draft that
// the TypeScript rule engine accepts with zero blocked rules"). Runs the built
// service (`dist/bin/solver`) as the API will.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkTimetable,
  notPlaced,
  patternModel,
  solvedPlacements,
  solverProblem,
  type SolverAnswer,
  type SolverProblem,
} from '@sodiq/timetable-rules';
import { solverBranch } from '../../../packages/timetable-rules/src/testing/solver-branch.js';

const SOLVER = join(import.meta.dirname, '..', 'dist', 'bin', 'solver');
const work = mkdtempSync(join(tmpdir(), 'solver-check-'));
// The start script runs the Java of JAVA_HOME; GitHub's runner defaults to Java
// 17 and keeps Java 21, which Timefold Solver 2 needs, in JAVA_HOME_21_X64.
const javaEnv = {
  ...process.env,
  ...(process.env.JAVA_HOME_21_X64 === undefined
    ? {}
    : { JAVA_HOME: process.env.JAVA_HOME_21_X64 }),
};

afterAll(() => rmSync(work, { recursive: true, force: true }));

function solve(problem: SolverProblem, name: string): SolverAnswer {
  const problemPath = join(work, `${name}-problem.json`);
  const answerPath = join(work, `${name}-answer.json`);
  writeFileSync(problemPath, JSON.stringify(problem));
  execFileSync(SOLVER, ['solve', problemPath, answerPath], {
    env: javaEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return JSON.parse(readFileSync(answerPath, 'utf8')) as SolverAnswer;
}

function blockedOf(
  branch: ReturnType<typeof solverBranch>,
  problem: SolverProblem,
  answer: SolverAnswer,
) {
  const model = patternModel(branch.data);
  const placements = solvedPlacements(model, problem, answer);
  return {
    placements,
    blocked: checkTimetable([...model.fixed, ...placements], model.facts).filter(
      (result) => result.severity === 'blocked',
    ),
  };
}

describe('the solver on a sample branch', () => {
  it('places every lesson, keeps the pin, and the engine finds no blocked rule', () => {
    const branch = solverBranch();
    const problem = solverProblem(patternModel(branch.data), { ...branch, seconds: 60 });
    const answer = solve(problem, 'sample');

    expect(notPlaced(problem, answer)).toEqual([]);
    expect(answer.complete).toBe(true);
    expect(answer.score.hard).toBe(0);
    const pinned = answer.lessons.find((one) => one.id === 'native-5a#pin1');
    expect(pinned?.option).toMatchObject({ weekday: 1, start: 480, end: 525 });

    const { placements, blocked } = blockedOf(branch, problem, answer);
    expect(blocked).toEqual([]);
    // Every row has its lessons per week (06, Rules, last row).
    for (const row of branch.data.rows) {
      expect(placements.filter((one) => one.loadRowId === row.id)).toHaveLength(row.lessonsPerWeek);
    }
    // The mixed split of 8a is placed in pairings only: its halves share one
    // teacher for physical education (task 5.4c-3b).
    const peBoys = placements.filter((one) => one.loadRowId === 'pe-8a-boys');
    for (const lesson of peBoys) {
      const partner = placements.find(
        (one) => one.blockId === lesson.blockId && one.loadRowId !== 'pe-8a-boys',
      );
      expect(partner?.loadRowId).toBe('tech-8a-girls');
    }
  });

  it('places what it can when the load does not fit, and the placed lessons are not blocked', () => {
    const branch = solverBranch({ overloaded: true });
    const problem = solverProblem(patternModel(branch.data), { ...branch, seconds: 20 });
    const answer = solve(problem, 'overloaded');

    const missing = notPlaced(problem, answer);
    expect(missing.length).toBeGreaterThan(0);
    expect(answer.complete).toBe(false);
    expect(answer.score.hard).toBe(0);
    // t-math-1 teaches 9 lessons in four classes and 5a's Tutor hour: 37
    // lessons, 35 slots a week. Only that teacher's lessons stay out.
    const teacherOf = new Map(branch.data.rows.map((row) => [row.id, row.teacherId]));
    expect(
      new Set(missing.flatMap((one) => one.rowIds.map((rowId) => teacherOf.get(rowId)))),
    ).toEqual(new Set(['t-math-1']));
    expect(missing).toHaveLength(2);
    expect(blockedOf(branch, problem, answer).blocked).toEqual([]);
  });
});

describe('the solver service', () => {
  let service: ChildProcess | undefined;
  afterAll(() => service?.kill());

  async function start(token: string): Promise<string> {
    const child = spawn(SOLVER, ['serve', '--port', '0'], {
      env: { ...javaEnv, SOLVER_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    service = child;
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    for (let tries = 0; tries < 200; tries += 1) {
      const port = /listens on [\d.]+:(\d+)/.exec(out)?.[1];
      if (port !== undefined) return `http://127.0.0.1:${port}`;
      await wait(100);
    }
    throw new Error('The solver service did not start.');
  }

  it('refuses without the token, solves in the background, and stops when asked', async () => {
    const token = randomBytes(16).toString('hex');
    const base = await start(token);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const branch = solverBranch();
    const problem = solverProblem(patternModel(branch.data), { ...branch, seconds: 120 });

    const refused = await fetch(`${base}/runs`, { method: 'POST', body: JSON.stringify(problem) });
    expect(refused.status).toBe(401);
    const wrong = await fetch(`${base}/runs/x`, { headers: { Authorization: 'Bearer wrong' } });
    expect(wrong.status).toBe(401);

    const started = await fetch(`${base}/runs`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(problem),
    });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };

    // A complete draft arrives while it keeps improving (06, Auto-generation, Time).
    let run: { state: string; seconds: number; answer: SolverAnswer | null } | undefined;
    for (let tries = 0; tries < 90; tries += 1) {
      await wait(1000);
      const read = await fetch(`${base}/runs/${id}`, { headers: auth });
      run = (await read.json()) as typeof run;
      if (run?.answer?.complete === true) break;
    }
    expect(run?.state).toBe('solving');
    expect(run?.answer?.complete).toBe(true);
    console.log(`First complete draft of the sample branch within ${run?.seconds ?? '?'} s.`);

    const stopped = await fetch(`${base}/runs/${id}`, { method: 'DELETE', headers: auth });
    expect(stopped.status).toBe(202);
    let state = '';
    for (let tries = 0; tries < 30 && state !== 'done'; tries += 1) {
      await wait(500);
      const read = await fetch(`${base}/runs/${id}`, { headers: auth });
      state = ((await read.json()) as { state: string }).state;
    }
    expect(state).toBe('done');

    const unknown = await fetch(`${base}/runs/no-such-run`, { headers: auth });
    expect(unknown.status).toBe(404);
  });
});
