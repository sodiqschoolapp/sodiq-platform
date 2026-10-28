import { Logger } from '@nestjs/common';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config.js';
import { GrafanaPush, PUSH_TIMEOUT_MS, type Fetch } from './grafana.js';
import { escapeTag, lineOf } from './influx.js';

const config = {
  metricsUrl: 'https://metrics.example.test/push',
  metricsUser: '1',
  logsUrl: 'https://logs.example.test/push',
  logsUser: '2',
  token: 'token',
};

const point = { measurement: 'sodiq_process', tags: { service: 'api' }, fields: { up: 1 }, at: 1 };

// Task 10.2a, pull request #256 (`edge/system-behaviour`: "Only that function fails"; plan
// decision 8: Influx line protocol, whole numbers).
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

describe('Influx lines', () => {
  it('escapes tags so that a value never makes another tag or field', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (route, branch) => {
        const line = lineOf({
          measurement: 'sodiq_requests',
          tags: { route, branch },
          fields: { count: 1 },
          at: 60_000,
        });
        // The line splits at its unescaped spaces into exactly three parts.
        const parts = line.split(/(?<!\\) /);
        expect(parts).toHaveLength(3);
        expect(parts[1]).toBe('count=1i');
        expect(parts[2]).toBe('60000000000');
        expect(line).not.toContain('\n');
        for (const value of [route, branch].filter((one) => one !== '')) {
          expect(parts[0]).toContain(escapeTag(value));
        }
      }),
    );
  });

  it('takes whole numbers only', () => {
    expect(() =>
      lineOf({ measurement: 'sodiq_x', tags: {}, fields: { share: 0.5 }, at: 1 }),
    ).toThrow('Not a whole-number field');
    expect(() => lineOf({ measurement: 'Bad name', tags: {}, fields: { a: 1 }, at: 1 })).toThrow();
  });
});
