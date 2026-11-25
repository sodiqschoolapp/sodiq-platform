// Run with `node --test scripts/loop/task-state.test.mjs` (CI: the step "Tests of the loop's scripts" of the job lint-types).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  builderGone,
  firesOnHead,
  heartbeatAlive,
  heartbeatBody,
  needsBuilder,
  newestVerdict,
  readHeartbeat,
  recentlyResumed,
} from './task-state.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const by = (body, created_at = '2026-11-25T09:00:00Z', login = 'abbosc', id = 1) => ({
  id,
  body,
  created_at,
  user: { login },
});
const pr = (comments, extra = {}) => ({
  draft: false,
  labels: [],
  headSha: HEAD,
  comments,
  headChecksFailed: false,
  ...extra,
});

test('the newest verdict is the last [review] by the loop account, with its kind and sha', () => {
  const verdict = newestVerdict([
    by(`[review] approved at ${OLD}`),
    by(`[review] changes needed at ${HEAD}: CI red (e2e)`),
    by('[review] ready to merge at x', '2026-11-25T10:00:00Z', 'someone-else'),
  ]);
  assert.deepEqual(
    { kind: verdict.kind, sha: verdict.sha, ciRed: verdict.ciRed },
    { kind: 'changes needed', sha: HEAD, ciRed: true },
  );
  assert.equal(newestVerdict([by('Acting on the review.')]), null);
});

test('a task needs its builder while its approved plan is built, and after changes needed or red CI at the head', () => {
  assert.equal(needsBuilder(pr([by(`[review] approved at ${OLD}`)], { draft: true })).needed, true);
  assert.equal(needsBuilder(pr([by(`[review] changes needed at ${HEAD}`)])).needed, true);
  assert.equal(
    needsBuilder(pr([by(`[review] changes needed at ${OLD}`)], { headChecksFailed: true })).needed,
    true,
  );
});

test('a task waiting for the reviewer, the owner or the merge does not need its builder', () => {
  // The plan waits for its review.
  assert.equal(needsBuilder(pr([], { draft: true })).needed, false);
  // A fix was pushed after changes needed: the new head waits for the reviewer.
  assert.equal(needsBuilder(pr([by(`[review] changes needed at ${OLD}`)])).needed, false);
  // Marked ready after an approved plan, CI green.
  assert.equal(needsBuilder(pr([by(`[review] approved at ${OLD}`)])).needed, false);
  assert.equal(needsBuilder(pr([by(`[review] ready to merge at ${HEAD}`)])).needed, false);
  assert.equal(
    needsBuilder(pr([by(`[review] owner decision needed at ${HEAD} @abbosc`)])).needed,
    false,
  );
  assert.equal(
    needsBuilder(pr([by(`[review] approved at ${OLD}`)], { draft: true, labels: ['needs-owner'] }))
      .needed,
    false,
  );
});

test('the heartbeat is read back from the body the hook writes', () => {
  const body = heartbeatBody({
    at: '2026-11-25T09:58:00.000Z',
    session: 'cse_one',
    state: 'working',
  });
  const beat = readHeartbeat([by('Progress: x'), { ...by(body), id: 7 }]);
  assert.deepEqual(beat, {
    id: 7,
    at: '2026-11-25T09:58:00.000Z',
    session: 'cse_one',
    state: 'working',
  });
  // Another author's copy of the marker is ignored.
  assert.equal(readHeartbeat([by(body, undefined, 'someone-else')]), null);
});

test('a heartbeat is alive for 15 minutes, and never once it says stopped', () => {
  const beat = { at: '2026-11-25T09:00:00Z', state: 'working' };
  assert.equal(heartbeatAlive(beat, new Date('2026-11-25T09:14:59Z')), true);
  assert.equal(heartbeatAlive(beat, new Date('2026-11-25T09:15:00Z')), false);
  assert.equal(
    heartbeatAlive({ ...beat, state: 'stopped' }, new Date('2026-11-25T09:01:00Z')),
    false,
  );
});

test('without a heartbeat, the builder is gone after 45 minutes with nothing by the loop account', () => {
  const comments = [by('Progress: x', '2026-11-25T09:00:00Z')];
  const at = (iso) =>
    builderGone({ comments, headCommitAt: '2026-11-25T08:00:00Z' }, new Date(iso)).gone;
  assert.equal(at('2026-11-25T09:44:00Z'), false);
  assert.equal(at('2026-11-25T09:45:00Z'), true);
});

test('a resume or a watchdog fire within ten minutes holds the next fire', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  assert.equal(
    recentlyResumed([by('Resumed by the start routine.', '2026-11-25T09:55:00Z')], now),
    true,
  );
  assert.equal(
    recentlyResumed([by('Watchdog: fired', '2026-11-25T09:49:00Z', 'github-actions[bot]')], now),
    false,
  );
});

test('a CI red verdict whose head passed on a re-run waits for the reviewer, not the builder', () => {
  const red = [by(`[review] changes needed at ${HEAD}: CI red (e2e)`)];
  assert.equal(needsBuilder(pr(red, { headChecksFailed: true })).needed, true);
  assert.equal(needsBuilder(pr(red, { headChecksFailed: false })).needed, false);
});

test('only the loop account resumes and only the workflow fires: another author holds nothing', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  const at = '2026-11-25T09:58:00Z';
  assert.equal(
    recentlyResumed([by('Watchdog: the builder is gone', at, 'github-actions[bot]')], now),
    true,
  );
  assert.equal(recentlyResumed([by('Watchdog: x', at, 'someone-else')], now), false);
  assert.equal(
    recentlyResumed([by('Resumed by the start routine.', at, 'someone-else')], now),
    false,
  );
  assert.equal(
    recentlyResumed([by('Resumed by the start routine.', at, 'github-actions[bot]')], now),
    false,
  );
});

test('the fires on one head count the workflow comments after the head commit only', () => {
  const comments = [
    by('Watchdog: the builder is gone (x)', '2026-11-25T08:00:00Z', 'github-actions[bot]'),
    by('Watchdog: the builder is gone (x)', '2026-11-25T09:10:00Z', 'github-actions[bot]'),
    by('Watchdog: the builder is gone (x)', '2026-11-25T09:20:00Z', 'someone-else'),
  ];
  assert.equal(firesOnHead(comments, '2026-11-25T09:00:00Z'), 1);
});
