// The virtual users of the load run (task 10.1; `12`, Load: "1,000 people
// working at once"), run in a child process by `load-run.ts` so the test
// process serves the API while this one makes the requests: each user repeats
// its role's actions in turn with a pause of `gapMs` between them, until
// `durationMs` is over. Node's own `fetch`, no dependency; run by Node's type
// stripping, so it imports nothing but Node and uses only erasable syntax.
// Reads the plan as JSON on stdin and writes the times as JSON on stdout.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

interface Action {
  readonly name: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
}

interface User {
  readonly cookie: string;
  readonly branchId: string;
  readonly actions: readonly Action[];
}

interface Plan {
  readonly baseUrl: string;
  readonly users: readonly User[];
  readonly durationMs: number;
  readonly gapMs: readonly [number, number];
  /** `BRANCH_HEADER` and `REQUEST_KEY_HEADER` of `@sodiq/shared`, which this file cannot import. */
  readonly branchHeader: string;
  readonly keyHeader: string;
}

interface Times {
  readonly runs: number[];
  readonly failures: number;
  readonly statuses: Record<string, number>;
}

async function readPlan(): Promise<Plan> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Plan;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const plan = await readPlan();
  const times = new Map<string, Times>();
  const end = performance.now() + plan.durationMs;
  const [low, high] = plan.gapMs;
  const gap = () => low + Math.random() * (high - low);
  const run = async (user: User, first: number) => {
    // The users start spread over the first pause, not all at once.
    await pause(Math.random() * high);
    let index = first;
    while (performance.now() < end) {
      const action = user.actions[index % user.actions.length];
      index += 1;
      if (action === undefined) return;
      const started = performance.now();
      let status: string;
      try {
        const response = await fetch(`${plan.baseUrl}${action.path}`, {
          method: action.method,
          headers: {
            Cookie: user.cookie,
            [plan.branchHeader]: user.branchId,
            ...(action.method === 'POST'
              ? { 'Content-Type': 'application/json', [plan.keyHeader]: randomUUID() }
              : {}),
          },
          ...(action.body === undefined ? {} : { body: JSON.stringify(action.body) }),
        });
        await response.arrayBuffer();
        status = String(response.status);
      } catch {
        status = 'error';
      }
      const known = times.get(action.name) ?? { runs: [], failures: 0, statuses: {} };
      known.runs.push(performance.now() - started);
      known.statuses[status] = (known.statuses[status] ?? 0) + 1;
      times.set(action.name, {
        ...known,
        failures: known.failures + (status.startsWith('2') ? 0 : 1),
      });
      await pause(gap());
    }
  };
  await Promise.all(plan.users.map((user, index) => run(user, index)));
  process.stdout.write(JSON.stringify(Object.fromEntries(times)));
}

await main();
