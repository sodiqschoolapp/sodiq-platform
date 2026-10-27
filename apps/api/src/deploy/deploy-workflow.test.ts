import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Task 10.4: production is deployed only by a run the owner starts by hand
// (owner's answers 1, 3 and 19, docs/decisions.md, Decided ahead for Phase
// 10). The workflows are text GitHub reads; these checks keep the order of
// the steps and the triggers.
const root = path.resolve(import.meta.dirname, '../../../..');
const workflow = readFileSync(path.join(root, '.github/workflows/deploy-production.yml'), 'utf8');
const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

/** The text of one job, from its name to the next job. */
function jobOf(text: string, name: string): string {
  const jobs = text.slice(text.indexOf('\njobs:\n')).split(/\n(?= {2}[a-z-]+:\n)/);
  const found = jobs.find((job) => job.startsWith(`  ${name}:\n`));
  if (found === undefined) {
    throw new Error(`no job ${name}`);
  }
  return found;
}

describe('the production deploy workflow', () => {
  it('is started by hand only, on main', () => {
    const triggers = workflow.slice(
      workflow.indexOf('\non:\n'),
      workflow.indexOf('\npermissions:'),
    );

    expect(triggers).toContain('workflow_dispatch:');
    for (const other of [
      'push',
      'pull_request',
      'schedule',
      'workflow_run',
      'repository_dispatch',
    ]) {
      expect(triggers).not.toMatch(new RegExp(`^\\s+${other}:`, 'm'));
    }
    for (const job of ['image', 'deploy']) {
      expect(jobOf(workflow, job)).toContain("if: github.ref == 'refs/heads/main'");
    }
  });

  it('carries a token that reads the repository and its runs, nothing more', () => {
    expect(workflow).toContain('\npermissions:\n  contents: read\n  actions: read\n\n');
    expect(workflow.match(/permissions:/g)).toHaveLength(1);
  });

  it('proves the image before the deploy, and deploys nothing with check_only', () => {
    const image = jobOf(workflow, 'image');
    const deploy = jobOf(workflow, 'deploy');

    expect(image).toContain('docker build');
    expect(image).toContain('cli.js pdf-check');
    expect(image).toContain('test -f apps/web/dist/index.html');
    expect(image).toContain('node "apps/api/dist/$entry.js"');
    expect(image).not.toContain('environment:');
    expect(image).not.toContain('secrets.');
    expect(deploy).toContain('needs: [image]');
    expect(deploy).toContain('!inputs.check_only');
  });

  it('builds, checks the window and the commit, then migrates, deploys and smoke-tests', () => {
    const deploy = jobOf(workflow, 'deploy');
    const order = [
      'pnpm turbo run build --filter=@sodiq/api',
      'cli.js window',
      'cli.js release-check "$COMMIT"',
      'pnpm db:migrate',
      'cli.js deploy --commit "$COMMIT"',
      'cli.js smoke "$PRODUCTION_URL"',
    ].map((step) => {
      const at = deploy.indexOf(step);
      expect(at, step).toBeGreaterThan(-1);
      return at;
    });

    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(deploy).toContain('environment:\n      name: production\n');
    expect(deploy).toContain('group: deploy-production\n      cancel-in-progress: false');
    expect(deploy).toContain("DATABASE_URL: ''");
    expect(deploy).toContain("SECOND_STEP_KEY: ''");
  });

  it('is the only workflow that names the production environment', () => {
    expect(ci).not.toMatch(/name: production/);
    expect(ci).not.toContain('PRODUCTION_URL');
    expect(jobOf(ci, 'deploy-test')).toContain('name: test');
  });
});
