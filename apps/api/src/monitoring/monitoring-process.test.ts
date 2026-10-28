import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig, type AppConfig } from '../config/config.js';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { SAMPLE_ROW_VALUE, SampleController } from '../testing/sample.controller.js';
import type { Fetch } from './grafana.js';
import { Monitoring, ShippingLogger } from './monitoring.service.js';
import { RequestMetrics } from './request-metrics.js';

const monitoring: AppConfig['monitoring'] = {
  grafana: {
    metricsUrl: 'https://metrics.example.test/push',
    metricsUser: '1',
    logsUrl: 'https://logs.example.test/push',
    logsUser: '2',
    token: 'token',
  },
  instance: 'local',
};
const config: AppConfig = { ...loadConfig(process.env), monitoring };

// Task 10.2a, pull request #256 (the code review's finding 4): the worker's heartbeat, which the
// rule WorkerSilent reads; a push that hangs never holds a request (`edge/system-behaviour`: "Only
// that function fails"); and a real failing request's shipped error line (the owner, 28 October
// 2026: the logs "under the rule of the error reports").
describe('the monitoring of a process', () => {
  it('beats for the worker under its own name', async () => {
    const bodies: string[] = [];
    const fetcher: Fetch = (_url, init) => {
      bodies.push(typeof init.body === 'string' ? init.body : '');
      return Promise.resolve({ ok: true, status: 204 });
    };
    const clock = new FixedClock('2026-10-28T09:00:30+05:00');
    const worker = new Monitoring(config, clock, 'worker', fetcher, new RequestMetrics(clock));
    await worker.pushNumbers();
    expect(bodies).toEqual([
      `sodiq_process,instance=local,service=worker up=1i ${String(Date.parse('2026-10-28T09:00:30+05:00'))}000000`,
    ]);
  });

  describe('in the API', () => {
    let app: NestExpressApplication;
    let release: () => void = () => undefined;
    const logs: string[] = [];

    beforeAll(async () => {
      // A Grafana that never answers until the test lets it.
      const hanging: Fetch = (url, init) =>
        new Promise((resolve) => {
          if (url === monitoring.grafana?.logsUrl && typeof init.body === 'string') {
            logs.push(init.body);
          }
          const previous = release;
          release = () => {
            previous();
            resolve({ ok: true, status: 204 });
          };
        });
      app = await createTestApp({
        config,
        monitoringFetch: hanging,
        controllers: [SampleController],
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
    });

    afterAll(async () => {
      release();
      await app.close();
    });

    it('answers requests while a push hangs', async () => {
      await request(app.getHttpServer()).get('/api/health');
      const pushing = app.get(Monitoring).pushNumbers();
      const started = Date.now();
      const answer = await request(app.getHttpServer()).get('/api/health');
      expect(answer.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(1_000);
      release();
      await pushing;
    });

    it('ships the error line of a failing request with no query, no body and no value of a row', async () => {
      // The process's logger, as main.ts sets it; its console output silenced in the test.
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      Logger.overrideLogger(new ShippingLogger());
      const failed = await request(app.getHttpServer()).get('/api/sample/fault?name=Shahnoza');
      expect(failed.status).toBe(500);
      const shipping = app.get(Monitoring).shipLogs();
      release();
      await shipping;
      const shipped = logs.join('\n');
      expect(shipped).toContain('failed');
      expect(shipped).not.toContain('Shahnoza');
      expect(shipped).not.toContain('name=');
      expect(shipped).not.toContain(SAMPLE_ROW_VALUE);
      // The request line names the route's pattern and the path without its query.
      expect(shipped).toContain('\\"path\\":\\"/api/sample/fault\\"');
    });
  });
});
