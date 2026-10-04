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

  console.log(JSON.stringify(seeded));
} finally {
  await app.close();
  await migrator.destroy();
}
