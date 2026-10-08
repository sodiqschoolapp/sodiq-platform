import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');
const blueprint = readFileSync(path.join(root, 'render.yaml'), 'utf8');
const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  packageManager: string;
};

// docs/build-plan.md, task 0.10. The Blueprint is text that Render reads; these
// checks keep it in step with the repository without a YAML library.
describe('the Render Blueprint', () => {
  it('installs the pnpm of packageManager in every build', () => {
    const builds = blueprint.match(/buildCommand: .*/g) ?? [];

    expect(builds.length).toBeGreaterThan(0);
    for (const build of builds) {
      expect(build).toContain(`npm install -g ${rootPackage.packageManager} &&`);
    }
  });

  it('holds no value of a secret: the three are entered in the dashboard', () => {
    for (const secret of ['DATABASE_URL', 'SECOND_STEP_KEY', 'SENTRY_DSN']) {
      const lines = blueprint.split('\n').filter((line) => line.includes(`key: ${secret}`));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const next = blueprint.split('\n')[blueprint.split('\n').indexOf(line) + 1] ?? '';
        expect(next.trim()).toBe('sync: false');
      }
    }
    expect(blueprint).not.toMatch(/postgres:\/\//);
    expect(blueprint).not.toMatch(/https:\/\/[0-9a-f]+@/);
  });

  it('deploys only when the deploy job says so, and names the test address', () => {
    // Both services, not the comment at the top.
    expect(blueprint.match(/^\s+autoDeployTrigger: off$/gm)).toHaveLength(2);
    expect(blueprint).toContain('healthCheckPath: /api/health');
    expect(blueprint).toContain('- app-test.sodiqschool.uz');
    expect(blueprint).toContain('TRUST_PROXY');
    expect(blueprint).toContain('WEB_FILES');
    expect(blueprint).toContain('HOST');
  });
});
