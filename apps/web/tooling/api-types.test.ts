// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const withLf = (text: string): string => text.replaceAll('\r\n', '\n');

// docs/spec/13-technology.md: the API client of the browser is generated from
// the OpenAPI document, so browser and server cannot disagree about a field.
it('schema.generated.ts is up to date (run "pnpm api:client" if this fails)', () => {
  const webRoot = path.resolve(import.meta.dirname, '..');
  const generator = path.join(
    path.dirname(createRequire(import.meta.url).resolve('openapi-typescript/package.json')),
    'bin/cli.js',
  );
  const folder = mkdtempSync(path.join(tmpdir(), 'sodiq-api-types-'));
  try {
    const fresh = path.join(folder, 'schema.generated.ts');
    execFileSync(
      process.execPath,
      [generator, '../api/openapi.generated.json', '--output', fresh],
      { cwd: webRoot, stdio: 'pipe' },
    );

    const committed = readFileSync(path.join(webRoot, 'src/api/schema.generated.ts'), 'utf8');
    expect(withLf(committed)).toBe(withLf(readFileSync(fresh, 'utf8')));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  // The generator runs as a Node process of its own: about 1.5 s alone, but its
  // start has to wait while every package is built and tested at once. The
  // default of 5 s is too close; the comparison itself is not changed.
}, 30_000);
