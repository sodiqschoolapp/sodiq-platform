import { databaseUrl, loadLocalEnvFile, migrationsDirectory } from './config.js';
import { migrate, MigrationError } from './migrate.js';

// Command line of `pnpm db:migrate`. It is compiled to `dist`, so a deploy can
// run the same file before the new version starts (task 0.10).
loadLocalEnvFile();

const command = process.argv[2];

if (command === 'migrate') {
  try {
    const applied = await migrate({
      connectionString: databaseUrl('DATABASE_MIGRATION_URL'),
      directory: migrationsDirectory,
      log: (line) => {
        console.log(line);
      },
    });
    console.log(
      applied.length === 0
        ? 'Nothing to apply: the database is up to date.'
        : `Applied ${String(applied.length)} migration(s).`,
    );
  } catch (error) {
    // A refused migration, a wrong password and a stopped server all end here.
    const known = error instanceof MigrationError;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(known ? reason : `Could not migrate: ${reason}`);
    process.exitCode = 1;
  }
} else {
  console.error('Usage: node dist/database/cli.js migrate');
  process.exitCode = 1;
}
