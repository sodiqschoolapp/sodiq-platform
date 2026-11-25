// The builder's heartbeat (docs/cloud-loop.md, section 9; owner, 25 November
// 2026: stalls and two sessions on one task cost the loop up to an hour each).
//
// Registered in .claude/settings.json for PreToolUse (every tool) and Stop.
// It acts only in a session whose checkout is on a `task/` branch with an open
// pull request; everywhere else it exits at once. `SODIQ_HEARTBEAT=off` turns
// it off (a person helping on a task branch by hand).
//
// PreToolUse, at most every two minutes:
// - another session's heartbeat on the pull request is fresh (working, under
//   15 minutes old): this session is a second builder; the tool is blocked
//   (exit 2) and the session is told to stop and post nothing;
// - otherwise the heartbeat comment says "working" now, with this session's id.
// Stop:
// - when the task still needs its builder (scripts/loop/task-state.mjs) and
//   this session owns it, the stop is refused twice in a row at most, telling
//   the builder to go on (a builder that ended its turn while waiting was found
//   only by the hourly start routine, 45 minutes later);
// - otherwise the heartbeat says "stopped", so the watchdog resumes at once a
//   task that needs its builder.
//
// A hook must never break the session: every error is swallowed and the exit
// code is 0, except the deliberate block of a second builder.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HEARTBEAT_EVERY_MS,
  heartbeatAlive,
  heartbeatBody,
  needsBuilder,
  readHeartbeat,
} from '../loop/task-state.mjs';

const REPO = 'sodiqschoolapp/sodiq-platform';
const MAX_STOP_BLOCKS = 2;

function run(command, args, cwd) {
  const out = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 15_000 });
  if (out.status !== 0) throw new Error(`${command} ${args[0]} failed: ${out.stderr ?? ''}`);
  return out.stdout.trim();
}

const api = (args, cwd) => JSON.parse(run('gh', ['api', ...args], cwd) || 'null');

function allComments(number, cwd) {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = api([`repos/${REPO}/issues/${number}/comments?per_page=100&page=${page}`], cwd);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments;
}

function statePath(session) {
  const dir = path.join(os.tmpdir(), 'sodiq-heartbeat');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${session.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

function load(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function headChecksFailed(sha, cwd) {
  const runs = api([`repos/${REPO}/commits/${sha}/check-runs?per_page=100`], cwd).check_runs ?? [];
  return runs.some(
    (one) => (one.name === 'checks' || one.name === 'e2e') && one.conclusion === 'failure',
  );
}

function writeBeat(number, beatId, body, cwd) {
  if (beatId) {
    api(['-X', 'PATCH', `repos/${REPO}/issues/comments/${beatId}`, '-f', `body=${body}`], cwd);
    return beatId;
  }
  return api(['-X', 'POST', `repos/${REPO}/issues/${number}/comments`, '-f', `body=${body}`], cwd)
    .id;
}

function main() {
  if (process.env.SODIQ_HEARTBEAT === 'off') return 0;
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const session = String(input.session_id ?? '');
  const event = String(input.hook_event_name ?? '');
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  if (session === '' || (event !== 'PreToolUse' && event !== 'Stop')) return 0;

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (!branch.startsWith('task/')) return 0;

  const file = statePath(session);
  const state = load(file);
  const now = new Date();
  if (event === 'PreToolUse') {
    state.stopBlocks = 0;
    if (state.branch === branch && now.getTime() - (state.lastBeat ?? 0) < HEARTBEAT_EVERY_MS) {
      writeFileSync(file, JSON.stringify(state));
      return 0;
    }
  }

  const [pull] = api([`repos/${REPO}/pulls?state=open&head=${REPO.split('/')[0]}:${branch}`], cwd);
  if (pull === undefined) return 0;
  const comments = allComments(pull.number, cwd);
  const beat = readHeartbeat(comments);
  const other = beat !== null && beat.session !== session && heartbeatAlive(beat, now);

  if (other) {
    if (event === 'PreToolUse') {
      process.stderr.write(
        `Another session (${beat.session}) is building ${branch} (pull request #${pull.number}); its heartbeat is from ${beat.at}. ` +
          'Two sessions must never build one task (docs/cloud-loop.md, section 9). Stop now: post nothing, push nothing, end your turn.\n',
      );
      return 2;
    }
    return 0; // A second builder may stop; it does not touch the heartbeat.
  }

  if (event === 'Stop') {
    const need = needsBuilder({
      draft: pull.draft,
      labels: (pull.labels ?? []).map((label) => label.name),
      headSha: pull.head.sha,
      comments,
      headChecksFailed: headChecksFailed(pull.head.sha, cwd),
    });
    if (need.needed && (state.stopBlocks ?? 0) < MAX_STOP_BLOCKS) {
      state.stopBlocks = (state.stopBlocks ?? 0) + 1;
      writeFileSync(file, JSON.stringify(state));
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason:
            `Pull request #${pull.number} still needs its builder (${need.why}). Do not end the session: go on with the task ` +
            '(next-task step 13, finish-task steps 8 and 9). Push every commit. To wait for CI or a review, wait in this session ' +
            'with a shell loop as the skills say, never by ending the turn. Stop only for what the skills name (the owner, the 45-minute ' +
            'wait for the reviewer after the pull request is ready).',
        }),
      );
      return 0;
    }
  }

  const body = heartbeatBody({
    at: now.toISOString(),
    session,
    state: event === 'Stop' ? 'stopped' : 'working',
  });
  state.beatId = writeBeat(pull.number, beat?.id, body, cwd);
  state.branch = branch;
  state.lastBeat = now.getTime();
  writeFileSync(file, JSON.stringify(state));
  return 0;
}

let code;
try {
  code = main();
} catch {
  code = 0;
}
process.exit(code);
