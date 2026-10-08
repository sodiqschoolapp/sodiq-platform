import { NestFactory } from '@nestjs/core';
import { DATABASE } from '../../database/database.module.js';
import type { Database } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { Notifications } from '../../modules/notifications/notifications.service.js';
import { WorkerModule } from '../../worker.module.js';
import { e2eDatabaseUrls } from './database.js';

// Run by a browser test while the API of the tests is up: sends a sample
// notification to the account of a login, in `sodiq_e2e` only. The worker
// inside that API delivers it, so the test sees it arrive live (task 0.9).
//
//   node dist-e2e/testing/e2e/notify.js <login> <text>

const [login, text] = process.argv.slice(2);
if (login === undefined || text === undefined || text === '') {
  console.error('Usage: notify.js <login> <text>');
  process.exit(2);
}

process.env.DATABASE_URL = e2eDatabaseUrls().appUrl;

// The worker's modules: no HTTP, and the job queue of the application user.
const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
try {
  const database = app.get<Database>(DATABASE);
  const account = await database
    .selectFrom('accounts')
    .select('id')
    .where('login', '=', login)
    .executeTakeFirst();
  if (account === undefined) {
    console.error('There is no account with that login.');
    process.exit(1);
  }
  const ids = await app.get(Transactions).run([], (transaction) =>
    app.get(Notifications).send(transaction, {
      kind: 'sample.message',
      data: { text },
      branchId: null,
      accountIds: [account.id],
    }),
  );
  console.log(JSON.stringify({ ids }));
} finally {
  await app.close();
}
