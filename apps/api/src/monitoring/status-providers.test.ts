import { Logger } from '@nestjs/common';
import { PROVIDER_CACHE_MS, statusProvidersSchema } from '@sodiq/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatusProvidersConfig } from '../config/config.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { ShippingLogger } from './monitoring.service.js';
import {
  StatusProviderReader,
  UPTIMEROBOT_DASHBOARD,
  type StatusFetch,
} from './status-providers.js';

// Pull request #361 (owner, 19 November 2026): the outside services of the System status page,
// read on the server with read-only keys. Every key and answer here is invented.

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
    },
    {
      id: 2,
      friendly_name: 'api health',
      url: 'https://app.sodiqschool.uz/api/health',
      type: 2,
      status: 9,
      custom_uptime_ratio: '97.100',
    },
    { id: 3, friendly_name: 'old', url: 'https://old.example.org/', type: 1, status: 0 },
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
    : url.includes('grafana')
      ? { status: 200, body: GRAFANA_ANSWER }
      : { status: 200, body: SENTRY_ANSWER };

/** The log lines written while `work` runs, through the application's logger. */
async function logLinesOf(work: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  Logger.overrideLogger(new ShippingLogger());
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
  });

  it('reads the three services with their read-only keys and counts what needs attention', async () => {
    const { calls, fetcher } = fakeNetwork(happy);
    const read = statusProvidersSchema.parse(
      await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher).read(),
    );
    const checkedAt = new Date(NOW).toISOString();

    expect(read.uptimeRobot).toEqual({
      state: 'connected',
      checkedAt,
      attention: 1,
      dashboardUrl: UPTIMEROBOT_DASHBOARD,
      monitors: [
        { name: 'app', url: 'https://app.sodiqschool.uz/', state: 'up', uptime7d: '99.982' },
        {
          name: 'api health',
          url: 'https://app.sodiqschool.uz/api/health',
          state: 'down',
          uptime7d: '97.100',
        },
        { name: 'old', url: 'https://old.example.org/', state: 'paused', uptime7d: null },
      ],
    });
    // Firing first, then pending, then normal; the recording rule left out; a firing rule and a
    // rule whose evaluation fails need attention, a pending one not yet.
    expect(read.grafana).toEqual({
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
    });

    const uptime = calls.find((call) => call.url.includes('uptimerobot'));
    expect(uptime?.url).toBe('https://api.uptimerobot.com/v2/getMonitors');
    expect(uptime?.init.method).toBe('POST');
    expect(typeof uptime?.init.body === 'string' ? uptime.init.body : '').toContain(
      `api_key=${UPTIME_KEY}`,
    );
    const grafana = calls.find((call) => call.url.includes('grafana'));
    expect(grafana?.url).toBe('https://sodiq.grafana.net/api/prometheus/grafana/api/v1/rules');
    expect(grafana?.init.headers).toMatchObject({ Authorization: `Bearer ${GRAFANA_TOKEN}` });
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
      uptimeRobot: { state: 'unreachable', checkedAt, dashboardUrl: UPTIMEROBOT_DASHBOARD },
      grafana: {
        state: 'unreachable',
        checkedAt,
        dashboardUrl: 'https://sodiq.grafana.net/alerting/list',
      },
      sentry: { state: 'unreachable', checkedAt, dashboardUrl: 'https://sodiq.sentry.io/issues/' },
    });
    expect(lines).toHaveLength(3);
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
    const read = await new StatusProviderReader(CONNECTED, new FixedClock(NOW), fetcher, 50).read();

    expect(read.grafana.state).toBe('unreachable');
    expect(read.uptimeRobot.state).toBe('connected');
    expect(read.sentry.state).toBe('connected');
  });

  it('keeps an answer for a minute, then reads again', async () => {
    const clock = new FixedClock(NOW);
    const { calls, fetcher } = fakeNetwork(happy);
    const reader = new StatusProviderReader(CONNECTED, clock, fetcher);

    await reader.read();
    expect(calls).toHaveLength(3);
    clock.advance(PROVIDER_CACHE_MS - 1);
    const kept = await reader.read();
    expect(calls).toHaveLength(3);
    expect(kept.grafana).toMatchObject({ checkedAt: new Date(NOW).toISOString() });
    clock.advance(1);
    const fresh = await reader.read();
    expect(calls).toHaveLength(6);
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
    expect(calls).toHaveLength(3);
  });
});
