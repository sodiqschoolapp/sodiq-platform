import { z } from 'zod';

/**
 * The System status page of the Super Admin (pull request #361; owner, 19 November 2026): the
 * app's own checks, read from the database at once, and the state of the outside monitoring
 * services, read on the server with read-only keys and answered by a second route, so a slow
 * service never holds the page (`12`, speed targets).
 *
 * The limits are those of the alert rules (`apps/api/src/monitoring/alert-rules.ts`), so the
 * page and the emails never disagree: a check needs attention only above its limit, and a
 * check with nothing to read yet is `unknown`, as Grafana then has no value and fires nothing.
 */

/** No run of the every-minute job for longer than this: the worker needs attention. */
export const WORKER_SILENT_MS = 10 * 60_000;

/** No nightly check finished, or no daily work enqueued, for longer than this (26 hours). */
export const DAILY_LATE_MS = 26 * 3_600_000;

/** Failed jobs and failed exports are counted over this last hour. */
export const FAILURE_WINDOW_MS = 3_600_000;

/** Refused saves are counted over these last 10 minutes, as the counts pushed to Grafana. */
export const REFUSED_SAVES_WINDOW_MS = 10 * 60_000;

/** A provider's answer is kept this long per API process (UptimeRobot allows 10 calls a minute). */
export const PROVIDER_CACHE_MS = 60_000;

/** The longest wait for one provider. */
export const PROVIDER_TIMEOUT_MS = 5_000;

export const CHECK_STATUSES = ['ok', 'attention', 'unknown'] as const;

export const checkStatusSchema = z.enum(CHECK_STATUSES);

export type CheckStatus = z.infer<typeof checkStatusSchema>;

const moment = z.iso.datetime({ offset: true });

export const systemStatusSchema = z.object({
  checkedAt: moment,
  /** How many of the checks below need attention. */
  attention: z.int().min(0),
  worker: z.object({
    status: checkStatusSchema,
    /** The newest completed run of the every-minute job, or none yet. */
    lastRunAt: moment.nullable(),
  }),
  failedJobs: z.object({
    status: checkStatusSchema,
    /** Per job name, the jobs failed in the last hour. */
    jobs: z.array(z.object({ name: z.string(), failed: z.int().min(1) })),
  }),
  /** The reports not marked handled yet; a number, no status. */
  newFeedback: z.int().min(0),
  /** The branches of the school, the hidden Monitoring branch left out. */
  branches: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      nightlyCheck: z.object({
        status: checkStatusSchema,
        finishedAt: moment.nullable(),
        differences: z.int().min(0),
      }),
      dailyWork: z.object({ status: checkStatusSchema, enqueuedAt: moment.nullable() }),
      failedExports: z.object({ status: checkStatusSchema, count: z.int().min(0) }),
      /** In the last 10 minutes; a number, no status (the jump rule needs last week). */
      refusedSaves: z.int().min(0),
    }),
  ),
});

export type SystemStatus = z.infer<typeof systemStatusSchema>;

/** A provider without its key, out of reach, or read. Its dashboard link when one is known. */
function provider<T extends z.ZodRawShape>(read: T) {
  const link = { dashboardUrl: z.url().nullable() };
  return z.discriminatedUnion('state', [
    z.object({ state: z.literal('not_connected'), ...link }),
    z.object({ state: z.literal('unreachable'), checkedAt: moment, ...link }),
    z.object({
      state: z.literal('connected'),
      checkedAt: moment,
      /** How many of its rows need attention. */
      attention: z.int().min(0),
      ...link,
      ...read,
    }),
  ]);
}

export const UPTIME_MONITOR_STATES = ['up', 'down', 'seems_down', 'paused', 'not_checked'] as const;

export const GRAFANA_RULE_STATES = ['firing', 'pending', 'normal'] as const;

export const GRAFANA_RULE_HEALTHS = ['ok', 'no_data', 'error'] as const;

export const statusProvidersSchema = z.object({
  uptimeRobot: provider({
    monitors: z.array(
      z.object({
        name: z.string(),
        url: z.string(),
        state: z.enum(UPTIME_MONITOR_STATES),
        /** The 7-day uptime ratio as UptimeRobot gives it ("99.982"), or none. */
        uptime7d: z.string().nullable(),
      }),
    ),
  }),
  grafana: provider({
    /** Firing first, then pending, then normal; by name within each. */
    rules: z.array(
      z.object({
        name: z.string(),
        state: z.enum(GRAFANA_RULE_STATES),
        health: z.enum(GRAFANA_RULE_HEALTHS),
      }),
    ),
  }),
  sentry: provider({
    /** Unresolved issues seen in the last 24 hours, the newest first, at most 10. */
    issues: z.array(
      z.object({
        title: z.string(),
        shortId: z.string(),
        /** The number of events as Sentry gives it. */
        events: z.string(),
        lastSeen: moment.nullable(),
        link: z.url().nullable(),
      }),
    ),
  }),
});

export type StatusProviders = z.infer<typeof statusProvidersSchema>;
