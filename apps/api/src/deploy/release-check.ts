import type { Fetch } from './render.js';

/**
 * The release check of production (task 10.4, decision 5 of pull request
 * #244): only a commit of `main` that passed `checks` and `e2e` and was
 * deployed to the test environment goes to production (owner's answer 20:
 * "every change is tried there first"; `14`, Whole system, Test environment).
 * Read from GitHub's REST API with the workflow's own token, which needs
 * `actions: read`; the token goes in a header and never into a message.
 */

export const GITHUB_API = 'https://api.github.com';

/** The workflow of `.github/workflows/ci.yml` and the jobs a release needs. */
export const CI_WORKFLOW = 'CI';
export const REQUIRED_JOBS = ['checks', 'e2e', 'deploy-test'] as const;

export class ReleaseCheckError extends Error {}

export interface ReleaseCheckOptions {
  token: string;
  /** `owner/name`. */
  repository: string;
  commitId: string;
  fetch?: Fetch;
}

interface Run {
  id: number;
  name: string;
  head_branch: string;
  event: string;
  run_number: number;
}

interface Job {
  name: string;
  status: string;
  conclusion: string | null;
}

/** Throws with what is missing; returns the CI run that proves the commit. */
export async function checkRelease(options: ReleaseCheckOptions): Promise<number> {
  const commit = options.commitId;
  const runs = await get<{ workflow_runs: Run[] }>(
    options,
    `/repos/${options.repository}/actions/runs?head_sha=${commit}&branch=main&event=push&per_page=100`,
  );
  const ci = runs.workflow_runs
    .filter((run) => run.name === CI_WORKFLOW && run.head_branch === 'main' && run.event === 'push')
    .sort((a, b) => b.run_number - a.run_number)[0];
  if (ci === undefined) {
    throw new ReleaseCheckError(
      `${commit} has no ${CI_WORKFLOW} run of a push to main: only a merged commit of main goes to production.`,
    );
  }
  // The latest attempt of each job (a re-run counts, an older failure does not).
  const jobs = await get<{ jobs: Job[] }>(
    options,
    `/repos/${options.repository}/actions/runs/${String(ci.id)}/jobs?filter=latest&per_page=100`,
  );
  const missing = REQUIRED_JOBS.filter(
    (name) =>
      !jobs.jobs.some(
        (job) => job.name === name && job.status === 'completed' && job.conclusion === 'success',
      ),
  );
  if (missing.length > 0) {
    throw new ReleaseCheckError(
      `${commit} did not pass ${missing.join(', ')} in ${CI_WORKFLOW} run ${String(ci.id)}: ` +
        'deploy a commit of main whose test deploy finished (docs/deploy.md, Production).',
    );
  }
  return ci.id;
}

async function get<T>(options: ReleaseCheckOptions, path: string): Promise<T> {
  const fetcher = options.fetch ?? fetch;
  const answer = await fetcher(`${GITHUB_API}${path}`, {
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!answer.ok) {
    throw new ReleaseCheckError(
      `GitHub answered ${String(answer.status)} for ${path.split('?')[0] ?? path}.`,
    );
  }
  return (await answer.json()) as T;
}
