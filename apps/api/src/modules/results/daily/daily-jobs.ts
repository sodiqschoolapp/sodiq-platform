import { schoolDateSchema } from '@sodiq/shared';
import { z } from 'zod';
import { defineJob, type JobDefinition } from '../../../jobs/job-definition.js';

/**
 * The daily work of each branch (task 9.2c, pull request #231, plan decision 9, Look first).
 * pg-boss's cron sends `schedule.tick` every 15 minutes with no branch; the tick reads the
 * branches and, for each, in a transaction of that branch alone, enqueues each kind whose hour
 * has come in branch time and that has no `scheduled_runs` row for the branch's date yet, the
 * row written in the same transaction (db/migrations/0135). A tick that runs late or twice
 * enqueues each day's work once. Each job decides from stored moments and the injected clock,
 * never from the fact that it was sent (`.claude/rules/api.md`).
 */

/** The data of a daily job: the branch date it was enqueued for. */
const dayData = z.strictObject({ day: schoolDateSchema });

export type DailyData = z.infer<typeof dayData>;

export const scheduleTickJob = defineJob({
  name: 'schedule.tick',
  data: z.strictObject({}),
  transaction: 'none',
  cron: '*/15 * * * *',
});

/**
 * `edge/system-behaviour`, "The nightly check" (plan decision 6): read in one consistent
 * snapshot, written after; a branch's run may take long (review should-fix 4).
 */
export const resultCheckJob = defineJob({
  name: 'results.check',
  data: dayData,
  transaction: 'none',
  options: { expireInSeconds: 3600 },
});

/** "A check that did not run also raises an alert." */
export const checkMissedJob = defineJob({ name: 'results.check_missed', data: dayData });

/** `07`: "After the last day the Academic Vice Principal is reminded until the quarter is closed." */
export const closingOverdueJob = defineJob({ name: 'results.closing_overdue', data: dayData });

/** `09`, The plan window, and `edge/lesson-plans`: the timed reminders of plans. */
export const planRemindersJob = defineJob({ name: 'plans.reminders', data: dayData });

/** `10`, Notifications: "Lesson about to lock with data missing". */
export const aboutToLockJob = defineJob({ name: 'journal.about_to_lock', data: dayData });

/** `edge/people-roles-accounts`: the kept rows of a forced delete removed after 30 days. */
export const forcedDeletePurgeJob = defineJob({
  name: 'timetable.forced_delete_purge',
  data: dayData,
});

/**
 * Each daily kind, its branch-time hour (plan decision 15) and its job. `after`: the kind waits
 * until that long after the day's run of another kind was enqueued, so that "did not run" never
 * reads a check still running when a worker that was down sends both in one tick (spec review
 * note; the check expires after an hour).
 */
export const DAILY_WORK: readonly {
  readonly kind: string;
  readonly at: string;
  readonly job: JobDefinition<DailyData>;
  readonly after?: { readonly kind: string; readonly minutes: number };
}[] = [
  { kind: 'results.check', at: '02:00', job: resultCheckJob },
  { kind: 'timetable.forced_delete_purge', at: '02:00', job: forcedDeletePurgeJob },
  {
    kind: 'results.check_missed',
    at: '07:00',
    job: checkMissedJob,
    after: { kind: 'results.check', minutes: 60 },
  },
  { kind: 'results.closing_overdue', at: '07:00', job: closingOverdueJob },
  { kind: 'plans.reminders', at: '07:00', job: planRemindersJob },
  { kind: 'journal.about_to_lock', at: '07:00', job: aboutToLockJob },
];

export const DAILY_JOBS: readonly JobDefinition<unknown>[] = [
  scheduleTickJob,
  ...DAILY_WORK.map((one) => one.job),
];
