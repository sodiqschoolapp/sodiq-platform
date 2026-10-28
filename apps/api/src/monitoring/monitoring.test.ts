import { Logger } from '@nestjs/common';
import { BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '../config/config.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../testing/day-templates-kit.js';
import type { Fetch } from './grafana.js';
import { Monitoring, ShippingLogger } from './monitoring.service.js';

interface Sent {
  url: string;
  authorization: string;
  body: string;
}

const sent: Sent[] = [];
const recording: Fetch = (url, init) => {
  const headers = init.headers as Record<string, string>;
  sent.push({
    url,
    authorization: headers.Authorization ?? '',
    body: typeof init.body === 'string' ? init.body : '',
  });
  return Promise.resolve({ ok: true, status: 204 });
};

const monitoring: AppConfig['monitoring'] = {
  grafana: {
    metricsUrl: 'https://metrics.example.test/api/v1/push/influx/write',
    metricsUser: '1001',
    logsUrl: 'https://logs.example.test/loki/api/v1/push',
    logsUser: '2002',
    token: 'test-token',
  },
  instance: 'local',
};

/** The Influx lines of every push of numbers so far. */
const linesSent = () =>
  sent
    .filter((one) => one.url === monitoring.grafana?.metricsUrl)
    .flatMap((one) => one.body.split('\n'));

/** The log lines of every push of logs so far, with their stream's labels. */
const logsSent = () =>
  sent
    .filter((one) => one.url === monitoring.grafana?.logsUrl)
    .flatMap((one) => {
      const body = JSON.parse(one.body) as {
        streams: { stream: Record<string, string>; values: [string, string][] }[];
      };
      return body.streams.flatMap((stream) =>
        stream.values.map(([, text]) => ({ labels: stream.stream, text })),
      );
    });

// Task 10.2a, pull request #256 (owner, 28 October 2026: "the API's request times and answers per
// route and branch … Request logs and metrics carry the path without its query, no body and no
// name, under the rule of the error reports"; `CLAUDE.md`: no personal data in logs).
describe('the numbers and logs pushed to Grafana', () => {
  let t: DayTemplatesKit;
  let pushes: Monitoring;

  beforeAll(async () => {
    t = await dayTemplatesKit({
      config: { ...loadConfig(process.env), monitoring },
      monitoringFetch: recording,
    });
    pushes = t.app.get(Monitoring);
  });

  beforeEach(async () => {
    // Whatever earlier requests left is pushed and forgotten.
    t.clock.set('2026-10-11T00:30:00+05:00');
    await pushes.pushNumbers();
    await pushes.shipLogs();
    sent.length = 0;
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  it('counts a request by its route pattern and the branch the guard accepted, never the id or the query', async () => {
    const created = await t.post('/api/setup/slot-types', t.north, {
      name: 'Lesson Tilak',
      kind: 'lesson',
      lengthMinutes: 45,
    });
    const id = String(
      (created.body as { id?: string }).id ?? '00000000-0000-7000-8000-000000000001',
    );
    await t.get(`/api/setup/slot-types?search=Shahnoza`, t.north);
    await t.patch(`/api/setup/slot-types/${id}`, t.north, { name: 'Lesson Tilakova' });
    // The minute ends: its numbers are pushed once.
    t.clock.set('2026-10-11T00:00:00+05:00');
    await pushes.pushNumbers();
    const lines = linesSent();
    const all = lines.join('\n');
    expect(all).not.toContain(id);
    expect(all).not.toContain('Shahnoza');
    expect(all).not.toContain('Tilak');
    const counted = lines.filter((line) => line.startsWith('sodiq_requests,'));
    expect(counted).toContainEqual(expect.stringContaining(`branch=${t.north}`));
    expect(counted).toContainEqual(
      expect.stringContaining('route=/api/setup/slot-types/:id,service=api,status='),
    );
    expect(
      counted.find((line) => line.includes('method=GET,route=/api/setup/slot-types,')),
    ).toMatch(/ count=1i,ms_sum=\d+i \d+000000$/);
    // Each minute's numbers once, with a bucket per bound and +Inf.
    const durations = lines.filter(
      (line) =>
        line.startsWith('sodiq_request_duration,') &&
        line.includes('method=GET,route=/api/setup/slot-types,'),
    );
    expect(durations.map((line) => /le=([^,]+)/.exec(line)?.[1])).toEqual([
      '0.1',
      '0.2',
      '0.3',
      '0.5',
      '1',
      '2',
      '5',
      '+Inf',
    ]);
    expect(lines).toContainEqual(
      expect.stringMatching(/^sodiq_process,instance=local,service=api up=1i /),
    );
    sent.length = 0;
    await pushes.pushNumbers();
    expect(linesSent().filter((line) => line.startsWith('sodiq_requests,'))).toEqual([]);
    // The basic authentication of the metrics user.
    expect(sent[0]?.authorization).toBe(
      `Basic ${Buffer.from('1001:test-token').toString('base64')}`,
    );
  });

  it('labels a refused, a public and a school-wide request with no branch, and keeps 4xx apart', async () => {
    // A Teacher may not create a slot type: refused by the guard, so no branch.
    await t.post('/api/setup/slot-types', t.north, { name: 'Refused' }, t.teacher);
    await request(t.kit.server).get('/api/health');
    await t.kit.get('/api/setup/branches', t.admin);
    // Another branch named in the header of a school-wide route: not a label.
    await t.kit.get('/api/setup/branches', t.admin).set(BRANCH_HEADER, t.south);
    t.clock.set('2026-10-11T00:00:00+05:00');
    await pushes.pushNumbers();
    const counted = linesSent().filter((line) => line.startsWith('sodiq_requests,'));
    expect(counted).toContainEqual(
      expect.stringMatching(
        /^sodiq_requests,branch=none,.*method=POST,route=\/api\/setup\/slot-types,.*status=4xx /,
      ),
    );
    expect(counted).toContainEqual(
      expect.stringMatching(/^sodiq_requests,branch=none,.*route=\/api\/health,.*status=2xx /),
    );
    expect(counted.filter((line) => line.includes('route=/api/setup/branches,'))).toEqual([
      expect.stringMatching(/^sodiq_requests,branch=none,.* count=2i/),
    ]);
    expect(counted.join('\n')).not.toContain(t.south);
  });

  it('logs each request as its pattern and path without the query, and ships the lines of the loggers', async () => {
    await t.get('/api/setup/slot-types?search=Shahnoza', t.north);
    await request(t.kit.server).get('/api/no-such-route?name=Shahnoza');
    // A line written as the error responses write theirs, through the process's logger.
    const logger = new ShippingLogger();
    logger.error('Request 0199 failed', 'Error: boom\n    at work (file.ts:1:1)', 'Errors');
    new Logger('Jobs').log('a job line');
    await pushes.shipLogs();
    const logged = logsSent();
    const all = logged.map((line) => line.text).join('\n');
    expect(all).not.toContain('Shahnoza');
    expect(all).not.toContain('search=');
    const requests = logged
      .filter((line) => line.text.startsWith('{"kind":"request"'))
      .map((line) => JSON.parse(line.text) as Record<string, unknown>);
    expect(requests).toContainEqual({
      kind: 'request',
      requestId: expect.any(String) as unknown,
      method: 'GET',
      route: '/api/setup/slot-types',
      path: '/api/setup/slot-types',
      status: 200,
      ms: expect.any(Number) as unknown,
      branch: t.north,
    });
    expect(requests).toContainEqual(
      expect.objectContaining({ route: 'unmatched', path: '/api/no-such-route', status: 404 }),
    );
    // Exactly these keys: no body, no cookie, no query, no account.
    for (const line of requests) {
      expect(Object.keys(line).sort()).toEqual(
        ['branch', 'kind', 'method', 'ms', 'path', 'requestId', 'route', 'status'].sort(),
      );
    }
    expect(logged).toContainEqual({
      labels: { service: 'api', instance: 'local', level: 'error' },
      text: 'Request 0199 failed Error: boom\n    at work (file.ts:1:1) Errors',
    });
    expect(sent.find((one) => one.url === monitoring.grafana?.logsUrl)?.authorization).toBe(
      `Basic ${Buffer.from('2002:test-token').toString('base64')}`,
    );
  });
});
