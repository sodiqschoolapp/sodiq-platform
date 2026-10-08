import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { DATABASE } from '../../database/database.module.js';
import type { Database } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { Notifications } from '../../modules/notifications/notifications.service.js';
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

// The modules of the API as a context: no HTTP, and a job queue that only
// sends (the worker's would start pg-boss's upkeep for one call).
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
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
