import { Logger } from '@nestjs/common';
import {
  DAY_MS,
  PROVIDER_CACHE_MS,
  PROVIDER_TIMEOUT_MS,
  STATUS_PERIOD_DAYS,
  type Clock,
  type GrafanaFiring,
  type StatusPeriod,
  type StatusProviders,
  type UptimeDownPeriod,
} from '@sodiq/shared';
import { z } from 'zod';
import type { StatusProvidersConfig } from '../config/config.js';

/**
 * What the calls to the outside services are sent through: the network, or a fake in the tests.
 * Only the status and the body are read.
 */
export type StatusFetch = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

type Uptime = StatusProviders['uptimeRobot'];
type Grafana = StatusProviders['grafana'];
type Sentry = StatusProviders['sentry'];
type History<T> = { state: 'read'; items: T[]; cut: boolean } | { state: 'unreadable' };

export const UPTIMEROBOT_DASHBOARD = 'https://dashboard.uptimerobot.com/monitors';
const UPTIMEROBOT_MONITORS = 'https://api.uptimerobot.com/v2/getMonitors';

/** The most lines of Grafana's history read for a period; at the limit, the list says it is cut. */
export const GRAFANA_HISTORY_LIMIT = 500;

/** The most issues Sentry answers for a period. */
const SENTRY_LIMIT = 10;

/** Why a call gave nothing usable; the only thing of a failure that is logged. */
class Unreachable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

// UptimeRobot v2 `getMonitors`: 0 paused, 1 not checked yet, 2 up, 8 seems down, 9 down.
const UPTIME_STATES = {
  0: 'paused',
  1: 'not_checked',
  2: 'up',
  8: 'seems_down',
  9: 'down',
} as const;

// The logs are read apart (`uptimeLogs`): an answer without them, or with logs of another shape,
// keeps the monitors (review of the plan of #363, correction 2).
const uptimeAnswer = z.object({
  stat: z.literal('ok'),
  monitors: z.array(
    z.object({
      friendly_name: z.string(),
      url: z.string(),
      status: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(8), z.literal(9)]),
      custom_uptime_ratio: z.string().optional(),
      logs: z.unknown().optional(),
    }),
  ),
});

/** UptimeRobot's log types: 1 down, 2 up, 98 started, 99 paused. */
const UPTIME_LOG_DOWN = 1;

const uptimeLogs = z.array(
  z.object({
    type: z.coerce.number().int(),
    /** Unix seconds. */
    datetime: z.number().int(),
    /** Seconds. */
    duration: z.number().int().min(0),
    reason: z.object({ detail: z.string().optional() }).nullish(),
  }),
);

// Grafana's Prometheus-compatible list of its own rules; only what is shown is read.
const grafanaAnswer = z.object({
  status: z.literal('success'),
  data: z.object({
    groups: z.array(
      z.object({
        rules: z.array(
          z.object({
            name: z.string(),
            type: z.string().optional(),
            state: z.string().optional(),
            health: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
});

// `GET /api/v1/rules/history` (Grafana's Loki state history): a data frame of the fields `time`
// (epoch milliseconds) and `line` (the entry as an object), written by grafana-plugin-sdk-go.
const grafanaHistoryFrame = z.object({
  schema: z.object({ fields: z.array(z.object({ name: z.string() })) }),
  data: z.object({ values: z.array(z.array(z.unknown())) }),
});

const grafanaHistoryLine = z.object({
  previous: z.string(),
  current: z.string(),
  ruleTitle: z.string(),
  ruleUID: z.string().optional(),
  labels: z.record(z.string(), z.string()).nullish(),
});

const sentryAnswer = z.array(
  z.object({
    title: z.string(),
    shortId: z.string(),
    count: z.union([z.string(), z.number()]).optional(),
    lastSeen: z.string().nullable().optional(),
    permalink: z.string().nullable().optional(),
  }),
);

const RULE_ORDER = { firing: 0, pending: 1, normal: 2 } as const;

/**
 * A Grafana state is firing when its first word is Alerting or Recovering ("Alerting (Error)" is
 * still firing): a firing is a change into such a state from one that is not, a resolution the
 * reverse; Alerting → "Alerting (Error)" is neither (review of the plan of #363, correction 1).
 */
export function firesIn(state: string): boolean {
  const word = state.trim().split(/[\s(]/, 1)[0] ?? '';
  return word === 'Alerting' || word === 'Recovering';
}

/** A moment as an ISO text, or none when the provider's text is not one. */
function momentOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** An https link of the provider, or none. */
function linkOf(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^https:\/\/[^\s]+$/.test(value) ? value : null;
}

/** Newest first, by a moment that may be missing (missing: oldest). */
const newestFirst = (one: string | null, other: string | null): number =>
  (other === null ? 0 : Date.parse(other)) - (one === null ? 0 : Date.parse(one));

/**
 * The down periods of the monitors in the period `[from, now]`, newest first: a log of type 1
 * starts one, its `duration` ends it; the newest down log of a monitor that is down now still
 * runs. A down period that began before the period is kept when it ended inside it or still runs.
 */
export function downPeriods(
  monitors: readonly { name: string; down: boolean; logs: z.infer<typeof uptimeLogs> }[],
  from: number,
  now: number,
): UptimeDownPeriod[] {
  const periods: UptimeDownPeriod[] = [];
  for (const monitor of monitors) {
    const downs = monitor.logs
      .filter((log) => log.type === UPTIME_LOG_DOWN)
      .sort((one, other) => other.datetime - one.datetime);
    downs.forEach((log, index) => {
      const start = log.datetime * 1000;
      const running = index === 0 && monitor.down;
      const end = running ? null : start + log.duration * 1000;
      if (start > now || (end !== null && end < from)) return;
      periods.push({
        monitor: monitor.name,
        startedAt: new Date(start).toISOString(),
        endedAt: end === null ? null : new Date(end).toISOString(),
        reason: log.reason?.detail ?? null,
      });
    });
  }
  return periods.sort((one, other) => newestFirst(one.startedAt, other.startedAt));
}

/**
 * The alerts that fired in the period from Grafana's history frame, newest first. Transitions
 * are paired by the rule and the instance's labels (a rule fires per branch, per route or per
 * job: spec review of the plan of #363, must-fix 1). A resolution without its firing in the
 * period fired before it (`firedAt` null); a firing without its resolution still fires.
 */
export function firingsOf(frame: unknown): { items: GrafanaFiring[]; lines: number } | null {
  const parsed = grafanaHistoryFrame.safeParse(frame);
  if (!parsed.success) return null;
  const names = parsed.data.schema.fields.map((field) => field.name);
  const times = parsed.data.data.values[names.indexOf('time')];
  const lines = parsed.data.data.values[names.indexOf('line')];
  if (times === undefined || lines === undefined || times.length !== lines.length) return null;
  const entries: { at: number; line: z.infer<typeof grafanaHistoryLine> }[] = [];
  for (const [index, raw] of lines.entries()) {
    const at = times[index];
    const line = grafanaHistoryLine.safeParse(raw);
    // One line of another shape and the history is not read: a missed line could misreport.
    if (typeof at !== 'number' || !Number.isFinite(at) || !line.success) return null;
    entries.push({ at, line: line.data });
  }
  entries.sort((one, other) => one.at - other.at);
  const open = new Map<string, GrafanaFiring>();
  const items: GrafanaFiring[] = [];
  for (const { at, line } of entries) {
    const labels = line.labels ?? {};
    const key = `${line.ruleUID ?? line.ruleTitle}\u0000${JSON.stringify(
      Object.entries(labels).sort(([one], [other]) => one.localeCompare(other)),
    )}`;
    const was = firesIn(line.previous);
    const is = firesIn(line.current);
    const moment = new Date(at).toISOString();
    if (!was && is) {
      const firing: GrafanaFiring = {
        rule: line.ruleTitle,
        branch: labels.branch ?? null,
        detail: labels.name ?? labels.route ?? null,
        firedAt: moment,
        resolvedAt: null,
      };
      open.set(key, firing);
      items.push(firing);
    } else if (was && !is) {
      const firing = open.get(key);
      if (firing === undefined) {
        items.push({
          rule: line.ruleTitle,
          branch: labels.branch ?? null,
          detail: labels.name ?? labels.route ?? null,
          firedAt: null,
          resolvedAt: moment,
        });
      } else {
        firing.resolvedAt = moment;
        open.delete(key);
      }
    }
  }
  return {
    // By when each fired, newest first; one that fired before the period last.
    items: items.sort((one, other) => newestFirst(one.firedAt, other.firedAt)),
    lines: entries.length,
  };
}

/**
 * The outside services of the System status page (pull requests #361, #363): UptimeRobot's
 * monitors, Grafana's alert rules and Sentry's issues, read with read-only keys from the server
 * only, so the Content-Security-Policy is unchanged, each with its history of the period. A
 * service without its key is `not_connected`; a failure, a refusal, a timeout or an answer of
 * another shape of the call its current rows need is `unreachable`, with nothing of the
 * service's answer; the history alone can be `unreadable` and the current rows still show. A key
 * is never answered or logged: a failure logs the service's name and the kind of failure only.
 * Each answer is kept `PROVIDER_CACHE_MS` per process and period, timed by the injected clock.
 * The attention count is always "now", whatever the period.
 */
export class StatusProviderReader {
  private readonly logger = new Logger('StatusProviders');
  private readonly kept = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly config: StatusProvidersConfig,
    private readonly clock: Clock,
    private readonly fetcher: StatusFetch = (url, init) => fetch(url, init),
    private readonly timeoutMs: number = PROVIDER_TIMEOUT_MS,
  ) {}

  async read(period: StatusPeriod = '24h'): Promise<StatusProviders> {
    const [uptimeRobot, grafana, sentry] = await Promise.all([
      this.uptimeRobot(period),
      this.grafana(period),
      this.sentry(period),
    ]);
    return { period, uptimeRobot, grafana, sentry };
  }

  private uptimeRobot(period: StatusPeriod): Promise<Uptime> {
    const key = this.config.uptimeRobotKey;
    const dashboardUrl = UPTIMEROBOT_DASHBOARD;
    if (key === undefined) return Promise.resolve({ state: 'not_connected', dashboardUrl });
    return this.cached(
      'uptimeRobot',
      period,
      async (checkedAt, now) => {
        // Only parameters every plan takes: no date range (review, correction 2).
        const body = new URLSearchParams({
          api_key: key,
          format: 'json',
          logs: '1',
          custom_uptime_ratios: String(STATUS_PERIOD_DAYS[period]),
        });
        const answer = uptimeAnswer.parse(
          await this.call(UPTIMEROBOT_MONITORS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          }),
        );
        const monitors = answer.monitors.map((monitor) => ({
          name: monitor.friendly_name,
          url: monitor.url,
          state: UPTIME_STATES[monitor.status],
          uptime: monitor.custom_uptime_ratio ?? null,
        }));
        const logs = answer.monitors.map((monitor) => uptimeLogs.safeParse(monitor.logs));
        let history: History<UptimeDownPeriod> = { state: 'unreadable' };
        if (logs.every((one) => one.success)) {
          history = {
            state: 'read',
            items: downPeriods(
              answer.monitors.map((monitor, index) => ({
                name: monitor.friendly_name,
                down: monitor.status === 8 || monitor.status === 9,
                logs: logs[index]?.data ?? [],
              })),
              now - STATUS_PERIOD_DAYS[period] * DAY_MS,
              now,
            ),
            cut: false,
          };
        } else {
          this.warn('uptimeRobot', 'its logs are of another shape');
        }
        return {
          state: 'connected',
          checkedAt,
          attention: monitors.filter((one) => one.state === 'down' || one.state === 'seems_down')
            .length,
          dashboardUrl,
          monitors,
          history,
        };
      },
      dashboardUrl,
    );
  }

  private grafana(period: StatusPeriod): Promise<Grafana> {
    const grafana = this.config.grafana;
    if (grafana === undefined) {
      return Promise.resolve({ state: 'not_connected', dashboardUrl: null });
    }
    const dashboardUrl = `${grafana.url}/alerting/list`;
    const headers = { Authorization: `Bearer ${grafana.token}`, Accept: 'application/json' };
    return this.cached(
      'grafana',
      period,
      async (checkedAt, now) => {
        // The history is a call of its own, in parallel: its failure keeps the rules.
        const from = Math.floor((now - STATUS_PERIOD_DAYS[period] * DAY_MS) / 1000);
        const to = Math.floor(now / 1000);
        const query = new URLSearchParams({
          from: String(from),
          to: String(to),
          limit: String(GRAFANA_HISTORY_LIMIT),
        });
        const [rulesAnswer, historyAnswer] = await Promise.all([
          this.call(`${grafana.url}/api/prometheus/grafana/api/v1/rules`, {
            method: 'GET',
            headers,
          }),
          this.call(`${grafana.url}/api/v1/rules/history?${query.toString()}`, {
            method: 'GET',
            headers,
          }).catch((error: unknown) => {
            this.warn(
              'grafana',
              `its history: ${error instanceof Unreachable ? error.reason : 'no answer'}`,
            );
            return undefined;
          }),
        ]);
        const answer = grafanaAnswer.parse(rulesAnswer);
        const rules = answer.data.groups
          .flatMap((group) => group.rules)
          // A recording rule raises nothing.
          .filter((rule) => rule.type === undefined || rule.type === 'alerting')
          .map((rule) => {
            const state = (rule.state ?? '').toLowerCase();
            const health = (rule.health ?? '').toLowerCase().replace(/[^a-z]/g, '');
            return {
              name: rule.name,
              state:
                state === 'firing' || state === 'alerting'
                  ? ('firing' as const)
                  : state === 'pending'
                    ? ('pending' as const)
                    : ('normal' as const),
              health:
                health === 'nodata'
                  ? ('no_data' as const)
                  : health === 'error' || health === 'err'
                    ? ('error' as const)
                    : ('ok' as const),
            };
          })
          .sort(
            (one, other) =>
              RULE_ORDER[one.state] - RULE_ORDER[other.state] || one.name.localeCompare(other.name),
          );
        let history: History<GrafanaFiring> = { state: 'unreadable' };
        if (historyAnswer !== undefined) {
          const firings = firingsOf(historyAnswer);
          if (firings === null) {
            this.warn('grafana', 'its history is of another shape');
          } else {
            history = {
              state: 'read',
              items: firings.items,
              cut: firings.lines >= GRAFANA_HISTORY_LIMIT,
            };
          }
        }
        return {
          state: 'connected',
          checkedAt,
          attention: rules.filter((rule) => rule.state === 'firing' || rule.health === 'error')
            .length,
          dashboardUrl,
          rules,
          history,
        };
      },
      dashboardUrl,
    );
  }

  private sentry(period: StatusPeriod): Promise<Sentry> {
    const org = this.config.sentry?.org ?? this.config.sentryOrg;
    // A link only for an organisation slug: SENTRY_ORG is also the build's, and is not checked.
    const dashboardUrl =
      org !== undefined && /^[a-z0-9][a-z0-9-]{0,63}$/.test(org)
        ? `https://${org}.sentry.io/issues/`
        : null;
    const sentry = this.config.sentry;
    if (sentry === undefined) return Promise.resolve({ state: 'not_connected', dashboardUrl });
    return this.cached(
      'sentry',
      period,
      async (checkedAt, now) => {
        const query = new URLSearchParams({
          query: `is:unresolved lastSeen:-${period}`,
          // Only the answer's stats: 24h is taken by every Sentry.
          statsPeriod: '24h',
          environment: sentry.environment,
          sort: 'date',
          limit: String(SENTRY_LIMIT),
        });
        const answer = sentryAnswer.parse(
          await this.call(
            `${sentry.url}/api/0/organizations/${encodeURIComponent(sentry.org)}/issues/?${query.toString()}`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${sentry.token}`, Accept: 'application/json' },
            },
          ),
        );
        const issues = answer
          .slice(0, SENTRY_LIMIT)
          .map((issue) => ({
            title: issue.title,
            shortId: issue.shortId,
            events: issue.count === undefined ? '' : String(issue.count),
            lastSeen: momentOf(issue.lastSeen),
            link: linkOf(issue.permalink),
          }))
          .sort((one, other) => newestFirst(one.lastSeen, other.lastSeen));
        // "Now": the issues last seen in the 24 hours before now, whatever the period.
        const attention = issues.filter(
          (issue) => issue.lastSeen !== null && now - Date.parse(issue.lastSeen) <= DAY_MS,
        ).length;
        return {
          state: 'connected',
          checkedAt,
          attention,
          dashboardUrl,
          issues,
          cut: answer.length >= SENTRY_LIMIT,
        };
      },
      dashboardUrl,
    );
  }

  private warn(name: string, reason: string): void {
    // The name and the kind of failure only: never a message of the service, an address or a key.
    this.logger.warn(`The ${name} panel of the System status page could not read: ${reason}.`);
  }

  /**
   * The kept answer of `name` for the period while it is younger than `PROVIDER_CACHE_MS`, or a
   * new read. A failure is kept as long, so a service that is down is not asked at every refresh.
   */
  private async cached<T extends Uptime | Grafana | Sentry>(
    name: string,
    period: StatusPeriod,
    read: (checkedAt: string, now: number) => Promise<T>,
    dashboardUrl: string | null,
  ): Promise<T> {
    const now = this.clock.now();
    const key = `${name}:${period}`;
    const kept = this.kept.get(key);
    if (kept !== undefined && now.getTime() - kept.at < PROVIDER_CACHE_MS) {
      return kept.value as T;
    }
    const checkedAt = now.toISOString();
    let value: T;
    try {
      value = await read(checkedAt, now.getTime());
    } catch (error) {
      this.warn(
        name,
        error instanceof Unreachable
          ? error.reason
          : error instanceof z.ZodError
            ? 'an answer of another shape'
            : 'no answer',
      );
      value = { state: 'unreachable', checkedAt, dashboardUrl } as T;
    }
    this.kept.set(key, { at: now.getTime(), value });
    return value;
  }

  /** One call with its time limit; the JSON of a successful answer. */
  private async call(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Unreachable(`no answer within ${String(this.timeoutMs)} ms`));
      }, this.timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetcher(url, { ...init, signal: controller.signal, redirect: 'error' }),
        timeout,
      ]);
      if (!response.ok) throw new Unreachable(`HTTP ${String(response.status)}`);
      return await Promise.race([response.json(), timeout]);
    } catch (error) {
      if (error instanceof Unreachable) throw error;
      throw new Unreachable('no answer');
    } finally {
      clearTimeout(timer);
    }
  }
}
