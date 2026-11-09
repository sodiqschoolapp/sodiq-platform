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
  it('runs the pnpm of packageManager through npx, in every command of every build', () => {
    const builds = blueprint.match(/buildCommand: .*/g) ?? [];

    expect(builds.length).toBeGreaterThan(0);
    for (const build of builds) {
      // Render's global npm folder is read-only (no `npm install -g`), so each
      // command of the build names the version itself.
      const commands = build.replace('buildCommand: ', '').split(' && ');
      expect(commands.length).toBeGreaterThan(1);
      for (const command of commands) {
        expect(command.startsWith(`npx -y ${rootPackage.packageManager} `), command).toBe(true);
      }
      expect(build).not.toContain('npm install -g');
    }
  });

  it('holds no value of a secret: each is entered in the dashboard, on every service', () => {
    const lines = blueprint.split('\n');
    // Task 11.4: the bot's token on the API and the worker, the webhook's secret on the API.
    const once = ['VITE_SENTRY_DSN', 'TELEGRAM_WEBHOOK_SECRET', 'PARENT_BOT_USERNAME'];
    for (const secret of [
      'DATABASE_URL',
      'SECOND_STEP_KEY',
      'SENTRY_DSN',
      'VITE_SENTRY_DSN',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'PARENT_BOT_USERNAME',
    ]) {
      const at = lines.flatMap((line, index) =>
        line.trim() === `- key: ${secret}` ? [index] : [],
      );
      expect(at.length, secret).toBeGreaterThanOrEqual(once.includes(secret) ? 1 : 2);
      for (const index of at) {
        expect(lines[index + 1]?.trim(), `${secret} at line ${String(index + 1)}`).toBe(
          'sync: false',
        );
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

// Task 10.4: production has its own Blueprint (decision 2 of pull request
// #244), on Docker with two 2 GB servers in Frankfurt (owner's answer 15) at
// app.sodiqschool.uz (answer 14), deployed only by the owner's workflow.
const production = readFileSync(path.join(root, 'render.production.yaml'), 'utf8');

/** The lines of one service of a Blueprint, from its `- type:` to the next. */
function serviceOf(text: string, name: string): string {
  const services = text.split(/\n(?= {2}- type: )/);
  const found = services.find((service) => service.includes(`\n    name: ${name}\n`));
  if (found === undefined) {
    throw new Error(`no service ${name}`);
  }
  return found;
}

describe('the production Blueprint', () => {
  const api = serviceOf(production, 'sodiq-api');
  const worker = serviceOf(production, 'sodiq-worker');

  it('holds no value of a secret: each is entered in the dashboard, on every service', () => {
    const secrets: [string, string[]][] = [
      ['DATABASE_URL', [api, worker]],
      ['SECOND_STEP_KEY', [api, worker]],
      ['SENTRY_DSN', [api, worker]],
      ['VITE_SENTRY_DSN', [api]],
      ['R2_ACCOUNT_ID', [api]],
      ['R2_ACCESS_KEY_ID', [api]],
      ['R2_SECRET_ACCESS_KEY', [api]],
      ['R2_BUCKET', [api]],
      // Task 10.2a: Grafana on both services, the Sentry organisation of the source maps on the API.
      ['GRAFANA_METRICS_URL', [api, worker]],
      ['GRAFANA_METRICS_USER', [api, worker]],
      ['GRAFANA_LOGS_URL', [api, worker]],
      ['GRAFANA_LOGS_USER', [api, worker]],
      ['GRAFANA_TOKEN', [api, worker]],
      ['SENTRY_ORG', [api]],
      // The production bot, at go-live of the parent portal (after task 11.5): the token on
      // both services (the worker sends the digest and the announcements), the webhook's
      // secret and the bot's public name on the API, all entered by the owner in the dashboard.
      ['TELEGRAM_BOT_TOKEN', [api, worker]],
      ['TELEGRAM_WEBHOOK_SECRET', [api]],
      ['PARENT_BOT_USERNAME', [api]],
    ];
    for (const [secret, services] of secrets) {
      for (const service of services) {
        expect(service, secret).toContain(`- key: ${secret}\n        sync: false\n`);
      }
    }
    expect(production.match(/- key: /g)?.length).toBe(
      production.match(/- key: [A-Z0-9_]+\n\s+(sync: false|value: .+)\n/g)?.length,
    );
    // The worker never takes the webhook's secret: only the API answers Telegram's calls.
    expect(worker).not.toContain('TELEGRAM_WEBHOOK_SECRET');
    expect(production).not.toMatch(/postgres:\/\//);
    expect(production).not.toMatch(/https:\/\/[0-9a-f]+@/);
  });

  it('runs two API servers and the worker of 2 GB in Frankfurt, from the Dockerfile', () => {
    for (const service of [api, worker]) {
      expect(service).toContain('\n    runtime: docker\n');
      expect(service).toContain('\n    region: frankfurt\n');
      expect(service).toContain('\n    plan: standard\n');
      expect(service).toContain('\n    dockerfilePath: ./Dockerfile\n');
      expect(service).toContain('\n    autoDeployTrigger: off\n');
      expect(service).toContain('\n    maxShutdownDelaySeconds: 30\n');
      expect(service).not.toContain('buildCommand');
    }
    expect(api.startsWith('  - type: web\n')).toBe(true);
    expect(api).toContain('\n    numInstances: 2\n');
    expect(api).toContain('\n    healthCheckPath: /api/health\n');
    expect(worker.startsWith('  - type: worker\n')).toBe(true);
    expect(worker).toContain('\n    dockerCommand: node apps/api/dist/worker.js\n');
  });

  it('names the production address and environment, never the test ones', () => {
    expect(api).toContain('\n    domains:\n      - app.sodiqschool.uz\n');
    for (const service of [api, worker]) {
      expect(service).toContain('- key: SENTRY_ENVIRONMENT\n        value: production\n');
      expect(service).toContain('- key: WEB_ORIGIN\n        value: https://app.sodiqschool.uz\n');
    }
    expect(api).toContain('- key: VITE_SENTRY_ENVIRONMENT\n        value: production\n');
    expect(api).toContain('- key: SENTRY_PROJECT\n        value: sodiq-production-web\n');
    // The token of the source maps is a Secret File, never a variable of the Blueprint.
    expect(production).not.toContain('key: SENTRY_AUTH_TOKEN');
    expect(api).toContain("- key: TRUST_PROXY\n        value: '1'\n");
    expect(production).not.toContain('app-test');
    expect(production).not.toMatch(/value: test\b/);
    expect(production).not.toContain('PHOTOS_IN_MEMORY');
    expect(production).not.toContain('MAIL_OUTBOX_DIR');
    // The test Blueprint never reaches production.
    expect(blueprint).not.toContain('app.sodiqschool.uz');
    expect(blueprint).not.toMatch(/name: sodiq-(api|worker)\n/);
  });
});

// Task 10.5: the demo clock runs on the test environment only (`13`, Hosting; the owner,
// 4 November 2026). The API and the worker refuse it at start anywhere else (config.test.ts).
describe('the demo clock in the Blueprints', () => {
  it('is on for the test API and the test worker', () => {
    for (const name of ['sodiq-test-api', 'sodiq-test-worker']) {
      const service = serviceOf(blueprint, name);
      expect(service, name).toContain("- key: DEMO_CLOCK\n        value: '1'\n");
      // An environment in which config.ts lets it run.
      expect(service, name).toContain('- key: SENTRY_ENVIRONMENT\n        value: test\n');
    }
  });

  it('is never named by production', () => {
    expect(production).not.toContain('DEMO_CLOCK');
  });
});
