import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Task 10.1: the Speed workflow runs the speed run at three times the data by
// hand and every Sunday (the owner's approval of 28 October 2026). The
// workflow is text GitHub reads; these checks keep its shape.
const root = path.resolve(import.meta.dirname, '../../../..');
const workflow = readFileSync(path.join(root, '.github/workflows/speed.yml'), 'utf8');

describe('the Speed workflow', () => {
  it('starts by hand and on Sunday night only', () => {
    const triggers = workflow.slice(
      workflow.indexOf('\non:\n'),
      workflow.indexOf('\npermissions:'),
    );
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).toContain("- cron: '0 17 * * 0'");
    for (const other of ['push', 'pull_request', 'workflow_run', 'repository_dispatch']) {
      expect(triggers).not.toMatch(new RegExp(`^\\s+${other}:`, 'm'));
    }
  });

  it('reads the repository only and reaches no server', () => {
    expect(workflow).toContain('\npermissions:\n  contents: read\n\n');
    expect(workflow.match(/permissions:/g)).toHaveLength(1);
    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toContain('environment:');
    for (const url of workflow.match(/postgres:\/\/[^\s]+/g) ?? []) {
      expect(url).toMatch(/@localhost:5432\//);
    }
  });

  // Task 10.1b (a pin changed because the requirement changed: the owner's line of 29 October
  // 2026 lets the workflow change for the run's time): two jobs, the build and the measure.
  const jobOf = (name: string) => {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    expect(start, name).toBeGreaterThan(0);
    const next = workflow.slice(start + 1).search(/\n {2}[a-z]+:\n/);
    return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
  };

  it('builds the school in one job and measures it in another', () => {
    const build = jobOf('build');
    const measure = jobOf('measure');
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
    expect(jobs.match(/^ {2}[a-z]+:$/gm)).toEqual(['  build:', '  measure:']);
    expect(measure).toContain('needs: build');
    const run =
      'run: pnpm --filter @sodiq/api exec vitest run src/modules/timetable/speed.database.test.ts';
    for (const [job, phase] of [
      [build, 'build'],
      [measure, 'measure'],
    ] as const) {
      expect(job).toContain('runs-on: ubuntu-24.04');
      expect(job).toContain('image: postgres:18');
      expect(job).toContain(run);
      expect(job).toContain('SPEED_SIZE: triple');
      expect(job).toContain(`SPEED_PHASE: ${phase}`);
    }
  });

  it('hands the data over within the run, kept one day, never cached across runs', () => {
    const build = jobOf('build');
    const measure = jobOf('measure');
    expect(build).toContain('name: speed-handover');
    expect(build).toContain('retention-days: 1');
    expect(measure).toContain('name: speed-handover');
    expect(workflow).not.toContain('actions/cache');
    // The server's own major version of the tools (the runner's are older).
    expect(build).toMatch(/\$PG18 pg_dump /);
    expect(measure).toMatch(/\$PG18 pg_restore /);
  });

  it('keeps the report of each job, also when it fails', () => {
    for (const [job, name] of [
      [jobOf('build'), 'speed-report-build'],
      [jobOf('measure'), 'speed-report'],
    ] as const) {
      const keep = job.slice(
        job.indexOf(`name: ${name}
`) - 200,
      );
      expect(keep).toContain('if: always()');
      expect(keep).toContain('path: apps/api/speed-report-triple.md');
    }
  });

  it('gives each job more time than its own limit of five hours', () => {
    const minutes = [...workflow.matchAll(/timeout-minutes: (\d+)/g)].map((one) => Number(one[1]));
    expect(minutes).toHaveLength(2);
    for (const one of minutes) {
      expect(one).toBeGreaterThan(300);
      expect(one).toBeLessThanOrEqual(360);
    }
  });
});
