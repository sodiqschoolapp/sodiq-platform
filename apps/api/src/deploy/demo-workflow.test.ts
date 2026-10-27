import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The demo data of the test environment (asked for by the owner on 27 October
// 2026, docs/deploy.md, Demo data). The run replaces a whole database, so
// these checks keep it to the test environment, by hand, on main, with the
// confirmation typed, and the demo password masked before anything prints.
const root = path.resolve(import.meta.dirname, '../../../..');
const workflow = readFileSync(path.join(root, '.github/workflows/demo-data.yml'), 'utf8');
const clear = readFileSync(path.join(root, 'db/demo/clear-for-restore.sql'), 'utf8');

describe('the demo data workflow', () => {
  it('is started by hand only, on main, with REPLACE typed', () => {
    const triggers = workflow.slice(
      workflow.indexOf('\non:\n'),
      workflow.indexOf('\npermissions:'),
    );
    expect(triggers).toContain('workflow_dispatch:');
    for (const other of ['push', 'pull_request', 'schedule', 'workflow_run']) {
      expect(triggers).not.toMatch(new RegExp(`^\\s+${other}:`, 'm'));
    }
    expect(workflow).toContain(
      "if: github.ref == 'refs/heads/main' && inputs.confirm == 'REPLACE'",
    );
  });

  it('knows the environment test only, never production', () => {
    expect(workflow).toMatch(/environment:\n\s+name: test\n/);
    const code = workflow
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/production/i);
    // The secrets it reads are those of the environment test.
    const secrets = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((match) => match[1]);
    expect(new Set(secrets)).toEqual(new Set(['DATABASE_MIGRATION_URL', 'RENDER_API_KEY']));
  });

  it('masks the demo password in its first step, never through an env line', () => {
    const steps = workflow.slice(workflow.indexOf('    steps:\n'));
    const first = steps.slice(0, steps.indexOf('      - uses:'));
    expect(first).toContain('echo "::add-mask::$password"');
    expect(workflow).not.toContain('inputs.demo_password }}');
  });

  it('builds the demo before it suspends anything, and resumes whatever it suspended', () => {
    const order = [
      'The test database has the migrations of this commit',
      'Build the demo school through the application',
      'Dump the demo database',
      'Suspend the test API and worker',
      'Replace the test database with the demo',
      'Resume the test API and worker',
    ].map((name) => workflow.indexOf(`- name: ${name}`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(workflow).toContain("if: always() && steps.suspend.outcome != 'skipped'");
  });

  it('clears only what the migration user owns, and keeps the extensions', () => {
    expect(clear).toContain('pg_get_userbyid(c.relowner) = current_user');
    expect(clear).not.toMatch(/drop (extension|owned|database|role)/i);
    expect(workflow).toContain('--exclude-extension=btree_gist');
  });
});
