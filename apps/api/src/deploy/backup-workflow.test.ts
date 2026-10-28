import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Task 10.2a, pull request #256: the Backup workflow dumps production every night (the owner's
// approval of 28 October 2026 for new workflow files of the daily export). The workflow is text
// GitHub reads; these checks keep its shape. The repository is public, so its log is too (plan
// review, correction 4).
const root = path.resolve(import.meta.dirname, '../../../..');
const workflow = readFileSync(path.join(root, '.github/workflows/backup.yml'), 'utf8');

/** The `run:` block of the named step. */
function stepRun(name: string): string {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

describe('the Backup workflow', () => {
  it('runs every night at 02:30 Tashkent and by hand, on main only', () => {
    const triggers = workflow.slice(
      workflow.indexOf('\non:\n'),
      workflow.indexOf('\npermissions:'),
    );
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).toContain("- cron: '30 21 * * *'");
    for (const other of ['push', 'pull_request', 'workflow_run', 'repository_dispatch']) {
      expect(triggers).not.toMatch(new RegExp(`^\\s+${other}:`, 'm'));
    }
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
  });

  it('reads the repository only, uses the environment backup and never runs during a production deploy', () => {
    expect(workflow).toContain('\npermissions:\n  contents: read\n\n');
    expect(workflow.match(/permissions:/g)).toHaveLength(1);
    expect(workflow).toContain('    environment:\n      name: backup\n');
    expect(workflow).toContain(
      '\nconcurrency:\n  group: deploy-production\n  cancel-in-progress: false\n',
    );
  });

  it('names exactly the secrets of the environment backup', () => {
    const secrets = [...new Set(workflow.match(/secrets\.[A-Z0-9_]+/g) ?? [])].sort();
    expect(secrets).toEqual(
      [
        'secrets.BACKUP_DATABASE_URL',
        'secrets.BACKUP_R2_ACCESS_KEY_ID',
        'secrets.BACKUP_R2_ACCOUNT_ID',
        'secrets.BACKUP_R2_BUCKET',
        'secrets.BACKUP_R2_SECRET_ACCESS_KEY',
        'secrets.GRAFANA_METRICS_URL',
        'secrets.GRAFANA_METRICS_USER',
        'secrets.GRAFANA_TOKEN',
      ].sort(),
    );
    // Every address written in the file is the job's own server.
    for (const url of workflow.match(/postgres:\/\/[^\s"']+/g) ?? []) {
      expect(url).toMatch(/^postgres:\/\/postgres:postgres@localhost:5432\//);
    }
  });

  it('keeps nothing as an artifact and prints no output of pg_dump, pg_restore or psql', () => {
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).not.toContain('cache:\n          path');
    for (const name of [
      'Dump the production database',
      'Count the rows of production',
      'Create the roles the dump names in the proof',
      'Restore the dump into the proof',
      'Compare the restored copy with production',
    ]) {
      // One line per command: the continuations joined.
      const run = stepRun(name).replace(/\\\n\s*/g, ' ');
      const commands = run.match(/\b(pg_dump|pg_restore|psql) (?=["$p-])[^\n]*/g) ?? [];
      expect(commands.length, name).toBeGreaterThan(0);
      for (const command of commands) {
        // Each command's output goes to a file of the runner or into the next command.
        expect(command, `${name}: ${command}`).toMatch(/>|\|/);
      }
    }
    expect(stepRun('Dump the production database')).toContain(
      '> "$RUNNER_TEMP/backup/dump.log" 2>&1',
    );
    expect(stepRun('Restore the dump into the proof')).toContain(
      '> "$RUNNER_TEMP/backup/restore.log" 2>&1',
    );
    expect(stepRun('Remove the dump from the runner')).toContain('if: always()');
  });

  it('proves the dump with owners, grants and policies before it stores it', () => {
    const restore = stepRun('Restore the dump into the proof');
    expect(restore).toContain('pg_restore --exit-on-error');
    expect(workflow).not.toContain('--no-owner');
    expect(workflow).not.toContain('--no-privileges');
    const order = [
      'Dump the production database',
      'Count the rows of production',
      'Create the roles the dump names in the proof',
      'Restore the dump into the proof',
      'Compare the restored copy with production',
      'Store the dump in the backup bucket',
      'Tell Grafana the backup is done',
    ].map((name) => workflow.indexOf(`- name: ${name}`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(stepRun('Create the roles the dump names in the proof')).toContain(
      'node apps/api/dist/deploy/cli.js backup-roles',
    );
    expect(stepRun('Compare the restored copy with production')).toContain(
      'node apps/api/dist/deploy/cli.js backup-compare',
    );
  });
});
