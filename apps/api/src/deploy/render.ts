/**
 * Deploys on Render through its API (task 0.10): one deploy per service at
 * the commit CI tested, then a wait until each is live. Run by the deploy job
 * of `.github/workflows/ci.yml` after the migrations; the services never run
 * it. The key is read from the environment and never printed; a log line
 * holds service ids, deploy ids and statuses only.
 */

export const RENDER_API = 'https://api.render.com/v1';

/** The statuses of a deploy, as the API names them. */
export const FAILED_STATUSES = new Set([
  'build_failed',
  'update_failed',
  'pre_deploy_failed',
  'canceled',
  'deactivated',
]);
export const LIVE_STATUS = 'live';

/** How often a deploy is looked at, and how many looks before giving up (20 minutes). */
export const POLL_MS = 15_000;
export const MAX_POLLS = 80;

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

export interface DeployOptions {
  apiKey: string;
  serviceIds: string[];
  commitId: string;
  fetch?: Fetch;
  sleep?: Sleep;
  log?: (line: string) => void;
}

export interface DeployResult {
  serviceId: string;
  deployId: string;
  status: string;
}

export class DeployError extends Error {}

interface DeployAnswer {
  id: string;
  status: string;
}

/**
 * Starts the deploys of every service at once and waits for all of them. A
 * deploy that fails, or one that is not live after the last look, fails the
 * whole run; Render keeps the previous version of that service live.
 */
export async function deployServices(options: DeployOptions): Promise<DeployResult[]> {
  const started = await Promise.all(
    options.serviceIds.map((serviceId) => startDeploy(options, serviceId)),
  );
  return Promise.all(started.map((deploy) => waitForDeploy(options, deploy)));
}

async function startDeploy(options: DeployOptions, serviceId: string): Promise<DeployResult> {
  const answer = await call(
    options,
    'POST',
    `/services/${serviceId}/deploys`,
    JSON.stringify({ clearCache: 'do_not_clear', commitId: options.commitId }),
  );
  options.log?.(`${serviceId}: deploy ${answer.id} ${answer.status}`);
  return { serviceId, deployId: answer.id, status: answer.status };
}

async function waitForDeploy(options: DeployOptions, deploy: DeployResult): Promise<DeployResult> {
  const sleep = options.sleep ?? defaultSleep;
  let current = deploy;
  // The status of the creation and of each of the MAX_POLLS looks is judged,
  // the last one included.
  for (let poll = 0; ; poll += 1) {
    if (current.status === LIVE_STATUS) {
      options.log?.(`${current.serviceId}: deploy ${current.deployId} is live`);
      return current;
    }
    if (FAILED_STATUSES.has(current.status)) {
      throw new DeployError(
        `${current.serviceId}: deploy ${current.deployId} ended as ${current.status}.`,
      );
    }
    if (poll >= MAX_POLLS) {
      throw new DeployError(
        `${current.serviceId}: deploy ${current.deployId} is still ${current.status} after ${String(
          (MAX_POLLS * POLL_MS) / 60_000,
        )} minutes.`,
      );
    }
    await sleep(POLL_MS);
    const answer = await call(
      options,
      'GET',
      `/services/${current.serviceId}/deploys/${current.deployId}`,
    );
    if (answer.status !== current.status) {
      options.log?.(`${current.serviceId}: deploy ${current.deployId} ${answer.status}`);
    }
    current = { ...current, status: answer.status };
  }
}

async function call(
  options: DeployOptions,
  method: 'GET' | 'POST',
  path: string,
  body?: string,
): Promise<DeployAnswer> {
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(`${RENDER_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
  if (!response.ok) {
    throw new DeployError(`Render answered ${String(response.status)} to ${method} ${path}.`);
  }
  const parsed: unknown = await response.json().catch(() => undefined);
  if (!isDeployAnswer(parsed)) {
    throw new DeployError(`Render's answer to ${method} ${path} is not a deploy.`);
  }
  return parsed;
}

function isDeployAnswer(value: unknown): value is DeployAnswer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { status?: unknown }).status === 'string'
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
