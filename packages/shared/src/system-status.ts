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

/** The 24 hours before now: Sentry's errors that need attention, and the home card's line. */
export const DAY_MS = 86_400_000;

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

/**
 * The period of the outside services' history on the System status page (pull request #363;
 * owner, 20 November 2026): 14 days at most, the shortest history of the three (Grafana Cloud's
 * free plan keeps 14 days). The own checks and the attention count are always "now".
 */
export const STATUS_PERIODS = ['24h', '7d', '14d'] as const;

export type StatusPeriod = (typeof STATUS_PERIODS)[number];

export const STATUS_PERIOD_DAYS: Record<StatusPeriod, number> = { '24h': 1, '7d': 7, '14d': 14 };

export const statusPeriodSchema = z.enum(STATUS_PERIODS);

/** The query of the providers' route: the period, 24 hours when left out. */
export const statusProvidersQuerySchema = z.strictObject({ period: statusPeriodSchema.optional() });

export type StatusProvidersQuery = z.infer<typeof statusProvidersQuerySchema>;

/**
 * A provider's history of the period, newest first, or "could not be read" when the provider
 * answered it in another shape (the current rows still show). `cut`: the provider's own limit
 * was reached, so older lines may be missing.
 */
function history<T extends z.ZodType>(item: T) {
  return z.discriminatedUnion('state', [
    z.object({ state: z.literal('read'), items: z.array(item), cut: z.boolean() }),
    z.object({ state: z.literal('unreadable') }),
  ]);
}

export const uptimeDownPeriodSchema = z.object({
  monitor: z.string(),
  startedAt: moment,
  /** Null while the monitor is still down. */
  endedAt: moment.nullable(),
  /** UptimeRobot's reason ("Connection Timeout"), or none. */
  reason: z.string().nullable(),
});

export type UptimeDownPeriod = z.infer<typeof uptimeDownPeriodSchema>;

export const grafanaFiringSchema = z.object({
  rule: z.string(),
  /** The alert instance's `branch` label (a branch id), or none. */
  branch: z.string().nullable(),
  /** The instance's job name or route, when its labels have one. */
  detail: z.string().nullable(),
  /** Null when it fired before the period. */
  firedAt: moment.nullable(),
  /** Null while it still fires. */
  resolvedAt: moment.nullable(),
});

export type GrafanaFiring = z.infer<typeof grafanaFiringSchema>;

export const statusProvidersSchema = z.object({
  period: statusPeriodSchema,
  uptimeRobot: provider({
    monitors: z.array(
      z.object({
        name: z.string(),
        url: z.string(),
        state: z.enum(UPTIME_MONITOR_STATES),
        /** The period's uptime ratio as UptimeRobot gives it ("99.982"), or none. */
        uptime: z.string().nullable(),
      }),
    ),
    history: history(uptimeDownPeriodSchema),
  }),
  grafana: provider({
    /**
     * Firing first, then pending, then normal; by name within each. Only the school's own rules
     * (`ALERT_RULES` of the API), never one Grafana or an app of it adds (`asserts_up`; pull
     * request #364).
     */
    rules: z.array(
      z.object({
        name: z.string(),
        state: z.enum(GRAFANA_RULE_STATES),
        health: z.enum(GRAFANA_RULE_HEALTHS),
      }),
    ),
    history: history(grafanaFiringSchema),
    /** How many of the school's rules Grafana holds, of how many there are (pull request #364). */
    schoolRules: z.object({
      found: z.number().int().nonnegative(),
      of: z.number().int().nonnegative(),
    }),
  }),
  sentry: provider({
    /** Unresolved issues last seen in the period, the newest first, at most 10. */
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
    /** Sentry's limit of 10 was reached: older issues of the period may be missing. */
    cut: z.boolean(),
  }),
});

export type StatusProviders = z.infer<typeof statusProvidersSchema>;
