import type { AddressInfo } from 'node:net';
import { databaseUrl, loadLocalEnvFile } from '../../database/config.js';
import { createDatabase } from '../../database/database.js';
import { createTestApp } from '../create-test-app.js';
import { withDatabaseName } from '../database-server.js';
import { FixedClock } from '../fixed-clock.js';

// Task 10.1c, decision B of 5 November 2026: the second API process of the speed run's load, so
// the load meets two processes, the shape of production (answer 15 of "Decided ahead for Phase
// 10"). The speed run (`speed.database.test.ts`) builds it (`tsconfig.speed.json`) and starts it
// with the database of the run and its clock: the same moment, running from the same real moment
// as the clock of the test process (plan decision 10: one clock, shared). It answers on a free
// local port, writes `{"port": n}` on its standard output, and stops on SIGTERM. Test code only:
// the application of `createTestApp`, as `attachedKit` builds it, never `main.ts`.

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set.`);
  return value;
};

loadLocalEnvFile();
const name = required('SPEED_SECOND_DATABASE');
const clock = new FixedClock(required('SPEED_SECOND_CLOCK'));
clock.runFrom(Number(required('SPEED_SECOND_REAL_START')));
const appUrl = withDatabaseName(databaseUrl('DATABASE_URL'), name);
const app = await createTestApp({
  database: createDatabase(appUrl),
  clock,
  jobsDatabaseUrl: appUrl,
});
await app.listen(0, '127.0.0.1');
const address = app.getHttpServer().address() as AddressInfo;
process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
process.once('SIGTERM', () => {
  void app.close().then(() => process.exit(0));
});
