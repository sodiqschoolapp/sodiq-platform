import { describe, expect, it } from 'vitest';
import type { Fetch } from './render.js';
import {
  decideMerge,
  mergeReviewed,
  REPOSITORY,
  REVIEWER,
  verdictOf,
  type CheckFacts,
  type CommentFacts,
  type PullFacts,
} from './merge-reviewed.js';

// The merge of a reviewed task pull request (owner, 6 November 2026): the rule of
// .claude/skills/review-pr step 10, carried out by .github/workflows/merge-reviewed.yml.

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

const pull = (change: Partial<PullFacts> = {}): PullFacts => ({
  number: 7,
  state: 'open',
  merged: false,
  headSha: HEAD,
  headRef: 'task/11.1-parent-accounts',
  headRepository: REPOSITORY,
  baseRef: 'main',
  ...change,
});

const review = (id: number, line: string, author = REVIEWER): CommentFacts => ({
  id,
  author,
  body: `${line}\n\nMore text.`,
});

const ready = (id = 10, sha = HEAD) => review(id, `[review] ready to merge at ${sha}`);

const green: CheckFacts[] = [
  { name: 'checks', status: 'completed', conclusion: 'success' },
  { name: 'e2e', status: 'completed', conclusion: 'success' },
  { name: 'deploy-test', status: 'completed', conclusion: 'skipped' },
];

describe('the verdict of a comment', () => {
  it('reads the verdict and the sha of the first line only', () => {
    expect(verdictOf(`[review] ready to merge at ${HEAD}`)).toEqual({
      verdict: 'ready to merge',
      sha: HEAD,
      ciRed: false,
    });
    expect(verdictOf(`[review] changes needed at ${HEAD}: CI red (e2e)\n`)).toEqual({
      verdict: 'changes needed',
      sha: HEAD,
      ciRed: true,
    });
    expect(verdictOf(`Progress.\n[review] ready to merge at ${HEAD}`)).toBeNull();
    expect(verdictOf('[review] ready to merge')).toBeNull();
    expect(verdictOf(`[review] merged at ${HEAD}`)).toBeNull();
  });
});

describe('the decision to merge', () => {
  it('merges the head sha of a task pull request whose newest review there is ready to merge, with checks and e2e green', () => {
    const comments = [
      review(1, `[review] approved at ${OLD}`),
      review(2, `[review] changes needed at ${OLD}`),
      review(3, `[review] changes needed at ${HEAD}: CI red (e2e)`),
      ready(10),
    ];
    expect(decideMerge(pull(), comments, green, 10)).toEqual({ kind: 'merge', sha: HEAD });
  });

  it('leaves alone what is not a task pull request of this repository into main, or not open', () => {
    const cases: [Partial<PullFacts>, string][] = [
      [{ headRepository: 'someone/fork' }, 'not a branch of this repository'],
      [{ headRepository: null }, 'not a branch of this repository'],
      [{ headRef: 'claude/brave-tesla-4i2mge' }, 'not a task/ branch'],
      [{ baseRef: 'release' }, 'not a pull request into main'],
      [{ merged: true, state: 'closed' }, 'already merged'],
      [{ state: 'closed' }, 'closed'],
    ];
    for (const [change, words] of cases) {
      const decision = decideMerge(pull(change), [ready()], green, 10);
      expect(decision.kind, words).toBe('skip');
      expect(decision.kind === 'skip' ? decision.reason : '').toContain(
        words.replace('not a branch', 'is not a branch'),
      );
    }
  });

  it('counts only reviews by the owner account, at the head sha', () => {
    expect(
      decideMerge(pull(), [review(10, `[review] ready to merge at ${HEAD}`, 'someone')], green, 10)
        .kind,
    ).toBe('skip');
    expect(decideMerge(pull(), [ready(10, OLD)], green, 10).kind).toBe('skip');
  });

  it('merges only from the newest review at the head, and only in the run that review started', () => {
    expect(
      decideMerge(pull(), [ready(10), review(11, `[review] changes needed at ${HEAD}`)], green, 10)
        .kind,
    ).toBe('skip');
    // A second "ready to merge" at the head started its own run; this one does nothing.
    expect(decideMerge(pull(), [ready(10), ready(11)], green, 10).kind).toBe('skip');
    expect(decideMerge(pull(), [ready(10), ready(11)], green, 11)).toEqual({
      kind: 'merge',
      sha: HEAD,
    });
  });

  it('holds a ready to merge that an earlier verdict at the same sha stands against', () => {
    for (const verdict of ['changes needed', 'owner decision needed', 'stuck after three rounds']) {
      const decision = decideMerge(
        pull(),
        [review(5, `[review] ${verdict} at ${HEAD}`), ready(10)],
        green,
        10,
      );
      expect(decision, verdict).toEqual({
        kind: 'hold',
        reason: `an earlier "${verdict}" at ${HEAD} stands against the "ready to merge"`,
      });
      // An approval posted before it never hides it (review of #293: two reviewer runs on one
      // draft sha can post an approval and a "changes needed", #140).
      expect(
        decideMerge(
          pull(),
          [
            review(4, `[review] approved at ${HEAD}`),
            review(5, `[review] ${verdict} at ${HEAD} @abbosc`),
            ready(10),
          ],
          green,
          10,
        ),
        `approved, then ${verdict}`,
      ).toEqual({
        kind: 'hold',
        reason: `an earlier "${verdict}" at ${HEAD} stands against the "ready to merge"`,
      });
    }
    // A CI red verdict and an approval never stand against it.
    expect(
      decideMerge(
        pull(),
        [
          review(4, `[review] approved at ${HEAD}`),
          review(5, `[review] changes needed at ${HEAD}: CI red (checks)`),
          ready(10),
        ],
        green,
        10,
      ).kind,
    ).toBe('merge');
  });

  it('waits while checks or e2e runs or is not there, and holds a red one', () => {
    const running: CheckFacts[] = [
      { name: 'checks', status: 'completed', conclusion: 'success' },
      { name: 'e2e', status: 'in_progress', conclusion: null },
    ];
    expect(decideMerge(pull(), [ready()], running, 10).kind).toBe('wait');
    expect(decideMerge(pull(), [ready()], [green[0] as CheckFacts], 10).kind).toBe('wait');
    const red: CheckFacts[] = [
      { name: 'checks', status: 'completed', conclusion: 'success' },
      { name: 'e2e', status: 'completed', conclusion: 'failure' },
    ];
    expect(decideMerge(pull(), [ready()], red, 10)).toEqual({
      kind: 'hold',
      reason: `e2e is failure at ${HEAD}`,
    });
  });
});

/** A GitHub that answers the reads and records the writes. */
function fakeGitHub(input: {
  pull?: Partial<PullFacts>;
  comments?: CommentFacts[];
  checks?: CheckFacts[][];
  mergeStatus?: number;
}) {
  const writes: { method: string; path: string; token: string; body: unknown }[] = [];
  let checkReads = 0;
  const facts = pull(input.pull);
  const fetcher: Fetch = (request, init) => {
    const url =
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    const path = url.replace(`https://api.github.com/repos/${REPOSITORY}`, '');
    const method = init?.method ?? 'GET';
    const token = new Headers(init?.headers).get('authorization') ?? '';
    const json = (body: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    if (method !== 'GET') {
      writes.push({
        method,
        path,
        token,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      return path.endsWith('/merge')
        ? json(
            { message: input.mergeStatus === undefined ? 'Merged' : 'Head branch was modified' },
            input.mergeStatus ?? 200,
          )
        : json({});
    }
    if (path === `/pulls/${String(facts.number)}`) {
      return json({
        number: facts.number,
        state: facts.state,
        merged: facts.merged,
        head: {
          sha: facts.headSha,
          ref: facts.headRef,
          repo: facts.headRepository === null ? null : { full_name: facts.headRepository },
        },
        base: { ref: facts.baseRef },
      });
    }
    if (path.startsWith(`/issues/${String(facts.number)}/comments`)) {
      return json(
        (input.comments ?? [ready()]).map((one) => ({
          id: one.id,
          user: { login: one.author },
          body: one.body,
        })),
      );
    }
    if (path.startsWith(`/commits/${facts.headSha}/check-runs`)) {
      const all = input.checks ?? [green];
      const answer = all[Math.min(checkReads, all.length - 1)] ?? green;
      checkReads += 1;
      return json({ check_runs: answer });
    }
    return json({ message: 'Not Found' }, 404);
  };
  return { fetcher, writes };
}

const run = (github: ReturnType<typeof fakeGitHub>, mergeToken = 'owner-token') =>
  mergeReviewed({
    token: 'workflow-token',
    mergeToken,
    repository: REPOSITORY,
    pullNumber: 7,
    triggerCommentId: 10,
    fetch: github.fetcher,
    sleep: () => Promise.resolve(),
    attempts: 3,
  });

describe('a run of the merge', () => {
  it('merges the reviewed sha with the owner token, after waiting for a running check', async () => {
    const running: CheckFacts[] = [
      { name: 'checks', status: 'in_progress', conclusion: null },
      { name: 'e2e', status: 'completed', conclusion: 'success' },
    ];
    const github = fakeGitHub({ checks: [running, green] });
    expect(await run(github)).toBe('merged');
    expect(github.writes).toEqual([
      {
        method: 'PUT',
        path: '/pulls/7/merge',
        token: 'Bearer owner-token',
        body: { merge_method: 'merge', sha: HEAD },
      },
    ]);
  });

  it('writes nothing for a pull request that is not its to merge', async () => {
    const github = fakeGitHub({ pull: { headRef: 'docs/release-2' } });
    expect(await run(github)).toBe('skipped');
    expect(github.writes).toEqual([]);
  });

  it('tells the owner, and merges nothing, when the token is not set, the checks never finish or GitHub refuses', async () => {
    const running: CheckFacts[] = [{ name: 'checks', status: 'queued', conclusion: null }];
    for (const [github, token, words] of [
      [fakeGitHub({}), '', 'the repository secret MERGE_TOKEN is not set'],
      [fakeGitHub({ checks: [running] }), 'owner-token', 'checks is not finished'],
      [
        fakeGitHub({ mergeStatus: 409 }),
        'owner-token',
        'GitHub refused the merge (409: Head branch was modified)',
      ],
    ] as const) {
      expect(await run(github, token)).toBe('held');
      const notices = github.writes.filter((write) => write.method === 'POST');
      expect(notices.map((write) => write.path)).toEqual([
        '/issues/7/comments',
        '/issues/7/labels',
      ]);
      expect(notices.every((write) => write.token === 'Bearer workflow-token')).toBe(true);
      expect(JSON.stringify(notices[0]?.body)).toContain(`@${REVIEWER}`);
      expect(JSON.stringify(notices[0]?.body)).toContain(words);
      expect(notices[1]?.body).toEqual({ labels: ['needs-owner'] });
      // Only the refused merge was ever tried; no token and no green checks try none.
      expect(github.writes.filter((write) => write.path.endsWith('/merge')).length).toBe(
        words.startsWith('GitHub refused') ? 1 : 0,
      );
    }
  });
});
