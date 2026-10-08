import { rebuildE2eDatabase } from './database.js';

// The API of the browser tests: Playwright starts it (apps/web/playwright.config.ts).
// It is the API as it runs (src/main.ts), on a port of its own and on the
// database `sodiq_e2e`, which is built again first. The jobs worker
// (src/worker.ts) runs in the same process, so a notification sent during a
// test is delivered and arrives live (task 0.9).
const { appUrl } = await rebuildE2eDatabase();
// Variables that are set win over the `.env` that main.ts loads.
process.env.DATABASE_URL = appUrl;
process.env.PORT = process.env.E2E_API_PORT ?? '3001';
await import('../../main.js');
await import('../../worker.js');
