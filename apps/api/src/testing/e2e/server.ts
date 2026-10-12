import { rm } from 'node:fs/promises';
import { rebuildE2eDatabase } from './database.js';
import { E2E_MAIL_OUTBOX } from './mail.js';

// The API of the browser tests: Playwright starts it (apps/web/playwright.config.ts).
// It is the API as it runs (src/main.ts), on a port of its own and on the
// database `sodiq_e2e`, which is built again first. The jobs worker
// (src/worker.ts) runs in the same process, so a notification sent during a
// test is delivered and arrives live (task 0.9).
const { appUrl } = await rebuildE2eDatabase();
// Variables that are set win over the `.env` that main.ts loads.
process.env.DATABASE_URL = appUrl;
process.env.PORT = process.env.E2E_API_PORT ?? '3001';
// Photos in memory (task 2.2c-2, decision 9): the browser tests never reach R2.
process.env.PHOTOS_IN_MEMORY = '1';
// The mail of a reset is written to a fresh outbox, and its link names the web
// server of the tests (task 2.3c-2, decisions 14 and 15 of pull request #66).
await rm(E2E_MAIL_OUTBOX, { recursive: true, force: true });
process.env.MAIL_OUTBOX_DIR = E2E_MAIL_OUTBOX;
process.env.WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5174';
await import('../../main.js');
await import('../../worker.js');
