import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { routesOf } from '../testing/routes.js';
import {
  ALERT_RULES,
  alertRulesYaml,
  seriesOfRule,
  SIGN_IN_SAVE_UTC_HOURS,
} from './alert-rules.js';
import { SERIES } from './series.js';

const root = path.resolve(import.meta.dirname, '../../../..');

// Task 10.2a, pull request #256: the alert rules of `edge/system-behaviour` ("Alerts go to a
// phone, per branch, for: failed or slow cell saves, a jump in refused saves, failed jobs, a
// failed publish or close, a nightly-check difference, a backup older than 24 hours, and far
// fewer first-slot lessons with attendance by 09:00 than usual"; "A check that did not run also
// raises an alert"), `14` (Monitoring: errors and slow pages) and the owner's line of 28 October
// 2026 ("an alert also fires when those counts stop arriving").
describe('the alert rules', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is the file the owner imports, written from the code', () => {
    const file = readFileSync(path.join(root, 'monitoring/grafana/alert-rules.yaml'), 'utf8');
    expect(
      file,
      'Run: pnpm --filter @sodiq/api build && pnpm --filter @sodiq/api monitoring:rules',
    ).toBe(alertRulesYaml());
  });

  it('has a rule for every alert the spec and the owner name', () => {
    const covered = new Set(ALERT_RULES.map((rule) => rule.rule));
    for (const named of [
      'failed cell saves',
      'slow cell saves',
      'a jump in refused saves',
      'failed jobs',
      'a failed publish or close',
      'a nightly-check difference',
      'a check that did not run',
      'the daily work did not run',
      'a backup older than 24 hours',
      'few first-slot attendance marks by 09:00',
      'errors raise alerts at once',
      'the counts stop arriving',
      'the push down',
      'the worker down',
      'the sign-in-and-save check fails',
    ]) {
      expect(covered, named).toContain(named);
    }
    expect(new Set(ALERT_RULES.map((rule) => rule.alert)).size).toBe(ALERT_RULES.length);
  });

  it('reads only series the code pushes, the request numbers only with sum_over_time', () => {
    for (const rule of ALERT_RULES) {
      for (const series of seriesOfRule(rule)) {
        expect(SERIES, `${rule.alert}: ${series}`).toContain(series);
      }
      for (const series of ['sodiq_requests_count', 'sodiq_request_duration_bucket']) {
        const uses = rule.expr.split(series).length - 1;
        const summed = rule.expr.split(`sum_over_time(${series}`).length - 1;
        expect(summed, `${rule.alert}: ${series}`).toBe(uses);
      }
      expect(rule.for).toMatch(/^\d+m$/);
      expect(rule.summary.length).toBeGreaterThan(10);
    }
  });

  it('fires when a heartbeat, the counts or the backup mark stops arriving', () => {
    const byName = new Map(ALERT_RULES.map((rule) => [rule.alert, rule]));
    for (const name of ['ApiSilent', 'WorkerSilent', 'CountsSilent']) {
      expect(byName.get(name)?.expr).toMatch(
        /^\(sum\(sum_over_time\(.+\[10m\]\)\) or vector\(0\)\) < 1$/,
      );
    }
    expect(byName.get('ApiSilent')?.expr).toContain('service="api"');
    expect(byName.get('WorkerSilent')?.expr).toContain('service="worker"');
    // A mark pushed once a day is read over 48 hours, and its absence fires too.
    const backup = byName.get('BackupOld')?.expr ?? '';
    expect(backup).toContain('max_over_time(sodiq_backup_last_success[48h])');
    expect(backup).toContain('> 86400');
    expect(backup).toContain('absent_over_time(sodiq_backup_last_success[48h])');
  });

  it('names only routes the API has, so a renamed route fails here instead of silencing a rule', () => {
    const registered = new Set(routesOf(app).map((route) => route.name));
    for (const rule of ALERT_RULES) {
      for (const route of rule.routes) {
        expect(registered, `${rule.alert}: ${route}`).toContain(route);
        expect(rule.expr).toContain(route.split(' ')[1] ?? '');
      }
    }
  });

  // Task 10.2b: "A test teacher account signs in and saves a cell in a test class every 5 minutes
  // from 07:00" (edge/system-behaviour); the alert reads 07:00 to 20:00 in Tashkent (decision 7)
  // and two failed runs in a row, or none at all (decision 11).
  it('alerts on the sign-in-and-save check from 07:00 to 20:00 in Tashkent, on two failed runs or none', () => {
    const rule = ALERT_RULES.find((one) => one.alert === 'SignInSaveFailing');
    expect(rule?.expr).toBe(
      '(max(max_over_time(probe_success{job="sign-in-and-save"}[11m])) == 0' +
        ' or absent_over_time(probe_success{job="sign-in-and-save"}[11m]))' +
        ` and on () (hour() >= ${String(SIGN_IN_SAVE_UTC_HOURS.from)} and hour() < ${String(SIGN_IN_SAVE_UTC_HOURS.until)})`,
    );
    // The hours of the expression, as moments of Tashkent: 07:00 is the first hour in, 20:00 the
    // first hour out (hour() is the UTC hour of the evaluation).
    const hourOf = (time: string) => new Date(`2026-11-02T${time}:00+05:00`).getUTCHours();
    const inWindow = (time: string) =>
      hourOf(time) >= SIGN_IN_SAVE_UTC_HOURS.from && hourOf(time) < SIGN_IN_SAVE_UTC_HOURS.until;
    expect(rule?.expr).toContain('hour() >= 2 and hour() < 15');
    expect(['06:59', '07:00', '19:59', '20:00'].map(inWindow)).toEqual([false, true, true, false]);
    // The window holds both arms: a check that fails and a check with no result at all.
    expect(rule?.expr).toMatch(/^\(.+ == 0 or absent_over_time\(.+\)\) and on \(\) \(/);
  });
});
