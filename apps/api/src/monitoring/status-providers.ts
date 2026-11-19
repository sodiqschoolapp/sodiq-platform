import { Logger } from '@nestjs/common';
import {
  PROVIDER_CACHE_MS,
  PROVIDER_TIMEOUT_MS,
  type Clock,
  type StatusProviders,
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

export const UPTIMEROBOT_DASHBOARD = 'https://dashboard.uptimerobot.com/monitors';
const UPTIMEROBOT_MONITORS = 'https://api.uptimerobot.com/v2/getMonitors';

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

const uptimeAnswer = z.object({
  stat: z.literal('ok'),
  monitors: z.array(
    z.object({
      friendly_name: z.string(),
      url: z.string(),
      status: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(8), z.literal(9)]),
      custom_uptime_ratio: z.string().optional(),
    }),
  ),
});

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

/**
 * The outside services of the System status page (pull request #361): UptimeRobot's monitors,
 * Grafana's alert rules and Sentry's issues of the last 24 hours, read with read-only keys from
 * the server only, so the Content-Security-Policy is unchanged. A service without its key is
 * `not_connected`; a failure, a refusal, a timeout or an answer of another shape is
 * `unreachable`, with nothing of the service's answer. A key is never answered or logged: a
 * failure logs the service's name and the HTTP status or the kind of failure only. Each answer
 * is kept `PROVIDER_CACHE_MS` per process, timed by the injected clock.
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

  async read(): Promise<StatusProviders> {
    const [uptimeRobot, grafana, sentry] = await Promise.all([
      this.uptimeRobot(),
      this.grafana(),
      this.sentry(),
    ]);
    return { uptimeRobot, grafana, sentry };
  }

  private uptimeRobot(): Promise<Uptime> {
    const key = this.config.uptimeRobotKey;
    const dashboardUrl = UPTIMEROBOT_DASHBOARD;
    if (key === undefined) return Promise.resolve({ state: 'not_connected', dashboardUrl });
    return this.cached(
      'uptimeRobot',
      async (checkedAt) => {
        const body = new URLSearchParams({
          api_key: key,
          format: 'json',
          custom_uptime_ratios: '7',
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
          uptime7d: monitor.custom_uptime_ratio ?? null,
        }));
        return {
          state: 'connected',
          checkedAt,
          attention: monitors.filter((one) => one.state === 'down' || one.state === 'seems_down')
            .length,
          dashboardUrl,
          monitors,
        };
      },
      dashboardUrl,
    );
  }

  private grafana(): Promise<Grafana> {
    const grafana = this.config.grafana;
    if (grafana === undefined) {
      return Promise.resolve({ state: 'not_connected', dashboardUrl: null });
    }
    const dashboardUrl = `${grafana.url}/alerting/list`;
    return this.cached(
      'grafana',
      async (checkedAt) => {
        const answer = grafanaAnswer.parse(
          await this.call(`${grafana.url}/api/prometheus/grafana/api/v1/rules`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${grafana.token}`, Accept: 'application/json' },
          }),
        );
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
        return {
          state: 'connected',
          checkedAt,
          attention: rules.filter((rule) => rule.state === 'firing' || rule.health === 'error')
            .length,
          dashboardUrl,
          rules,
        };
      },
      dashboardUrl,
    );
  }

  private sentry(): Promise<Sentry> {
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
      async (checkedAt) => {
        const query = new URLSearchParams({
          query: 'is:unresolved lastSeen:-24h',
          statsPeriod: '24h',
          environment: sentry.environment,
          sort: 'date',
          limit: '10',
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
        const issues = answer.slice(0, 10).map((issue) => ({
          title: issue.title,
          shortId: issue.shortId,
          events: issue.count === undefined ? '' : String(issue.count),
          lastSeen: momentOf(issue.lastSeen),
          link: linkOf(issue.permalink),
        }));
        return { state: 'connected', checkedAt, attention: issues.length, dashboardUrl, issues };
      },
      dashboardUrl,
    );
  }

  /**
   * The kept answer of `name` while it is younger than `PROVIDER_CACHE_MS`, or a new read. A
   * failure is kept as long, so a service that is down is not asked again at every refresh.
   */
  private async cached<T extends Uptime | Grafana | Sentry>(
    name: string,
    read: (checkedAt: string) => Promise<T>,
    dashboardUrl: string | null,
  ): Promise<T> {
    const now = this.clock.now();
    const kept = this.kept.get(name);
    if (kept !== undefined && now.getTime() - kept.at < PROVIDER_CACHE_MS) {
      return kept.value as T;
    }
    const checkedAt = now.toISOString();
    let value: T;
    try {
      value = await read(checkedAt);
    } catch (error) {
      // The name and the kind of failure only: never a message of the service, an address or a key.
      const reason =
        error instanceof Unreachable
          ? error.reason
          : error instanceof z.ZodError
            ? 'an answer of another shape'
            : 'no answer';
      this.logger.warn(`The ${name} panel of the System status page could not read: ${reason}.`);
      value = { state: 'unreachable', checkedAt, dashboardUrl } as T;
    }
    this.kept.set(name, { at: now.getTime(), value });
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
