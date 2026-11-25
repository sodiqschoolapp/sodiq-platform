// The watchdog (docs/cloud-loop.md, section 9), run every five minutes by
// .github/workflows/watchdog.yml. For each open pull request from a `task/`
// branch of this repository that needs its builder now (task-state.mjs), it
// reads the builder's heartbeat; when the heartbeat says stopped or is older
// than 15 minutes (without one: nothing by the loop's account for 45 minutes),
// and nothing resumed the task in the last ten minutes, it posts one comment
// and fires the start routine with "Stalled #<n>". It never fires for a task
// whose builder is alive, so no second session starts.
//
// Reads GITHUB_TOKEN, GITHUB_REPOSITORY, START_ROUTINE_URL, START_ROUTINE_TOKEN.
// `--dry-run` prints the decisions and fires nothing.
import { builderGone, needsBuilder, recentlyResumed } from './task-state.mjs';

const dryRun = process.argv.includes('--dry-run');
const repo = process.env.GITHUB_REPOSITORY ?? 'sodiqschoolapp/sodiq-platform';
const token = process.env.GITHUB_TOKEN;

async function gh(path, init = {}) {
  const response = await fetch(`https://api.github.com/${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status}`);
  return response.json();
}

async function comments(number) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await gh(`repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function fire(number, why) {
  const url = process.env.START_ROUTINE_URL;
  const secret = process.env.START_ROUTINE_TOKEN;
  if (!url || !secret)
    throw new Error('START_ROUTINE_URL and START_ROUTINE_TOKEN must both be set.');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: `Stalled #${number}: ${why}` }),
    signal: AbortSignal.timeout(60_000),
  });
  console.log(`#${number}: start routine fired, HTTP ${response.status}`);
  if (!response.ok) throw new Error(`The start routine was not fired for #${number}.`);
}

const now = new Date();
const pulls = await gh(`repos/${repo}/pulls?state=open&base=main&per_page=100`);
let failed = false;
for (const pull of pulls) {
  if (pull.head.repo?.full_name !== repo || !pull.head.ref.startsWith('task/')) continue;
  try {
    const list = await comments(pull.number);
    const checks = await gh(`repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`);
    const need = needsBuilder({
      draft: pull.draft,
      labels: pull.labels.map((label) => label.name),
      headSha: pull.head.sha,
      comments: list,
      headChecksFailed: checks.check_runs.some(
        (one) => (one.name === 'checks' || one.name === 'e2e') && one.conclusion === 'failure',
      ),
    });
    if (!need.needed) {
      console.log(`#${pull.number}: ${need.why}`);
      continue;
    }
    const commit = await gh(`repos/${repo}/commits/${pull.head.sha}`);
    const { gone, beat } = builderGone(
      { comments: list, headCommitAt: commit.commit.committer.date },
      now,
    );
    const seen = beat === null ? 'no heartbeat' : `heartbeat ${beat.state} at ${beat.at}`;
    if (!gone) {
      console.log(`#${pull.number}: ${need.why}; builder alive (${seen})`);
      continue;
    }
    if (recentlyResumed(list, now)) {
      console.log(
        `#${pull.number}: ${need.why}; ${seen}; resumed or fired in the last ten minutes, waiting`,
      );
      continue;
    }
    const why = `${need.why}; ${seen}`;
    console.log(`#${pull.number}: stalled (${why})`);
    if (dryRun) continue;
    await gh(`repos/${repo}/issues/${pull.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body: `Watchdog: the builder is gone (${why}); the start routine resumes the task now.`,
      }),
    });
    await fire(pull.number, why);
  } catch (error) {
    failed = true;
    console.error(`#${pull.number}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
