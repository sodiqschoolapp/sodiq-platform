import { SystemClock } from '../clock/system-clock.js';
import { ChromiumPdfRenderer } from '../http/pdf.js';
import { appendFile, readFile } from 'node:fs/promises';
import { compareCounts } from './backup-compare.js';
import { createRolesSql, rolesOfSchema } from './backup-roles.js';
import { BackupError, backupStore, markBackup, uploadBackup } from './backup.js';
import {
  createSnapshot,
  deleteSnapshot,
  NeonError,
  snapshotAddress,
  snapshotName,
} from './neon-snapshot.js';
import { pdfCheck, PdfCheckError } from './pdf-check.js';
import { checkRelease, ReleaseCheckError } from './release-check.js';
import { releaseWindowOpen, tashkentTime } from './release-window.js';
import { deployServices, DeployError } from './render.js';
import { smokeTest, SmokeError } from './smoke.js';

// Command line of the deploy jobs (.github/workflows/ci.yml, task 0.10;
// .github/workflows/deploy-production.yml, task 10.4; .github/workflows/backup.yml, task 10.2a):
//
//   node dist/deploy/cli.js deploy --commit <sha> <serviceId> [<serviceId> ...]
//     RENDER_API_KEY in the environment. Starts the deploys and waits.
//   node dist/deploy/cli.js smoke <url>
//     The checks against the address of the environment.
//   node dist/deploy/cli.js window
//     Fails outside the release window of production (release-window.ts).
//   node dist/deploy/cli.js release-check <sha>
//     GITHUB_TOKEN and GITHUB_REPOSITORY in the environment. Fails unless the
//     commit passed checks, e2e and deploy-test on main (release-check.ts).
//   node dist/deploy/cli.js pdf-check
//     Makes one PDF with the Chromium of this machine (pdf-check.ts); the job
//     `image` runs it inside the production image.
//   node dist/deploy/cli.js backup-snapshot
//     NEON_API_KEY, NEON_PROJECT_ID, BACKUP_DATABASE_URL, GITHUB_RUN_ID and GITHUB_ENV in the
//     environment. Makes the run's branch of production with a read-only compute, and hands the
//     next steps SNAPSHOT_URL (masked) and SNAPSHOT_BRANCH_ID (neon-snapshot.ts; task 10.2b).
//   node dist/deploy/cli.js backup-snapshot-delete
//     NEON_API_KEY, NEON_PROJECT_ID and SNAPSHOT_BRANCH_ID in the environment. Deletes it.
//   node dist/deploy/cli.js backup-upload <file>
//     BACKUP_R2_ACCOUNT_ID, BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY and
//     BACKUP_R2_BUCKET in the environment. Stores the day's dump (backup.ts; task 10.2a).
//   node dist/deploy/cli.js backup-mark
//     GRAFANA_METRICS_URL, GRAFANA_METRICS_USER and GRAFANA_TOKEN in the environment.
//     Tells Grafana the moment of the last proved and stored dump.
//   node dist/deploy/cli.js backup-roles < schema.sql
//     Prints the SQL that creates every role the schema of a dump names (backup-roles.ts).
//   node dist/deploy/cli.js backup-compare <production counts> <copy counts>
//     Fails unless the restored copy holds every table and migration (backup-compare.ts).
//
// Compiled with the API; the services never run it.

const [command, ...rest] = process.argv.slice(2);

function usage(): never {
  console.error(
    'Usage: node dist/deploy/cli.js deploy --commit <sha> <serviceId>... | smoke <url> | window | release-check <sha> | pdf-check | backup-snapshot | backup-snapshot-delete | backup-upload <file> | backup-mark | backup-roles | backup-compare <counts> <counts>',
  );
  process.exit(2);
}

/** The named variables of the environment, or a stop that names the missing ones. */
function required<Name extends string>(names: readonly Name[]): Record<Name, string> {
  const missing = names.filter((name) => (process.env[name] ?? '') === '');
  if (missing.length > 0) {
    console.error(`Not set: ${missing.join(', ')}.`);
    process.exit(2);
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name] ?? ''])) as Record<
    Name,
    string
  >;
}

try {
  if (command === 'deploy') {
    const commitIndex = rest.indexOf('--commit');
    const commitId = commitIndex === -1 ? undefined : rest[commitIndex + 1];
    const serviceIds = rest.filter(
      (_, index) => index !== commitIndex && index !== commitIndex + 1,
    );
    const apiKey = process.env.RENDER_API_KEY;
    if (commitId === undefined || serviceIds.length === 0) {
      usage();
    }
    if (apiKey === undefined || apiKey === '') {
      console.error('RENDER_API_KEY is not set.');
      process.exit(2);
    }
    const results = await deployServices({
      apiKey,
      serviceIds,
      commitId,
      log: (line) => {
        console.log(line);
      },
    });
    console.log(`Live: ${results.map((result) => result.serviceId).join(', ')} at ${commitId}.`);
  } else if (command === 'smoke') {
    const [url] = rest;
    if (url === undefined) {
      usage();
    }
    const results = await smokeTest(url);
    for (const result of results) {
      console.log(`ok: ${result.name}`);
    }
  } else if (command === 'window') {
    // The moment the owner's run starts, from the server's clock.
    const now = new SystemClock().now();
    if (!releaseWindowOpen(now)) {
      console.error(
        `It is ${tashkentTime(now)} in Tashkent: production is deployed only from 18:00 to 06:00 and at the weekend (docs/deploy.md, Production).`,
      );
      process.exit(1);
    }
    console.log(`Release window open: ${tashkentTime(now)} in Tashkent.`);
  } else if (command === 'release-check') {
    const [commitId] = rest;
    const token = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    if (commitId === undefined) {
      usage();
    }
    if (token === undefined || token === '' || repository === undefined || repository === '') {
      console.error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set.');
      process.exit(2);
    }
    const runId = await checkRelease({ token, repository, commitId });
    console.log(`${commitId} passed checks, e2e and deploy-test in CI run ${String(runId)}.`);
  } else if (command === 'pdf-check') {
    const renderer = new ChromiumPdfRenderer({
      chromiumPath: process.env.CHROMIUM_PATH || undefined,
    });
    try {
      const bytes = await pdfCheck(renderer);
      console.log(`A PDF of ${String(bytes)} bytes was made.`);
    } finally {
      await renderer.onModuleDestroy();
    }
  } else if (command === 'backup-snapshot') {
    const settings = required([
      'NEON_API_KEY',
      'NEON_PROJECT_ID',
      'BACKUP_DATABASE_URL',
      'GITHUB_RUN_ID',
      'GITHUB_ENV',
    ]);
    const log = (line: string) => {
      console.log(line);
    };
    const neon = { apiKey: settings.NEON_API_KEY, projectId: settings.NEON_PROJECT_ID, log };
    // The address is checked before any branch is made.
    snapshotAddress(settings.BACKUP_DATABASE_URL, 'snapshot.invalid');
    const snapshot = await createSnapshot(
      neon,
      snapshotName(new SystemClock().now(), settings.GITHUB_RUN_ID),
    );
    // The next steps read the address from the job's environment; GitHub hides it in the log.
    const address = snapshotAddress(settings.BACKUP_DATABASE_URL, snapshot.host);
    console.log(`::add-mask::${address}`);
    console.log(`::add-mask::${decodeURIComponent(new URL(address).password)}`);
    await appendFile(
      settings.GITHUB_ENV,
      `SNAPSHOT_BRANCH_ID=${snapshot.branchId}\nSNAPSHOT_URL=${address}\n`,
    );
  } else if (command === 'backup-snapshot-delete') {
    const settings = required(['NEON_API_KEY', 'NEON_PROJECT_ID', 'SNAPSHOT_BRANCH_ID']);
    await deleteSnapshot(
      {
        apiKey: settings.NEON_API_KEY,
        projectId: settings.NEON_PROJECT_ID,
        log: (line) => {
          console.log(line);
        },
      },
      settings.SNAPSHOT_BRANCH_ID,
    );
  } else if (command === 'backup-upload') {
    const [file] = rest;
    const settings = required([
      'BACKUP_R2_ACCOUNT_ID',
      'BACKUP_R2_ACCESS_KEY_ID',
      'BACKUP_R2_SECRET_ACCESS_KEY',
      'BACKUP_R2_BUCKET',
    ]);
    if (file === undefined) {
      usage();
    }
    const stored = await uploadBackup({
      store: backupStore({
        accountId: settings.BACKUP_R2_ACCOUNT_ID,
        accessKeyId: settings.BACKUP_R2_ACCESS_KEY_ID,
        secretAccessKey: settings.BACKUP_R2_SECRET_ACCESS_KEY,
      }),
      bucket: settings.BACKUP_R2_BUCKET,
      file,
      now: new SystemClock().now(),
    });
    console.log(`Stored ${stored.key}: ${String(stored.bytes)} bytes.`);
  } else if (command === 'backup-roles') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const roles = rolesOfSchema(Buffer.concat(chunks).toString('utf8'));
    console.log(createRolesSql(roles));
  } else if (command === 'backup-compare') {
    const [source, restored] = rest;
    if (source === undefined || restored === undefined) {
      usage();
    }
    const result = compareCounts(await readFile(source, 'utf8'), await readFile(restored, 'utf8'));
    for (const line of result.lines) console.log(line);
    if (result.failures.length > 0) {
      throw new BackupError(`The restored copy is not sound: ${result.failures.join('; ')}.`);
    }
    console.log(`The restored copy holds all ${String(result.lines.length)} tables.`);
  } else if (command === 'backup-mark') {
    const settings = required(['GRAFANA_METRICS_URL', 'GRAFANA_METRICS_USER', 'GRAFANA_TOKEN']);
    const now = new SystemClock().now();
    await markBackup({
      url: settings.GRAFANA_METRICS_URL,
      user: settings.GRAFANA_METRICS_USER,
      token: settings.GRAFANA_TOKEN,
      now,
    });
    console.log(`Grafana told: the backup of ${now.toISOString()}.`);
  } else {
    usage();
  }
} catch (error) {
  const known =
    error instanceof DeployError ||
    error instanceof SmokeError ||
    error instanceof ReleaseCheckError ||
    error instanceof PdfCheckError ||
    error instanceof BackupError ||
    error instanceof NeonError;
  console.error(
    known ? error.message : `Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
