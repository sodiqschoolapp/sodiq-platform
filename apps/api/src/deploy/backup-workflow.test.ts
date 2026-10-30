import { execFileSync } from 'node:child_process';
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
        'secrets.NEON_API_KEY',
        'secrets.NEON_PROJECT_ID',
      ].sort(),
    );
    // Every address written in the file is the job's own server.
    for (const url of workflow.match(/postgres:\/\/[^\s"']+/g) ?? []) {
      expect(url).toMatch(/^postgres:\/\/postgres:postgres@localhost:5432\//);
    }
  });

  it("reads a snapshot of production made for the run, and deletes it whatever the run's end", () => {
    // The live read replica ended the dump with "conflict with recovery" (30 October 2026).
    expect(stepRun('Take a snapshot of production')).toContain(
      'run: node apps/api/dist/deploy/cli.js backup-snapshot\n',
    );
    for (const name of ['Dump the production database', 'Count the rows of production']) {
      expect(stepRun(name), name).toContain('BACKUP_DATABASE_URL: ${{ env.SNAPSHOT_URL }}\n');
      expect(stepRun(name), name).not.toContain('secrets.');
    }
    const remove = stepRun('Delete the snapshot');
    expect(remove).toContain("if: always() && env.SNAPSHOT_BRANCH_ID != ''\n");
    expect(remove).toContain('run: node apps/api/dist/deploy/cli.js backup-snapshot-delete\n');
    // The secret address is read by the snapshot step only.
    expect(workflow.match(/secrets\.BACKUP_DATABASE_URL/g)).toHaveLength(1);
    expect(stepRun('Take a snapshot of production')).toContain('secrets.BACKUP_DATABASE_URL');
  });

  it("gives the containers that reach production the runner's trusted roots", () => {
    // postgres:18 has no CA bundle, and `sslmode=verify-full` refuses to connect without one.
    expect(workflow).toContain(
      '      TRUSTED_ROOTS: >-\n' +
        '        -v /etc/ssl/certs/ca-certificates.crt:/etc/ssl/certs/ca-certificates.crt:ro\n' +
        '        -e PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt\n' +
        '        -e SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt\n',
    );
    for (const name of ['Dump the production database', 'Count the rows of production']) {
      expect(stepRun(name), name).toContain(
        'docker run --rm --network host -e BACKUP_DATABASE_URL $TRUSTED_ROOTS \\\n',
      );
    }
  });

  it('prints the error lines of a failed dump or count with every value hidden', () => {
    // The first run on production failed with "1 lines in its log, not printed": nothing told
    // a refused connection from a refused read (30 October 2026).
    const script = /\n {6}HIDE_VALUES: '([^'\n]+)'\n/.exec(workflow)?.[1];
    expect(script).toBeDefined();
    for (const [name, log] of [
      ['Dump the production database', '"$RUNNER_TEMP/backup/dump.log"'],
      ['Count the rows of production', '"$RUNNER_TEMP/backup/source-counts.log"'],
    ] as const) {
      expect(stepRun(name), name).toContain(`sed -nE "$HIDE_VALUES" ${log} | head -n 3 || true`);
    }
    const log = [
      'pg_dump: error: connection to server at "ep-quiet-sky-a1b2c3.c-2.eu-central-1.aws.neon.tech" (3.120.10.20), port 5432 failed: FATAL:  password authentication failed for user "sodiq_backup"',
      'pg_dump: error: missing "=" after "postgresql://sodiq_backup:npg_secret@ep-quiet-sky-a1b2c3.eu-central-1.aws.neon.tech/sodiq" in connection info string',
      'pg_dump: error: could not translate host name ep-quiet-sky-a1b2c3.eu-central-1.aws.neon.tech to address',
      'psql:/sql/row-counts.sql:3: ERROR:  permission denied for table students',
      'pg_dump: detail: Query was: COPY public.students (id, first_name) TO stdout;',
    ].join('\n');
    const printed = execFileSync('sed', ['-nE', script ?? ''], { input: log, encoding: 'utf8' });
    expect(printed.split('\n').filter(Boolean)).toEqual([
      'pg_dump: error: connection to server at "..." (...), port 5432 failed: FATAL:  password authentication failed for user "..."',
      'pg_dump: error: missing "..." after "..." in connection info string',
      'pg_dump: error: could not translate host name <host> to address',
      'psql:/sql/row-counts.sql:3: ERROR:  permission denied for table students',
    ]);
    for (const secret of [
      'ep-quiet-sky',
      'npg_secret',
      'sodiq_backup',
      '3.120.10.20',
      'first_name',
    ]) {
      expect(printed).not.toContain(secret);
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
    // A pipe fails its step when its first command fails (GitHub's `bash` is `-eo pipefail`).
    for (const name of ['Create the roles the dump names in the proof']) {
      expect(stepRun(name)).toContain('shell: bash\n');
    }
  });

  it('proves the dump with owners, grants and policies before it stores it', () => {
    const restore = stepRun('Restore the dump into the proof');
    expect(restore).toContain('pg_restore --exit-on-error');
    expect(workflow).not.toContain('--no-owner');
    expect(workflow).not.toContain('--no-privileges');
    const order = [
      'Take a snapshot of production',
      'Dump the production database',
      'Count the rows of production',
      'Create the roles the dump names in the proof',
      'Restore the dump into the proof',
      'Compare the restored copy with production',
      'Store the dump in the backup bucket',
      'Tell Grafana the backup is done',
      'Delete the snapshot',
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
