import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../database/database.js';
import { insertBranch } from '../testing/branch-filter-sql.js';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { NEW_PASSWORD, signInKit } from '../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import {
  MONITORING_BRANCH_USAGE,
  parseMonitoringBranchArguments,
  runMonitoringBranchCommand,
} from './monitoring-branch.command.js';

describe('the arguments of the monitoring-branch command', () => {
  it('reads the subject, the last day and an optional first day', () => {
    expect(
      parseMonitoringBranchArguments([
        'monitoring-branch',
        '--',
        '--subject',
        ' Mathematics ',
        '--year-end',
        '2027-08-31',
      ]),
    ).toEqual({ subject: 'Mathematics', yearEnd: '2027-08-31', yearStart: null });
    expect(
      parseMonitoringBranchArguments([
        'monitoring-branch',
        '--subject',
        'Mathematics',
        '--year-end',
        '2027-08-31',
        '--year-start',
        '2026-11-02',
      ]),
    ).toEqual({ subject: 'Mathematics', yearEnd: '2027-08-31', yearStart: '2026-11-02' });
  });

  it.each([
    [['monitoring-branch', '--subject', 'Mathematics']],
    [['monitoring-branch', '--year-end', '2027-08-31']],
    [['monitoring-branch', '--subject', '', '--year-end', '2027-08-31']],
    [['monitoring-branch', '--subject', 'Mathematics', '--year-end', '31.08.2027']],
    [['other', '--subject', 'Mathematics', '--year-end', '2027-08-31']],
    [['monitoring-branch', '--subject', 'Mathematics', '--year-end', '2027-08-31', '--force']],
  ])('refuses %j', (argv) => {
    expect(parseMonitoringBranchArguments(argv)).toBeUndefined();
  });
});

// Task 10.2b (docs/monitoring.md, step 9): the owner's command, its prompts and what it prints.
describe('the monitoring-branch command', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  const clock = new FixedClock('2026-10-28T16:00:00+05:00');
  let login: string;
  let secret: Buffer;
  let codeOf: (secret: Buffer) => string;

  /** The app of a run, with its own pool: the command closes what it opens. */
  const open = async () => {
    app = await createTestApp({
      database: createDatabase(database.appUrl),
      clock,
      jobsDatabaseUrl: database.appUrl,
    });
    return app;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    await insertBranch(database.migrator, 'North');
    const steam = await database.migrator
      .selectFrom('departments')
      .select('id')
      .where('name_en', '=', 'STEAM')
      .executeTakeFirstOrThrow();
    await database.migrator
      .insertInto('subjects')
      .values({
        name_uz: 'Matematika',
        name_ru: 'Математика',
        name_en: 'Mathematics',
        department_id: steam.id,
        grades: [7],
        colour: 'blue',
        journal_type: 'graded',
      })
      .execute();
    const setUp = await createTestApp({ database: createDatabase(database.appUrl), clock });
    const kit = signInKit(setUp, { newAccountsHold: { role: 'super_admin' } });
    const admin = await kit.completeSession('Owner', 'Sodiq');
    login = admin.account.login;
    secret = admin.secret;
    codeOf = (one) => kit.codeOf(one, 1);
    await setUp.close();
  });

  afterAll(async () => {
    await database.destroy();
  });

  const run = async (argv: string[]) => {
    const out: string[] = [];
    const errors: string[] = [];
    const asked: { question: string; hidden: boolean }[] = [];
    const answers = [login, NEW_PASSWORD, codeOf(secret)];
    const code = await runMonitoringBranchCommand(
      argv,
      {
        out: (line) => out.push(line),
        error: (line) => errors.push(line),
        ask: (question, hidden) => {
          asked.push({ question, hidden });
          return Promise.resolve(answers.shift() ?? '');
        },
      },
      open,
    );
    return { code, out, errors, asked };
  };

  it('prints the usage for a wrong line and opens nothing', async () => {
    const result = await run(['monitoring-branch']);
    expect(result).toMatchObject({ code: 1, errors: [MONITORING_BRANCH_USAGE], asked: [] });
  });

  it('refuses a year that starts today, before asking anything', async () => {
    const result = await run([
      'monitoring-branch',
      '--subject',
      'Mathematics',
      '--year-end',
      '2027-08-31',
      '--year-start',
      '2026-10-28',
    ]);
    expect(result.code).toBe(1);
    expect(result.errors[0]).toContain('2026-10-29');
    expect(result.asked).toEqual([]);
  });

  it('asks for the login, then the password and the code hidden, builds the branch and prints the teacher once', async () => {
    const result = await run([
      'monitoring-branch',
      '--subject',
      'Mathematics',
      '--year-end',
      '2027-08-31',
    ]);
    expect(result.errors).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.asked.map((one) => one.hidden)).toEqual([false, true, true]);
    const printed = result.out.join('\n');
    expect(printed).toContain('Test teacher login: ');
    expect(result.out.filter((line) => line.startsWith('First password: '))).toHaveLength(1);
    // What the owner typed is never printed.
    expect(printed).not.toContain(NEW_PASSWORD);
    const marked = await database.migrator
      .selectFrom('branches')
      .select('id')
      .where('purpose', '=', 'monitoring')
      .execute();
    expect(marked).toHaveLength(1);
  }, 120_000);

  it('refuses a second run', async () => {
    const result = await run([
      'monitoring-branch',
      '--subject',
      'Mathematics',
      '--year-end',
      '2027-08-31',
    ]);
    expect(result.code).toBe(1);
    expect(result.errors[0]).toContain('exists already');
    expect(result.asked).toEqual([]);
  });
});
