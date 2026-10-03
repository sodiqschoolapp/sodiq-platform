import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

// docs/spec/13-technology.md, Structure: "All result calculations live in one module
// with no other dependencies."
describe('packages/calc manifest', () => {
  it.each(['dependencies', 'peerDependencies', 'optionalDependencies'])(
    'declares no %s',
    (field) => {
      expect(manifest).not.toHaveProperty(field);
    },
  );
});
