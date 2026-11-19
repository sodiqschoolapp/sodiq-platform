import { Logger } from '@nestjs/common';
import { PROVIDER_CACHE_MS, statusProvidersSchema, type StatusProviders } from '@sodiq/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatusProvidersConfig } from '../config/config.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { ShippingLogger } from './monitoring.service.js';
import {
  firesIn,
  GRAFANA_HISTORY_LIMIT,
  StatusProviderReader,
  UPTIMEROBOT_DASHBOARD,
  type StatusFetch,
} from './status-providers.js';

// Pull requests #361 and #363 (owner, 19 and 20 November 2026): the outside services of the System
// status page, read on the server with read-only keys, with their history of the period. The
// answers follow the providers' own code (#363, the comments on decision 2). Every key and
// answer here is invented.

const NOW = '2026-11-19T10:00:00+05:00';
const UPTIME_KEY = 'ur0000001-invented-uptime-key';
const GRAFANA_TOKEN = 'glsa_invented_grafana_token';
const SENTRY_TOKEN = 'sntrys_invented_sentry_token';

const CONNECTED: StatusProvidersConfig = {
  uptimeRobotKey: UPTIME_KEY,
  grafana: { url: 'https://sodiq.grafana.net', token: GRAFANA_TOKEN },
  sentry: {
    url: 'https://de.sentry.io',
    org: 'sodiq',
    token: SENTRY_TOKEN,
    environment: 'production',
  },
  sentryOrg: 'sodiq',
};

const NONE: StatusProvidersConfig = {
  uptimeRobotKey: undefined,
  grafana: undefined,
  sentry: undefined,
  sentryOrg: undefined,
};

const NOW_S = Math.floor(new Date(NOW).getTime() / 1000);
const HOUR_S = 3600;

const UPTIME_ANSWER = {
  stat: 'ok',
  pagination: { offset: 0, limit: 50, total: 3 },
  monitors: [
    {
      id: 1,
      friendly_name: 'app',
      url: 'https://app.sodiqschool.uz/',
      type: 1,
      status: 2,
      custom_uptime_ratio: '99.982',
      logs: [
        // Down 3 hours ago for 18 minutes, then up; down 3 days ago (outside 24 hours).
        { id: 11, type: 2, datetime: NOW_S - 3 * HOUR_S + 1080, duration: 10_000 },
        {
          id: 12,
          type: 1,
          datetime: NOW_S - 3 * HOUR_S,
          duration: 1080,
          reason: { code: '0', detail: 'Connection Timeout' },
        },
        {
          id: 13,
          type: 1,
          datetime: NOW_S - 72 * HOUR_S,
          duration: 600,
          reason: { code: '0', detail: 'Bad Gateway' },
        },
        { id: 14, type: 98, datetime: NOW_S - 400 * HOUR_S, duration: 0 },
      ],
    },
    {
      id: 2,
      friendly_name: 'api health',
      url: 'https://app.sodiqschool.uz/api/health',
      type: 2,
      status: 9,
      custom_uptime_ratio: '97.100',
      // Down since 30 hours ago: began before 24 hours and still runs.
      logs: [
        {
          id: 21,
          type: 1,
          datetime: NOW_S - 30 * HOUR_S,
          duration: 30 * HOUR_S,
          reason: { code: '0', detail: 'Keyword Not Found' },
        },
      ],
    },
    { id: 3, friendly_name: 'old', url: 'https://old.example.org/', type: 1, status: 0, logs: [] },
  ],
};

const GRAFANA_ANSWER = {
  status: 'success',
  data: {
    groups: [
      {
        name: 'sodiq-production',
        rules: [
          { name: 'CellSavesSlow', type: 'alerting', state: 'inactive', health: 'ok' },
          { name: 'BackupOld', type: 'alerting', state: 'firing', health: 'ok' },
          { name: 'SignInSaveFailing', type: 'alerting', state: 'pending', health: 'ok' },
          { name: 'ApiSilent', type: 'alerting', state: 'inactive', health: 'error' },
          { name: 'JobsFailing', type: 'alerting', state: 'normal', health: 'nodata' },
          { name: 'requests:rate', type: 'recording', health: 'ok' },
        ],
      },
    ],
  },
};

const NORTH = '0198a000-0000-7000-8000-000000000001';
const SOUTH = '0198a000-0000-7000-8000-000000000002';
const NOW_MS = new Date(NOW).getTime();
const MIN_MS = 60_000;

/** One line of Grafana's Loki state history. */
const line = (
  previous: string,
  current: string,
  labels: Record<string, string>,
  rule = 'CellSavesFailing',
) => ({
  schemaVersion: 1,
  previous,
  current,
  values: {},
  condition: 'C',
  dashboardUID: '',
  panelID: 0,
  fingerprint: 'f0',
  ruleTitle: rule,
  ruleID: 3,
  ruleUID: `uid-${rule}`,
  labels: { alertname: rule, ...labels },
});

/** Grafana's history as grafana-plugin-sdk-go writes the frame: columns of time and line. */
const frame = (rows: [number, unknown][]) => ({
  schema: {
    name: 'states',
    fields: [
      { name: 'time', type: 'time', typeInfo: { frame: 'time.Time' } },
      { name: 'line', type: 'other', typeInfo: { frame: 'json.RawMessage' } },
      { name: 'labels', type: 'other', typeInfo: { frame: 'json.RawMessage' } },
    ],
  },
  data: {
    values: [
      rows.map(([at]) => at),
      rows.map(([, one]) => one),
      rows.map(() => ({ from: 'state-history' })),
    ],
  },
});

// Two instances of one rule: North fires and resolves; South fires and still fires; a firing
// that changes reason (Alerting → Alerting (Error)) is neither a new firing nor a resolution; one
// of JobsFailing resolved within the period after firing before it. Given out of time order.
const GRAFANA_HISTORY = frame([
  [
    NOW_MS - 30 * MIN_MS,
    line('Alerting', 'Normal', { branch: NORTH, route: '/api/journal/cells' }),
  ],
  [
    NOW_MS - 90 * MIN_MS,
    line('Normal', 'Alerting', { branch: NORTH, route: '/api/journal/cells' }),
  ],
  [
    NOW_MS - 60 * MIN_MS,
    line('Pending', 'Alerting', { branch: SOUTH, route: '/api/journal/cells' }),
  ],
  [
    NOW_MS - 50 * MIN_MS,
    line('Alerting', 'Alerting (Error)', { branch: SOUTH, route: '/api/journal/cells' }),
  ],
  [
    NOW_MS - 20 * MIN_MS,
    line(
      'Alerting',
      'Normal (MissingSeries)',
      { branch: SOUTH, name: 'journal.branch_export' },
      'JobsFailing',
    ),
  ],
]);

const SENTRY_ANSWER = [
  {
    id: '10',
    shortId: 'SODIQ-PRODUCTION-4A',
    title: 'TypeError: Cannot read properties of undefined',
    culprit: 'journal-grid',
    permalink: 'https://sodiq.sentry.io/issues/10/',
    count: '17',
    userCount: 3,
    lastSeen: '2026-11-19T04:40:00.000Z',
    firstSeen: '2026-11-18T09:00:00.000Z',
    level: 'error',
    status: 'unresolved',
  },
];

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake network: each address answered by `answer`, every call recorded. */
function fakeNetwork(answer: (url: string) => { status: number; body: unknown } | 'hang' | 'fail') {
  const calls: Call[] = [];
  const fetcher: StatusFetch = (url, init) => {
    calls.push({ url, init });
    const given = answer(url);
    if (given === 'hang') return new Promise(() => undefined);
    if (given === 'fail') return Promise.reject(new Error(`connect ECONNREFUSED ${url}`));
    return Promise.resolve({
      ok: given.status >= 200 && given.status < 300,
      status: given.status,
      json: () => Promise.resolve(given.body),
    });
  };
  return { calls, fetcher };
}

const happy = (url: string) =>
  url.includes('uptimerobot')
    ? { status: 200, body: UPTIME_ANSWER }
    : url.includes('/api/v1/rules/history')
      ? { status: 200, body: GRAFANA_HISTORY }
      : url.includes('grafana')
        ? { status: 200, body: GRAFANA_ANSWER }
        : { status: 200, body: SENTRY_ANSWER };

/** The application's logger, which ships its lines to the sink and prints nothing in the tests. */
class QuietLogger extends ShippingLogger {
  override log(message: unknown, ...rest: unknown[]): void {
    ShippingLogger.ship('info', message, rest);
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    ShippingLogger.ship('warn', message, rest);
  }

  override error(message: unknown, ...rest: unknown[]): void {
    ShippingLogger.ship('error', message, rest);
  }
}

/** The log lines written while `work` runs, through the application's logger. */
async function logLinesOf(work: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  Logger.overrideLogger(new QuietLogger());
  ShippingLogger.sink = (_level, text) => {
    lines.push(text);
  };
  try {
    await work();
  } finally {
    ShippingLogger.sink = undefined;
  }
  return lines;
}

describe('the outside services of the System status page', () => {
  afterEach(() => {
    ShippingLogger.sink = undefined;
  });

  it('says "not connected" for a service without its key, with the links it knows, and calls nothing', async () => {
    const { calls, fetcher } = fakeNetwork(happy);
    const read = await new StatusProviderReader(NONE, new FixedClock(NOW), fetcher).read();

    expect(read).toEqual({
      period: '24h',
      uptimeRobot: { state: 'not_connected', dashboardUrl: UPTIMEROBOT_DASHBOARD },
      grafana: { state: 'not_connected', dashboardUrl: null },
      sentry: { state: 'not_connected', dashboardUrl: null },
    });
    expect(calls).toEqual([]);
    // The organisation alone gives the link, not a read.
    const withOrg = await new StatusProviderReader(
      { ...NONE, sentryOrg: 'sodiq' },
      new FixedClock(NOW),
      fetcher,
    ).read();
    expect(withOrg.sentry).toEqual({
      state: 'not_connected',
      dashboardUrl: 'https://sodiq.sentry.io/issues/',
    });
    // SENTRY_ORG is also the build's and is not checked at start: no link from a value that is no slug.
    const odd = await new StatusProviderReader(
      { ...NONE, sentryOrg: 'Sodiq School/x' },
      new FixedClock(NOW),
      fetcher,
    ).read();
    expect(odd.sentry).toEqual({ state: 'not_connected', dashboardUrl: null });
  });

  it('reads the three services with their read-only keys and counts what needs attention now', async () => {
    const { calls, fetcher } = fakeNetwork(happy);
    const read = statusProvidersSchema.parse(
      await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read(),
    );
    const checkedAt = new Date(NOW).toISOString();

    expect(read.period).toBe('24h');
    expect(read.uptimeRobot).toMatchObject({
      state: 'connected',
      checkedAt,
      attention: 1,
      dashboardUrl: UPTIMEROBOT_DASHBOARD,
      monitors: [
        { name: 'app', url: 'https://app.sodiqschool.uz/', state: 'up', uptime: '99.982' },
        {
          name: 'api health',
          url: 'https://app.sodiqschool.uz/api/health',
          state: 'down',
          uptime: '97.100',
        },
        { name: 'old', url: 'https://old.example.org/', state: 'paused', uptime: null },
      ],
    });
    // Firing first, then pending, then normal; the recording rule left out; a firing rule and a
    // rule whose evaluation fails need attention, a pending one not yet.
    expect(read.grafana).toMatchObject({
      state: 'connected',
      checkedAt,
      attention: 2,
      dashboardUrl: 'https://sodiq.grafana.net/alerting/list',
      rules: [
        { name: 'BackupOld', state: 'firing', health: 'ok' },
        { name: 'SignInSaveFailing', state: 'pending', health: 'ok' },
        { name: 'ApiSilent', state: 'normal', health: 'error' },
        { name: 'CellSavesSlow', state: 'normal', health: 'ok' },
        { name: 'JobsFailing', state: 'normal', health: 'no_data' },
      ],
    });
    expect(read.sentry).toEqual({
      state: 'connected',
      checkedAt,
      attention: 1,
      dashboardUrl: 'https://sodiq.sentry.io/issues/',
      issues: [
        {
          title: 'TypeError: Cannot read properties of undefined',
          shortId: 'SODIQ-PRODUCTION-4A',
          events: '17',
          lastSeen: '2026-11-19T04:40:00.000Z',
          link: 'https://sodiq.sentry.io/issues/10/',
        },
      ],
      cut: false,
    });

    const uptime = calls.find((call) => call.url.includes('uptimerobot'));
    expect(uptime?.url).toBe('https://api.uptimerobot.com/v2/getMonitors');
    expect(uptime?.init.method).toBe('POST');
    const form = new URLSearchParams(typeof uptime?.init.body === 'string' ? uptime.init.body : '');
    expect(form.get('api_key')).toBe(UPTIME_KEY);
    // Only parameters every plan takes: the logs and one ratio, no date range.
    expect(form.get('logs')).toBe('1');
    expect(form.get('custom_uptime_ratios')).toBe('1');
    expect([...form.keys()].sort()).toEqual(['api_key', 'custom_uptime_ratios', 'format', 'logs']);
    const grafana = calls.find((call) => call.url.includes('/api/prometheus/grafana/api/v1/rules'));
    expect(grafana?.url).toBe('https://sodiq.grafana.net/api/prometheus/grafana/api/v1/rules');
    expect(grafana?.init.headers).toMatchObject({ Authorization: `Bearer ${GRAFANA_TOKEN}` });
    const history = calls.find((call) => call.url.includes('/api/v1/rules/history'));
    const historyQuery = new URL(history?.url ?? 'https://x').searchParams;
    // Unix seconds from the injected clock (review of the plan, correction 1).
    expect(historyQuery.get('to')).toBe(String(NOW_S));
    expect(historyQuery.get('from')).toBe(String(NOW_S - 24 * HOUR_S));
    expect(history?.init.headers).toMatchObject({ Authorization: `Bearer ${GRAFANA_TOKEN}` });
    const sentry = calls.find((call) => call.url.includes('sentry'));
    expect(sentry?.url).toMatch(
      /^https:\/\/de\.sentry\.io\/api\/0\/organizations\/sodiq\/issues\/\?/,
    );
    const query = new URL(sentry?.url ?? 'https://x').searchParams;
    expect(query.get('query')).toBe('is:unresolved lastSeen:-24h');
    expect(query.get('environment')).toBe('production');
    expect(sentry?.init.headers).toMatchObject({ Authorization: `Bearer ${SENTRY_TOKEN}` });
    // No key in the answer.
    const answer = JSON.stringify(read);
    for (const secret of [UPTIME_KEY, GRAFANA_TOKEN, SENTRY_TOKEN]) {
      expect(answer).not.toContain(secret);
    }
  });

  describe('the history of the period', () => {
    it('gives the down periods of type 1 in the period, newest first, one that began before it and still runs', async () => {
      const { fetcher } = fakeNetwork(happy);
      const read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read();
      if (read.uptimeRobot.state !== 'connected') throw new Error('Not read.');

      expect(read.uptimeRobot.history).toEqual({
        state: 'read',
        cut: false,
        items: [
          {
            monitor: 'app',
            startedAt: new Date((NOW_S - 3 * HOUR_S) * 1000).toISOString(),
            endedAt: new Date((NOW_S - 3 * HOUR_S + 1080) * 1000).toISOString(),
            reason: 'Connection Timeout',
          },
          {
            monitor: 'api health',
            startedAt: new Date((NOW_S - 30 * HOUR_S) * 1000).toISOString(),
            endedAt: null,
            reason: 'Keyword Not Found',
          },
        ],
      });
    });

    it('reaches 7 days back when asked, with the ratio, the from and the Sentry query of 7 days', async () => {
      const { calls, fetcher } = fakeNetwork(happy);
      const read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read(
        '7d',
      );
      if (read.uptimeRobot.state !== 'connected') throw new Error('Not read.');

      expect(read.period).toBe('7d');
      expect(
        read.uptimeRobot.history.state === 'read' &&
          read.uptimeRobot.history.items.map((one) => one.reason),
      ).toEqual(['Connection Timeout', 'Keyword Not Found', 'Bad Gateway']);
      const uptime = calls.find((call) => call.url.includes('uptimerobot'));
      const form = new URLSearchParams(
        typeof uptime?.init.body === 'string' ? uptime.init.body : '',
      );
      expect(form.get('custom_uptime_ratios')).toBe('7');
      const history = calls.find((call) => call.url.includes('/api/v1/rules/history'));
      expect(new URL(history?.url ?? 'https://x').searchParams.get('from')).toBe(
        String(NOW_S - 7 * 24 * HOUR_S),
      );
      const sentry = calls.find((call) => call.url.includes('sentry'));
      expect(new URL(sentry?.url ?? 'https://x').searchParams.get('query')).toBe(
        'is:unresolved lastSeen:-7d',
      );
    });

    it('keeps the monitors when the logs are missing or of another shape, the history unreadable', async () => {
      for (const logs of [undefined, [{ type: 'down', when: 'yesterday' }]]) {
        const answer = {
          ...UPTIME_ANSWER,
          monitors: UPTIME_ANSWER.monitors.map((monitor, index) =>
            index === 0 ? { ...monitor, logs } : monitor,
          ),
        };
        const { fetcher } = fakeNetwork((url) =>
          url.includes('uptimerobot') ? { status: 200, body: answer } : happy(url),
        );
        let read: StatusProviders | undefined;
        const lines = await logLinesOf(async () => {
          read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read();
        });
        if (read?.uptimeRobot.state !== 'connected') throw new Error('The monitors were lost.');

        expect(read.uptimeRobot.monitors).toHaveLength(3);
        expect(read.uptimeRobot.attention).toBe(1);
        expect(read.uptimeRobot.history).toEqual({ state: 'unreadable' });
        expect(lines).toEqual([expect.stringContaining('uptimeRobot panel')]);
      }
    });

    it('pairs each firing with the resolution of the same instance, a branch each, newest first', async () => {
      const { fetcher } = fakeNetwork(happy);
      const read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read();
      if (read.grafana.state !== 'connected') throw new Error('Not read.');
      const at = (minutesAgo: number) => new Date(NOW_MS - minutesAgo * MIN_MS).toISOString();

      expect(read.grafana.history).toEqual({
        state: 'read',
        cut: false,
        items: [
          // South still fires: North's resolution does not close it, nor does its change of reason.
          {
            rule: 'CellSavesFailing',
            branch: SOUTH,
            detail: '/api/journal/cells',
            firedAt: at(60),
            resolvedAt: null,
          },
          {
            rule: 'CellSavesFailing',
            branch: NORTH,
            detail: '/api/journal/cells',
            firedAt: at(90),
            resolvedAt: at(30),
          },
          // Fired before the period, resolved in it (with a reason after its state).
          {
            rule: 'JobsFailing',
            branch: SOUTH,
            detail: 'journal.branch_export',
            firedAt: null,
            resolvedAt: at(20),
          },
        ],
      });
      // A firing that recovered already never raises the count: still the 2 rules of now.
      expect(read.grafana.attention).toBe(2);
    });

    it.each([
      ['a failure', () => ({ status: 500, body: null })],
      ['a refusal', () => ({ status: 403, body: { message: 'Permissions needed' } })],
      ['another shape', () => ({ status: 200, body: { states: [] } })],
      [
        'a line of another shape',
        () => ({ status: 200, body: frame([[NOW_MS, { state: 'firing' }]]) }),
      ],
      [
        'a time that is not milliseconds',
        () => ({
          status: 200,
          body: frame([['2026-11-19T04:00:00Z', line('Normal', 'Alerting', {})]]),
        }),
      ],
      ['no answer in time', () => 'hang' as const],
    ])(
      'keeps the rules when the history answers %s, the history unreadable',
      async (_name, answer) => {
        const { fetcher } = fakeNetwork((url) =>
          url.includes('/api/v1/rules/history') ? answer() : happy(url),
        );
        let read: StatusProviders | undefined;
        const lines = await logLinesOf(async () => {
          read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher, 50).read();
        });
        if (read?.grafana.state !== 'connected') throw new Error('The rules were lost.');

        expect(read.grafana.rules).toHaveLength(5);
        expect(read.grafana.history).toEqual({ state: 'unreadable' });
        expect(lines).toEqual([expect.stringContaining('grafana panel')]);
        expect(lines.join('\n')).not.toContain(GRAFANA_TOKEN);
      },
    );

    it('says a Grafana history is cut at its limit', async () => {
      const rows: [number, unknown][] = Array.from({ length: GRAFANA_HISTORY_LIMIT }, (_, n) => [
        NOW_MS - (n + 1) * MIN_MS,
        line(n % 2 === 0 ? 'Alerting' : 'Normal', n % 2 === 0 ? 'Normal' : 'Alerting', {
          branch: NORTH,
        }),
      ]);
      const { fetcher } = fakeNetwork((url) =>
        url.includes('/api/v1/rules/history') ? { status: 200, body: frame(rows) } : happy(url),
      );
      const read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read();
      if (read.grafana.state !== 'connected') throw new Error('Not read.');
      expect(read.grafana.history).toMatchObject({ state: 'read', cut: true });
    });

    it("counts Sentry's errors of the last 24 hours as attention on 7 days, never the older ones", async () => {
      const older = {
        ...SENTRY_ANSWER[0],
        shortId: 'SODIQ-PRODUCTION-2B',
        lastSeen: new Date(NOW_MS - 3 * 24 * HOUR_S * 1000).toISOString(),
      };
      const { fetcher } = fakeNetwork((url) =>
        url.includes('sentry') ? { status: 200, body: [older, ...SENTRY_ANSWER] } : happy(url),
      );
      const read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read(
        '7d',
      );
      if (read.sentry.state !== 'connected') throw new Error('Not read.');

      // Both listed, the newest first; only the one of the last 24 hours needs attention.
      expect(read.sentry.issues.map((issue) => issue.shortId)).toEqual([
        'SODIQ-PRODUCTION-4A',
        'SODIQ-PRODUCTION-2B',
      ]);
      expect(read.sentry.attention).toBe(1);
    });
  });

  it('reads a Grafana state by its first word', () => {
    expect(firesIn('Alerting')).toBe(true);
    expect(firesIn('Alerting (Error)')).toBe(true);
    expect(firesIn('Recovering')).toBe(true);
    expect(firesIn('Normal (MissingSeries)')).toBe(false);
    expect(firesIn('Pending')).toBe(false);
    expect(firesIn('NoData')).toBe(false);
  });

  it.each([
    ['an error answer', () => ({ status: 500, body: { error: `bad key ${UPTIME_KEY}` } })],
    ['a refusal', () => ({ status: 401, body: { detail: 'Invalid token' } })],
    ['an answer of another shape', () => ({ status: 200, body: { unexpected: true } })],
    [
      'UptimeRobot saying fail',
      () => ({ status: 200, body: { stat: 'fail', error: { type: 'invalid_parameter' } } }),
    ],
    ['no connection', () => 'fail' as const],
  ])('says "unreachable" on %s, logs no key and reports nothing', async (_name, answer) => {
    const { fetcher } = fakeNetwork(answer);
    let read: unknown;
    const lines = await logLinesOf(async () => {
      read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read();
    });
    const checkedAt = new Date(NOW).toISOString();

    // Never thrown, so nothing reaches the error filter and its reports.
    expect(read).toEqual({
      period: '24h',
      uptimeRobot: { state: 'unreachable', checkedAt, dashboardUrl: UPTIMEROBOT_DASHBOARD },
      grafana: {
        state: 'unreachable',
        checkedAt,
        dashboardUrl: 'https://sodiq.grafana.net/alerting/list',
      },
      sentry: { state: 'unreachable', checkedAt, dashboardUrl: 'https://sodiq.sentry.io/issues/' },
    });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const logged = lines.join('\n');
    for (const secret of [
      UPTIME_KEY,
      GRAFANA_TOKEN,
      SENTRY_TOKEN,
      'api.uptimerobot.com',
      'Invalid token',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('says "unreachable" when a service does not answer in time', async () => {
    const { fetcher } = fakeNetwork((url) => (url.includes('grafana') ? 'hang' : happy(url)));
    let read: StatusProviders | undefined;
    const lines = await logLinesOf(async () => {
      read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher, 50).read();
    });
    if (read === undefined) throw new Error('No answer.');
    expect(lines.every((one) => one.includes('grafana panel'))).toBe(true);

    expect(read.grafana.state).toBe('unreachable');
    expect(read.uptimeRobot.state).toBe('connected');
    expect(read.sentry.state).toBe('connected');
  });

  it('keeps an answer for a minute per period, then reads again', async () => {
    const clock = new FixedClock(NOW);
    const { calls, fetcher } = fakeNetwork(happy);
    const reader = new StatusProviderReader(CONNECTED, clock, fetcher);

    await reader.read();
    // UptimeRobot, Grafana's rules and its history, Sentry.
    expect(calls).toHaveLength(4);
    clock.advance(PROVIDER_CACHE_MS - 1);
    const kept = await reader.read();
    expect(calls).toHaveLength(4);
    expect(kept.grafana).toMatchObject({ checkedAt: new Date(NOW).toISOString() });
    // Another period is read on its own.
    await reader.read('7d');
    expect(calls).toHaveLength(8);
    clock.advance(1);
    const fresh = await reader.read();
    expect(calls).toHaveLength(12);
    expect(fresh.grafana).toMatchObject({
      checkedAt: new Date(new Date(NOW).getTime() + PROVIDER_CACHE_MS).toISOString(),
    });
  });

  it('keeps a failure for a minute too, so a service that is down is not asked at every refresh', async () => {
    const clock = new FixedClock(NOW);
    const { calls, fetcher } = fakeNetwork(() => ({ status: 503, body: null }));
    const reader = new StatusProviderReader(CONNECTED, clock, fetcher);

    await logLinesOf(() => reader.read());
    await logLinesOf(() => reader.read());
    expect(calls).toHaveLength(4);
  });
});
