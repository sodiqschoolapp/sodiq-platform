// The state of a task pull request as the loop reads it, shared by the
// builder's heartbeat hook (scripts/hooks/builder-heartbeat.mjs) and the
// watchdog workflow (.github/workflows/watchdog.yml, scripts/loop/watchdog.mjs),
// so both decide "does this task need its builder now" and "is its builder
// alive" the same way (docs/cloud-loop.md, section 9).
//
// Pure functions over what the GitHub REST API answers; no I/O here.

/** The account every session and routine of the loop acts as. */
export const LOOP_ACCOUNT = 'abbosc';

/** The marker of the one heartbeat comment of a task pull request. */
export const HEARTBEAT_MARKER = '<!-- builder-heartbeat -->';

/** A working builder always ends a tool call within this time (a command times out at 10 minutes). */
export const HEARTBEAT_FRESH_MS = 15 * 60_000;

/** The hook writes the heartbeat at most this often. */
export const HEARTBEAT_EVERY_MS = 2 * 60_000;

/** A pull request without a heartbeat comment falls back to the silence rule of before. */
export const SILENCE_STALL_MS = 45 * 60_000;

/** The newest `[review]` by the loop's account: its kind and the sha it names. */
export function newestVerdict(comments) {
  const reviews = comments.filter(
    (one) =>
      one.user?.login === LOOP_ACCOUNT &&
      typeof one.body === 'string' &&
      one.body.startsWith('[review]'),
  );
  const last = reviews.at(-1);
  if (last === undefined) return null;
  const line = last.body.split('\n', 1)[0];
  const kind =
    /^\[review\] (approved|changes needed|ready to merge|owner decision needed|stuck after three rounds|after the merge)/.exec(
      line,
    )?.[1] ?? 'other';
  const sha = /\bat ([0-9a-f]{40})\b/.exec(line)?.[1] ?? null;
  return { kind, sha, at: last.created_at, ciRed: /: CI red\b/.test(line) };
}

/**
 * Whether the task needs its builder now, and why. A task that waits for the
 * reviewer, for the owner, or for a merge does not: nobody should build then.
 *
 * @param {{ draft: boolean, labels: string[], headSha: string, comments: object[], headChecksFailed: boolean }} pr
 */
export function needsBuilder(pr) {
  if (pr.labels.includes('needs-owner'))
    return { needed: false, why: 'waits for the owner (needs-owner)' };
  const verdict = newestVerdict(pr.comments);
  if (verdict === null) return { needed: false, why: 'the plan waits for its review' };
  if (verdict.kind === 'owner decision needed' || verdict.kind === 'stuck after three rounds') {
    return { needed: false, why: `waits for the owner (${verdict.kind})` };
  }
  if (pr.draft && verdict.kind === 'approved')
    return { needed: true, why: 'the approved plan is being built' };
  if (verdict.kind === 'changes needed' && verdict.sha === pr.headSha) {
    return {
      needed: true,
      why: verdict.ciRed ? 'a CI red verdict at the head' : 'changes needed at the head',
    };
  }
  if (!pr.draft && pr.headChecksFailed && verdict.sha !== pr.headSha) {
    return { needed: true, why: 'CI failed at the head' };
  }
  return { needed: false, why: 'waits for the reviewer or the merge' };
}

/** The heartbeat comment: `{ id, at, session, state }`, or null. */
export function readHeartbeat(comments) {
  const found = [...comments]
    .reverse()
    .find(
      (one) =>
        one.user?.login === LOOP_ACCOUNT &&
        typeof one.body === 'string' &&
        one.body.includes(HEARTBEAT_MARKER),
    );
  if (found === undefined) return null;
  const at = /at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/.exec(found.body)?.[1] ?? null;
  const session = /session `([^`]+)`/.exec(found.body)?.[1] ?? null;
  const state = /\b(working|stopped)\b/.exec(found.body)?.[1] ?? 'working';
  return { id: found.id, at, session, state };
}

/** The body of the heartbeat comment. */
export function heartbeatBody({ at, session, state }) {
  return `${HEARTBEAT_MARKER}\nBuilder heartbeat: ${state} at ${at}, session \`${session}\`. Written by the builder's hook (docs/cloud-loop.md, section 9); the watchdog resumes the task when it says stopped or is older than 15 minutes while the task needs its builder.`;
}

/** Whether a heartbeat shows a live builder at `now` (a Date). */
export function heartbeatAlive(beat, now) {
  if (beat === null || beat.at === null || beat.state === 'stopped') return false;
  return now.getTime() - Date.parse(beat.at) < HEARTBEAT_FRESH_MS;
}

/**
 * Whether the builder of a task that needs it is gone: its heartbeat says
 * stopped or is stale; without a heartbeat, nothing by the loop's account
 * (comment or head commit) for 45 minutes, the rule before the heartbeat.
 */
export function builderGone({ comments, headCommitAt }, now) {
  const beat = readHeartbeat(comments);
  if (beat !== null) return { gone: !heartbeatAlive(beat, now), beat };
  const times = comments
    .filter((one) => one.user?.login === LOOP_ACCOUNT)
    .map((one) => Date.parse(one.created_at))
    .concat(headCommitAt ? [Date.parse(headCommitAt)] : []);
  const last = Math.max(0, ...times);
  return { gone: now.getTime() - last >= SILENCE_STALL_MS, beat: null };
}

/** Whether the start routine was fired or resumed the task within `withinMs` before `now`. */
export function recentlyResumed(comments, now, withinMs = 10 * 60_000) {
  return comments.some(
    (one) =>
      typeof one.body === 'string' &&
      (one.body.startsWith('Resumed by the start routine.') || one.body.startsWith('Watchdog: ')) &&
      now.getTime() - Date.parse(one.created_at) < withinMs,
  );
}
