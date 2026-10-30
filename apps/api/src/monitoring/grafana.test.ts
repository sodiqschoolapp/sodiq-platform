import { Logger } from '@nestjs/common';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config.js';
import { GrafanaPush, PUSH_TIMEOUT_MS, type Fetch } from './grafana.js';
import { metricsBody } from './otlp.js';

const config = {
  metricsUrl: 'https://metrics.example.test/push',
  metricsUser: '1',
  logsUrl: 'https://logs.example.test/push',
  logsUser: '2',
  token: 'token',
};

const point = { measurement: 'sodiq_process', tags: { service: 'api' }, fields: { up: 1 }, at: 1 };

// Task 10.2a, pull request #256 (`edge/system-behaviour`: "Only that function fails"; plan
// decision 8: whole numbers; OTLP since the first backup of 30 October 2026).
describe('the pushes to Grafana', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a push that fails or answers an error, logs it once until it works again, and never retries', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    const answers = [500, 503, 204, 500];
    const fetcher: Fetch = () => {
      const status = answers[calls] ?? 204;
      calls += 1;
      return Promise.resolve({ ok: status < 300, status });
    };
    const push = new GrafanaPush(config, fetcher);
    await push.metrics([point]);
    await push.metrics([point]);
    expect(calls).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      'The push of metrics to Grafana answered 500; dropped until it works again.',
    );
    await push.metrics([point]);
    await push.metrics([point]);
    expect(warn).toHaveBeenCalledTimes(2);
    // A throw of the network is dropped the same way, and the logs are a kind of their own.
    const throwing = new GrafanaPush(config, () => Promise.reject(new Error('down')));
    await expect(
      throwing.logs({ service: 'api' }, [{ at: 1, level: 'info', text: 'x' }]),
    ).resolves.toBeUndefined();
    expect(warn.mock.calls[2]?.[0]).toBe(
      'The push of logs to Grafana failed; dropped until it works again.',
    );
  });

  it('gives a push at most five seconds', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let signal: AbortSignal | undefined;
    const fetcher: Fetch = (_url, init) => {
      signal = init.signal ?? undefined;
      return Promise.resolve({ ok: true, status: 204 });
    };
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await new GrafanaPush(config, fetcher).metrics([point]);
    expect(timeout).toHaveBeenCalledWith(PUSH_TIMEOUT_MS);
    expect(PUSH_TIMEOUT_MS).toBe(5_000);
    expect(signal).toBeDefined();
  });

  it('sends nothing for nothing', async () => {
    let calls = 0;
    const push = new GrafanaPush(config, () => {
      calls += 1;
      return Promise.resolve({ ok: true, status: 204 });
    });
    await push.metrics([]);
    await push.logs({}, []);
    expect(calls).toBe(0);
  });

  it('is configured with all five variables or none', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/d',
      SECOND_STEP_KEY: 'c29kaXEtbG9jYWwtc2Vjb25kLXN0ZXAta2V5LTAwMDE=',
    };
    const all = {
      GRAFANA_METRICS_URL: config.metricsUrl,
      GRAFANA_METRICS_USER: '1',
      GRAFANA_LOGS_URL: config.logsUrl,
      GRAFANA_LOGS_USER: '2',
      GRAFANA_TOKEN: 'token',
    };
    expect(loadConfig(base).monitoring).toEqual({ grafana: undefined, instance: 'local' });
    expect(loadConfig({ ...base, ...all, RENDER_INSTANCE_ID: 'srv-1-abc' }).monitoring).toEqual({
      grafana: config,
      instance: 'srv-1-abc',
    });
    for (const name of Object.keys(all)) {
      const missing: Record<string, string> = { ...base, ...all };
      delete missing[name];
      expect(() => loadConfig(missing)).toThrow(name);
    }
  });
});

describe('the OTLP body of the numbers', () => {
  it('sends each field as a gauge named measurement_field, with the tags as attributes', () => {
    const body = JSON.parse(
      metricsBody([
        {
          measurement: 'sodiq_requests',
          tags: { route: '/api/x', branch: 'none', method: 'GET', empty: '' },
          fields: { count: 2, ms_sum: 15 },
          at: 60_000,
        },
        {
          measurement: 'sodiq_requests',
          tags: { route: '/api/y' },
          fields: { count: 1 },
          at: 60_000,
        },
      ]),
    ) as unknown;
    expect(body).toEqual({
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              scope: { name: 'sodiq' },
              metrics: [
                {
                  name: 'sodiq_requests_count',
                  gauge: {
                    dataPoints: [
                      {
                        asInt: '2',
                        timeUnixNano: '60000000000',
                        // In the order of their keys; an empty tag left out.
                        attributes: [
                          { key: 'branch', value: { stringValue: 'none' } },
                          { key: 'method', value: { stringValue: 'GET' } },
                          { key: 'route', value: { stringValue: '/api/x' } },
                        ],
                      },
                      {
                        asInt: '1',
                        timeUnixNano: '60000000000',
                        attributes: [{ key: 'route', value: { stringValue: '/api/y' } }],
                      },
                    ],
                  },
                },
                {
                  name: 'sodiq_requests_ms_sum',
                  gauge: {
                    dataPoints: [
                      {
                        asInt: '15',
                        timeUnixNano: '60000000000',
                        attributes: [
                          { key: 'branch', value: { stringValue: 'none' } },
                          { key: 'method', value: { stringValue: 'GET' } },
                          { key: 'route', value: { stringValue: '/api/x' } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('keeps every tag value as it is, whatever its characters', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (route, branch) => {
        const body = JSON.parse(
          metricsBody([
            { measurement: 'sodiq_requests', tags: { route, branch }, fields: { count: 1 }, at: 1 },
          ]),
        ) as {
          resourceMetrics: {
            scopeMetrics: {
              metrics: {
                gauge: {
                  dataPoints: { attributes: { key: string; value: { stringValue: string } }[] }[];
                };
              }[];
            }[];
          }[];
        };
        const attributes =
          body.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.gauge.dataPoints[0]?.attributes ??
          [];
        expect(
          Object.fromEntries(attributes.map((one) => [one.key, one.value.stringValue])),
        ).toEqual({
          route,
          branch,
        });
      }),
    );
  });

  it('takes whole numbers and plain names only', () => {
    expect(() =>
      metricsBody([{ measurement: 'sodiq_x', tags: {}, fields: { share: 0.5 }, at: 1 }]),
    ).toThrow('Not a whole-number field');
    expect(() =>
      metricsBody([{ measurement: 'Bad name', tags: {}, fields: { a: 1 }, at: 1 }]),
    ).toThrow('Not a measurement name');
    expect(() => metricsBody([{ measurement: 'sodiq_x', tags: {}, fields: {}, at: 1 }])).toThrow(
      'A point needs a field.',
    );
  });
});
