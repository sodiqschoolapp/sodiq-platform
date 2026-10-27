import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Task 10.4: the production image (owner's answer 15: Docker with Chromium).
// The Dockerfile is text Docker reads; these checks keep it in step with the
// repository, as render-blueprint.test.ts does for the Blueprints.
const root = path.resolve(import.meta.dirname, '../../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const rootPackage = JSON.parse(read('package.json')) as { packageManager: string };
const apiPackage = JSON.parse(read('apps/api/package.json')) as {
  dependencies: Record<string, string>;
};

describe('the production image', () => {
  it('starts from the Node of .node-version, pinned by digest', () => {
    const [from] = dockerfile.match(/^FROM .*/m) ?? [];
    const major = read('.node-version').trim();

    expect(from).toMatch(
      new RegExp(`^FROM node:${major}\\.\\d+\\.\\d+-bookworm-slim@sha256:[0-9a-f]{64} AS base$`),
    );
    // Every later stage builds on that one.
    for (const stage of dockerfile.match(/^FROM .*/gm)?.slice(1) ?? []) {
      expect(stage).toMatch(/^FROM base AS \w+$/);
    }
  });

  it('runs the pnpm of packageManager, with the lockfile frozen', () => {
    const runs = dockerfile.match(/^RUN npx .*/gm) ?? [];

    expect(runs.length).toBe(3);
    for (const run of runs) {
      expect(run.startsWith(`RUN npx -y ${rootPackage.packageManager} `), run).toBe(true);
    }
    expect(dockerfile.match(/install --frozen-lockfile/g)).toHaveLength(2);
    expect(dockerfile).toContain('install --frozen-lockfile --prod --filter "@sodiq/api..."');
  });

  it('installs Chromium with the playwright-core the API runs, for the user that runs it', () => {
    expect(apiPackage.dependencies['playwright-core']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dockerfile).toContain(
      'cd apps/api && node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium',
    );
    expect(dockerfile).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(dockerfile).toContain('chmod -R a+rX /ms-playwright');
    expect(dockerfile).not.toMatch(/CHROMIUM_PATH=/);
    // The browser is installed before the image changes to its user.
    expect(dockerfile.indexOf('playwright-core/cli.js install')).toBeLessThan(
      dockerfile.indexOf('USER node'),
    );
  });

  it('serves the web app and runs the API as a user that is not root', () => {
    const lines = dockerfile.trim().split('\n');

    expect(dockerfile).toContain('WEB_FILES=apps/web/dist');
    expect(dockerfile).toContain('HOST=0.0.0.0');
    expect(dockerfile).toContain('NODE_OPTIONS=--enable-source-maps');
    expect(dockerfile).toContain(
      'COPY --from=build /app/apps/web/public/brand apps/web/public/brand',
    );
    expect(lines.filter((line) => line.startsWith('USER '))).toEqual(['USER node']);
    expect(lines.at(-1)).toBe('CMD ["node", "apps/api/dist/main.js"]');
    for (const argument of ['VITE_SENTRY_DSN', 'VITE_SENTRY_ENVIRONMENT', 'RENDER_GIT_COMMIT']) {
      expect(dockerfile).toContain(`ARG ${argument}\n`);
    }
  });

  it('never copies a local secret or build output into the image', () => {
    const ignored = dockerignore.split('\n').map((line) => line.trim());

    for (const entry of ['.env', '.env.*', '**/node_modules', '**/dist', '.git']) {
      expect(ignored, entry).toContain(entry);
    }
  });
});
