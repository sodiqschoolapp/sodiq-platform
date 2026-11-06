import { GITHUB_API } from './release-check.js';
import type { Fetch, Sleep } from './render.js';

/**
 * The merge of a reviewed task pull request (`.github/workflows/merge-reviewed.yml`; owner,
 * 6 November 2026). The review routine decides "ready to merge" and GitHub Actions carries the
 * merge out: from 6 November 2026 the routine's own merge call was refused by its session's
 * permission check on every task (#285, #290, #292), and cloud sessions offer no mode without
 * that check (`docs/decisions.md`, "6 November 2026: GitHub merges a reviewed task").
 *
 * The rule is the one of `.claude/skills/review-pr` step 10, read from GitHub on every attempt:
 * a pull request of this repository, from a `task/` branch, into `main`, whose newest `[review]`
 * by the owner's account at its head sha is `ready to merge`, with no other verdict at that sha
 * standing against it, and with `checks` and `e2e` green at that sha. Only that sha is merged.
 */

/** The account every session and routine acts as; only its `[review]` comments count. */
export const REVIEWER = 'abbosc';
export const REPOSITORY = 'sodiqschoolapp/sodiq-platform';
/** The checks of `.github/workflows/ci.yml` a merge needs at the head sha. */
export const MERGE_CHECKS = ['checks', 'e2e'] as const;

export interface PullFacts {
  number: number;
  state: string;
  merged: boolean;
  headSha: string;
  headRef: string;
  /** `owner/name` of the head repository; `null` when it is gone. */
  headRepository: string | null;
  baseRef: string;
}

export interface CommentFacts {
  id: number;
  author: string;
  body: string;
}

export interface CheckFacts {
  name: string;
  status: string;
  conclusion: string | null;
}

const VERDICTS = [
  'ready to merge',
  'approved',
  'changes needed',
  'owner decision needed',
  'stuck after three rounds',
] as const;
type Verdict = (typeof VERDICTS)[number];

interface Review {
  id: number;
  verdict: Verdict;
  sha: string;
  /** A `changes needed … : CI red (…)` verdict, which never stands against a merge. */
  ciRed: boolean;
}

/** The verdict a comment's first line gives, or `null` when it is not a `[review]` with a sha. */
export function verdictOf(body: string): Omit<Review, 'id'> | null {
  const first = body.split('\n', 1)[0] ?? '';
  const found =
    /^\[review\] (ready to merge|approved|changes needed|owner decision needed|stuck after three rounds) at ([0-9a-f]{40})\b/.exec(
      first,
    );
  const verdict = VERDICTS.find((one) => one === found?.[1]);
  const sha = found?.[2];
  if (verdict === undefined || sha === undefined) return null;
  return { verdict, sha, ciRed: first.includes(': CI red') };
}

export type MergeDecision =
  | { kind: 'merge'; sha: string }
  /** A check of the head sha is still running or not there yet. */
  | { kind: 'wait'; reason: string }
  /** Not this workflow's to merge; nothing is posted. */
  | { kind: 'skip'; reason: string }
  /** Ready to merge but held: the owner is told. */
  | { kind: 'hold'; reason: string };

/**
 * Whether to merge, from the pull request, its comments in the order they were posted, the
 * check runs of its head sha and the comment that started the run.
 */
export function decideMerge(
  pull: PullFacts,
  comments: readonly CommentFacts[],
  checks: readonly CheckFacts[],
  triggerCommentId: number,
): MergeDecision {
  if (pull.headRepository !== REPOSITORY) {
    return { kind: 'skip', reason: 'the head is not a branch of this repository' };
  }
  if (!pull.headRef.startsWith('task/')) {
    return { kind: 'skip', reason: 'not a task/ branch: the owner merges it' };
  }
  if (pull.baseRef !== 'main') return { kind: 'skip', reason: 'not a pull request into main' };
  if (pull.merged) return { kind: 'skip', reason: 'already merged' };
  if (pull.state !== 'open') return { kind: 'skip', reason: 'closed' };

  const atHead: Review[] = comments.flatMap((comment) => {
    if (comment.author !== REVIEWER) return [];
    const review = verdictOf(comment.body);
    return review === null || review.sha !== pull.headSha ? [] : [{ id: comment.id, ...review }];
  });
  const newest = atHead.at(-1);
  if (newest?.verdict !== 'ready to merge') {
    return {
      kind: 'skip',
      reason: `the newest review at the head ${pull.headSha} is not "ready to merge"`,
    };
  }
  if (newest.id !== triggerCommentId) {
    return { kind: 'skip', reason: 'a newer review at the head started its own run' };
  }
  const against = atHead.find(
    (review) => review.id !== newest.id && review.verdict !== 'ready to merge' && !review.ciRed,
  );
  if (against !== undefined && against.verdict !== 'approved') {
    return {
      kind: 'hold',
      reason: `an earlier "${against.verdict}" at ${pull.headSha} stands against the "ready to merge"`,
    };
  }

  for (const name of MERGE_CHECKS) {
    const runs = checks.filter((check) => check.name === name);
    if (runs.length === 0 || runs.some((check) => check.status !== 'completed')) {
      return { kind: 'wait', reason: `${name} is not finished at ${pull.headSha}` };
    }
    const failed = runs.find((check) => check.conclusion !== 'success');
    if (failed !== undefined) {
      return {
        kind: 'hold',
        reason: `${name} is ${failed.conclusion ?? 'unknown'} at ${pull.headSha}`,
      };
    }
  }
  return { kind: 'merge', sha: pull.headSha };
}

export interface MergeReviewedOptions {
  /** The workflow's own token: reads, the notice and the label. */
  token: string;
  /** The owner's token of the secret MERGE_TOKEN: the merge only, so the merge starts CI. */
  mergeToken: string;
  repository: string;
  pullNumber: number;
  triggerCommentId: number;
  fetch?: Fetch;
  sleep?: Sleep;
  log?: (line: string) => void;
  /** How often to read the checks again while one is running, and how many times. */
  waitMs?: number;
  attempts?: number;
}

export type MergeOutcome = 'merged' | 'skipped' | 'held';

/** Reads, decides, waits while a check runs, and merges or tells the owner. */
export async function mergeReviewed(options: MergeReviewedOptions): Promise<MergeOutcome> {
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const attempts = options.attempts ?? 30;
  let decision: MergeDecision = { kind: 'wait', reason: 'not read yet' };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    decision = await decideNow(options);
    if (decision.kind !== 'wait') break;
    log(`Waiting: ${decision.reason}.`);
    if (attempt < attempts) await sleep(options.waitMs ?? 30_000);
  }
  if (decision.kind === 'wait') {
    decision = { kind: 'hold', reason: `${decision.reason} after 15 minutes` };
  }
  if (decision.kind === 'skip') {
    log(`Not merged: ${decision.reason}.`);
    return 'skipped';
  }
  if (decision.kind === 'merge' && options.mergeToken === '') {
    // The built-in token would merge, but a merge made with it starts no workflow: no CI on main,
    // no test deploy, no next task (GitHub's rule for its own token).
    decision = { kind: 'hold', reason: 'the repository secret MERGE_TOKEN is not set' };
  }
  if (decision.kind === 'hold') {
    await tellOwner(options, decision.reason);
    log(`Held: ${decision.reason}.`);
    return 'held';
  }
  const answer = await call(
    options,
    options.mergeToken,
    'PUT',
    `/pulls/${String(options.pullNumber)}/merge`,
    {
      merge_method: 'merge',
      sha: decision.sha,
    },
  );
  if (!answer.ok) {
    const reason = `GitHub refused the merge (${String(answer.status)}${await messageOf(answer)})`;
    await tellOwner(options, reason);
    log(`Held: ${reason}.`);
    return 'held';
  }
  log(`Merged #${String(options.pullNumber)} at ${decision.sha}.`);
  return 'merged';
}

async function decideNow(options: MergeReviewedOptions): Promise<MergeDecision> {
  const pull = await read<{
    number: number;
    state: string;
    merged: boolean;
    head: { sha: string; ref: string; repo: { full_name: string } | null };
    base: { ref: string };
  }>(options, `/pulls/${String(options.pullNumber)}`);
  const comments: CommentFacts[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await read<{ id: number; user: { login: string } | null; body: string | null }[]>(
      options,
      `/issues/${String(options.pullNumber)}/comments?per_page=100&page=${String(page)}`,
    );
    comments.push(
      ...batch.map((one) => ({ id: one.id, author: one.user?.login ?? '', body: one.body ?? '' })),
    );
    if (batch.length < 100) break;
  }
  const checks = await read<{ check_runs: CheckFacts[] }>(
    options,
    `/commits/${pull.head.sha}/check-runs?filter=latest&per_page=100`,
  );
  return decideMerge(
    {
      number: pull.number,
      state: pull.state,
      merged: pull.merged,
      headSha: pull.head.sha,
      headRef: pull.head.ref,
      headRepository: pull.head.repo?.full_name ?? null,
      baseRef: pull.base.ref,
    },
    comments,
    checks.check_runs,
    options.triggerCommentId,
  );
}

/** One comment that buzzes the owner's phone, and the label the loop reads. */
async function tellOwner(options: MergeReviewedOptions, reason: string): Promise<void> {
  const number = String(options.pullNumber);
  await call(options, options.token, 'POST', `/issues/${number}/comments`, {
    body: `@${REVIEWER} The workflow Merge reviewed did not merge #${number}: ${reason}. Merge by hand when you agree.`,
  });
  await call(options, options.token, 'POST', `/issues/${number}/labels`, {
    labels: ['needs-owner'],
  });
}

async function read<T>(options: MergeReviewedOptions, path: string): Promise<T> {
  const answer = await call(options, options.token, 'GET', path);
  if (!answer.ok) {
    throw new Error(`GitHub answered ${String(answer.status)} for ${path.split('?')[0] ?? path}.`);
  }
  return (await answer.json()) as T;
}

function call(
  options: MergeReviewedOptions,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const fetcher = options.fetch ?? fetch;
  return fetcher(`${GITHUB_API}/repos/${options.repository}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function messageOf(answer: Response): Promise<string> {
  const text = await answer.text().catch(() => '');
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      return `: ${String(parsed.message)}`;
    }
  } catch {
    // Not JSON: no message.
  }
  return '';
}
