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

  it('runs the speed run at three times the data and keeps its report', () => {
    expect(workflow).toContain('runs-on: ubuntu-24.04');
    expect(workflow).toContain('image: postgres:18');
    expect(workflow).toContain(
      'run: pnpm --filter @sodiq/api exec vitest run src/modules/timetable/speed.database.test.ts',
    );
    expect(workflow).toContain('SPEED_SIZE: triple');
    const keep = workflow.slice(workflow.indexOf('- name: Keep the report'));
    expect(keep).toContain('if: always()');
    expect(keep).toContain('path: apps/api/speed-report-triple.md');
  });

  it('gives the run more time than its own limit of five hours', () => {
    const minutes = Number(/timeout-minutes: (\d+)/.exec(workflow)?.[1]);
    expect(minutes).toBeGreaterThan(300);
    expect(minutes).toBeLessThanOrEqual(360);
  });
});
