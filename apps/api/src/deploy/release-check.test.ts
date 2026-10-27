import { describe, expect, it } from 'vitest';
import { checkRelease, GITHUB_API, ReleaseCheckError } from './release-check.js';
import type { Fetch } from './render.js';

// Decision 5 of pull request #244; owner's answer 20 (docs/decisions.md,
// Decided ahead for Phase 10): only a commit of main that passed checks, e2e
// and the test deploy goes to production.
const TOKEN = 'ghs_invented_token_0000';
const REPOSITORY = 'sodiqschoolapp/sodiq-platform';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

interface FakeRun {
  id: number;
  name?: string;
  head_branch?: string;
  event?: string;
  run_number: number;
  jobs: [string, string, string | null][];
}

function fakeGitHub(runs: FakeRun[], status = 200) {
  const calls: { url: string; authorization: string | undefined }[] = [];
  const fetcher: Fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, authorization: headers?.authorization });
    const json = (value: unknown) =>
      Promise.resolve(new Response(JSON.stringify(value), { status }));
    const jobsOf = /\/actions\/runs\/(\d+)\/jobs/.exec(url);
    if (jobsOf !== null) {
      const run = runs.find((one) => String(one.id) === jobsOf[1]);
      return json({
        jobs: (run?.jobs ?? []).map(([name, jobStatus, conclusion]) => ({
          name,
          status: jobStatus,
          conclusion,
        })),
      });
    }
    return json({
      workflow_runs: runs.map((run) => ({
        id: run.id,
        name: run.name ?? 'CI',
        head_branch: run.head_branch ?? 'main',
        event: run.event ?? 'push',
        run_number: run.run_number,
      })),
    });
  };
  return { fetcher, calls };
}

const passed: [string, string, string | null][] = [
  ['lint-types', 'completed', 'success'],
  ['checks', 'completed', 'success'],
  ['e2e', 'completed', 'success'],
  ['deploy-test', 'completed', 'success'],
];

const check = (fetcher: Fetch) =>
  checkRelease({ token: TOKEN, repository: REPOSITORY, commitId: COMMIT, fetch: fetcher });

describe('the release check of production', () => {
  it('accepts a commit of main whose checks, e2e and test deploy passed', async () => {
    const github = fakeGitHub([{ id: 41, run_number: 900, jobs: passed }]);

    await expect(check(github.fetcher)).resolves.toBe(41);
    expect(github.calls[0]?.url).toBe(
      `${GITHUB_API}/repos/${REPOSITORY}/actions/runs?head_sha=${COMMIT}&branch=main&event=push&per_page=100`,
    );
    expect(github.calls[1]?.url).toContain('/actions/runs/41/jobs?filter=latest');
    for (const call of github.calls) {
      expect(call.authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('refuses a commit with no CI run of a push to main', async () => {
    const github = fakeGitHub([
      { id: 1, run_number: 1, event: 'pull_request', jobs: passed },
      { id: 2, run_number: 2, head_branch: 'task/10.4-production-go-live', jobs: passed },
      { id: 3, run_number: 3, name: 'Routines', jobs: passed },
    ]);

    await expect(check(github.fetcher)).rejects.toThrow(/no CI run of a push to main/);
  });

  it.each([
    ['checks', 'failure'],
    ['e2e', 'cancelled'],
    ['deploy-test', 'skipped'],
  ])('refuses when %s ended as %s', async (name, conclusion) => {
    const github = fakeGitHub([
      {
        id: 7,
        run_number: 70,
        jobs: passed.map(([job, status, done]) =>
          job === name ? [job, 'completed', conclusion] : [job, status, done],
        ),
      },
    ]);

    await expect(check(github.fetcher)).rejects.toThrow(
      new RegExp(`did not pass ${name} in CI run 7`),
    );
  });

  it('refuses while the test deploy still runs, or when it never ran', async () => {
    const running = fakeGitHub([
      {
        id: 8,
        run_number: 80,
        jobs: [...passed.slice(0, 3), ['deploy-test', 'in_progress', null]],
      },
    ]);
    const never = fakeGitHub([{ id: 9, run_number: 90, jobs: passed.slice(0, 3) }]);

    await expect(check(running.fetcher)).rejects.toThrow(/did not pass deploy-test/);
    await expect(check(never.fetcher)).rejects.toThrow(/did not pass deploy-test/);
  });

  it('reads the newest CI run of the commit', async () => {
    const github = fakeGitHub([
      { id: 10, run_number: 100, jobs: [['checks', 'completed', 'failure']] },
      { id: 11, run_number: 101, jobs: passed },
    ]);

    await expect(check(github.fetcher)).resolves.toBe(11);
  });

  it('names the status of a refused request, never the token', async () => {
    const github = fakeGitHub([], 403);

    const error = await check(github.fetcher).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReleaseCheckError);
    expect((error as Error).message).toBe(
      `GitHub answered 403 for /repos/${REPOSITORY}/actions/runs.`,
    );
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
