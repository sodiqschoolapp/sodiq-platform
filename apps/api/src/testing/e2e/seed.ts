import { NestFactory } from '@nestjs/core';
import { createDatabase } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { Assignments } from '../../modules/access/assignments.service.js';
import { Accounts } from '../../modules/auth/accounts.service.js';
import { FirstAccountModule } from '../../modules/auth/first-account.command.js';
import { insertBranch } from '../branch-filter-sql.js';
import { e2eDatabaseUrls } from './database.js';

// Run by Playwright's global setup after the API of the browser tests has
// started: creates the accounts the tests sign in with, in `sodiq_e2e` only,
// and prints them as one line of JSON. No route creates an account before
// task 2.3. Every name is invented.

/** An account without a role per test: a first password and no required second step. */
const WITHOUT_ROLE = {
  uz: ['Dilnoza', 'Rahimova'],
  ru: ['Timur', 'Aliev'],
  en: ['Kamila', 'Yusupova'],
  wrongPassword: ['Bobur', 'Karimov'],
  trust: ['Zarina', 'Tursunova'],
  patterns: ['Malika', 'Sobirova'],
  forms: ['Sardor', 'Nazarov'],
  shellTools: ['Nilufar', 'Qodirova'],
  account: ['Gulnoza', 'Mirzayeva'],
  accountSecondStep: ['Otabek', 'Rashidov'],
  notifications: ['Sabina', 'Toshmatova'],
} as const;

type Credentials = { login: string; password: string };

const urls = e2eDatabaseUrls();
process.env.DATABASE_URL = urls.appUrl;

const migrator = createDatabase(urls.migrationUrl);
const app = await NestFactory.createApplicationContext(FirstAccountModule, { logger: ['error'] });
try {
  const transactions = app.get(Transactions, { strict: false });
  const accounts = app.get(Accounts, { strict: false });
  const assignments = app.get(Assignments, { strict: false });

  const create = async (firstName: string, lastName: string) =>
    transactions.run([], (transaction) =>
      accounts.create(transaction, { firstName, lastName, createdBy: null }),
    );

  const seeded: Record<string, Credentials> = {};
  for (const [key, [firstName, lastName]] of Object.entries(WITHOUT_ROLE)) {
    const account = await create(firstName, lastName);
    seeded[key] = { login: account.login, password: account.firstPassword };
  }

  // The second step is required for the Academic Vice Principal of a branch.
  const branchId = await insertBranch(migrator, 'Browser test branch');
  const vicePrincipal = await create('Sardor', 'Nazarov');
  await transactions.run([branchId], (transaction) =>
    assignments.give(transaction, {
      accountId: vicePrincipal.id,
      role: 'academic_vice_principal',
      branchId,
      givenBy: null,
    }),
  );
  seeded.vicePrincipal = { login: vicePrincipal.login, password: vicePrincipal.firstPassword };

  // The Super Admin of the setup tests (task 1.1): the role only; the test
  // sets up the required second step itself, as the Academic Vice Principal's does.
  const superAdmin = await create('Nodira', 'Ergasheva');
  await transactions.run([], (transaction) =>
    assignments.give(transaction, {
      accountId: superAdmin.id,
      role: 'super_admin',
      branchId: null,
      givenBy: null,
    }),
  );
  seeded.superAdmin = { login: superAdmin.login, password: superAdmin.firstPassword };

  // The Super Admin of the divisions test (task 1.2): the same, one account per test.
  const divisions = await create('Gulnora', 'Yusupova');
  await transactions.run([], (transaction) =>
    assignments.give(transaction, {
      accountId: divisions.id,
      role: 'super_admin',
      branchId: null,
      givenBy: null,
    }),
  );
  seeded.divisions = { login: divisions.login, password: divisions.firstPassword };

  // The Super Admin of the academic years test (task 1.3), with a branch of
  // its own, so that its years and its top bar meet no other test's.
  await insertBranch(migrator, 'Years browser test branch');
  const years = await create('Shahlo', 'Nurmatova');
  await transactions.run([], (transaction) =>
    assignments.give(transaction, {
      accountId: years.id,
      role: 'super_admin',
      branchId: null,
      givenBy: null,
    }),
  );
  seeded.years = { login: years.login, password: years.firstPassword };

  // The Academic Vice Principal of the day templates test (task 1.5), in a
  // branch of its own, so that its slot types and templates meet no other test's.
  const templatesBranch = await insertBranch(migrator, 'Templates browser test branch');
  const templates = await create('Malika', 'Tursunova');
  await transactions.run([templatesBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: templates.id,
      role: 'academic_vice_principal',
      branchId: templatesBranch,
      givenBy: null,
    }),
  );
  seeded.templates = { login: templates.login, password: templates.firstPassword };

  // A Tutor in one branch and a Teacher in two: the role and branch switchers.
  const second = await insertBranch(migrator, 'Second browser test branch');
  const switchers = await create('Jamshid', 'Ismoilov');
  for (const held of [
    { role: 'tutor', branchId },
    { role: 'teacher', branchId },
    { role: 'teacher', branchId: second },
  ] as const) {
    await transactions.run([held.branchId], (transaction) =>
      assignments.give(transaction, { accountId: switchers.id, ...held, givenBy: null }),
    );
  }
  seeded.switchers = { login: switchers.login, password: switchers.firstPassword };

  console.log(JSON.stringify(seeded));
} finally {
  await app.close();
  await migrator.destroy();
}
