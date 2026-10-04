import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';

const packageDirectory = path.resolve(import.meta.dirname, '../..');

// .claude/rules/database.md: after a migration, run `pnpm db:codegen` and commit
// the generated types. This fails when that was forgotten.
describe('generated Kysely types', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('match a database built from the migrations', () => {
    // The same options as the `db:codegen` script, in verify mode. The address
    // is that of a throw-away local test database.
    const result = spawnSync(
      `kysely-codegen --dialect postgres --url "${database.migrationUrl}" --date-parser string --exclude-pattern "pgboss.*" --out-file src/database/types.generated.ts --verify`,
      { cwd: packageDirectory, shell: true, encoding: 'utf8' },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
