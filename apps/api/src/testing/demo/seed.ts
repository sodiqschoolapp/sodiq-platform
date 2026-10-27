import { appendFile } from 'node:fs/promises';
import { databaseUrl, loadLocalEnvFile } from '../../database/config.js';
import { createDatabase } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { TwoStep } from '../../modules/auth/two-step.service.js';
import { createTestApp } from '../create-test-app.js';
import { FixedClock } from '../fixed-clock.js';
import { BRANCHES, SETUP_MOMENT } from './data.js';
import { fillJournals } from './journal.js';
import type { DemoAccount } from './people.js';
import { buildDemoSchool } from './school.js';

/**
 * The demo data of the test environment (asked for by the owner on 27
 * October 2026: "full mock data so that I can test every feature live").
 * Builds an invented school through the real application, with its clock set
 * to each moment a person would have acted: the setup in the week before the
 * year, the plans before the quarter, then every school day's attendance and
 * marks up to yesterday. It writes only to a database on this machine: on a
 * laptop `sodiq_dev` (`pnpm demo:seed`), in `.github/workflows/demo-data.yml`
 * the job's own PostgreSQL, whose dump then replaces the test database
 * (`docs/deploy.md`, Demo data). It refuses a database that holds the demo
 * already.
 */

loadLocalEnvFile();
const appUrl = databaseUrl('DATABASE_URL');
const migrationUrl = databaseUrl('DATABASE_MIGRATION_URL');
const password = process.env.DEMO_PASSWORD ?? '';
const local = [appUrl, migrationUrl].every((url) => {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
});
if (!local) {
  throw new Error('The demo seed writes to a database on this machine only. Nothing was written.');
}
if (password.length < 10) {
  throw new Error('Set DEMO_PASSWORD (10 characters or more): every demo account gets it.');
}

// Today in Tashkent; the journals are entered up to the day before.
const today =
  process.env.DEMO_TODAY ?? new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || today < '2026-09-03' || today > '2027-05-25') {
  throw new Error(`Today (${today}) is not in the demo's school year. Nothing was written.`);
}

const lines: string[] = [];
const say = (line: string) => {
  lines.push(line);
  console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
};

const migrator = createDatabase(migrationUrl);
const existing = await migrator
  .selectFrom('branches')
  .select('name')
  .where(
    'name',
    'in',
    BRANCHES.map((one) => one.name),
  )
  .execute();
if (existing.length > 0) {
  await migrator.destroy();
  throw new Error(
    `The database holds the demo already (${existing.map((one) => one.name).join(', ')}). Nothing was written.`,
  );
}

const clock = new FixedClock(SETUP_MOMENT);
const app = await createTestApp({
  database: createDatabase(appUrl),
  clock,
  jobsDatabaseUrl: appUrl,
});
const strict: DemoAccount[] = [];
try {
  const school = await buildDemoSchool({ app, migrator, clock, password, say });
  strict.push(school.superAdmin, ...school.branches.map((branch) => branch.vice));
  await fillJournals({ app, migrator, clock, school, password, today, say });

  // The second steps the seed set up are removed, so that the owner sets up
  // their own authenticator at the first sign-in of these accounts.
  const others = school.branches[0]?.principal.accountId ?? school.superAdmin.accountId;
  for (const account of strict) {
    await app.get(Transactions).run([], (transaction) =>
      app.get(TwoStep).resetByAdministrator(transaction, {
        accountId: account.accountId,
        resetBy: account.accountId === others ? school.superAdmin.accountId : others,
      }),
    );
  }

  const summary = [
    '## Demo data',
    '',
    'Every account below signs in with the demo password given to the run. The Super Admin and the Academic Vice Principals set up the second step (an authenticator app) at their first sign-in.',
    '',
    '| Role | Branch | Name | Login |',
    '| --- | --- | --- | --- |',
    `| Super Admin | all | ${school.superAdmin.name} | \`${school.superAdmin.login}\` |`,
    `| Senior Head Teacher | all | ${school.seniorHeadTeacher.name} | \`${school.seniorHeadTeacher.login}\` |`,
    ...school.branches.flatMap((branch) => [
      `| Principal | ${branch.name} | ${branch.principal.name} | \`${branch.principal.login}\` |`,
      `| Academic Vice Principal | ${branch.name} | ${branch.vice.name} | \`${branch.vice.login}\` |`,
      ...branch.others.map(
        (one) =>
          `| ${one.role.replaceAll('_', ' ')} | ${branch.name} | ${one.account.name} | \`${one.account.login}\` |`,
      ),
      ...[...branch.teachers.values()]
        .filter((one) => branch.classes.some((it) => it.tutorStaffId === one.staffId))
        .map((one) => {
          const tutorOf = branch.classes.filter((it) => it.tutorStaffId === one.staffId);
          return `| Teacher and Tutor of ${tutorOf.map((it) => `${String(it.grade)} ${it.name}`).join(', ')} | ${branch.name} | ${one.account.name} (${one.subjects.join(', ')}) | \`${one.account.login}\` |`;
        }),
      ...[...branch.teachers.values()]
        .filter((one) => !branch.classes.some((it) => it.tutorStaffId === one.staffId))
        .map(
          (one) =>
            `| Teacher | ${branch.name} | ${one.account.name} (${one.subjects.join(', ')}) | \`${one.account.login}\` |`,
        ),
    ]),
    '',
    '### What the run did',
    '',
    ...lines.map((line) => `- ${line}`),
    '',
  ].join('\n');
  console.log(summary);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file !== undefined && file !== '') await appendFile(file, summary);
} finally {
  await app.close();
  await migrator.destroy();
}
