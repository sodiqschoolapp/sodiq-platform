import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { initApp } from './app.setup.js';
import { CONFIG } from './config/config.module.js';
import { loadConfig, type AppConfig } from './config/config.js';
import { loadLocalEnvFile } from './database/config.js';
import { JobQueue } from './jobs/job-queue.js';
import { SecondStepKeyCheck } from './modules/auth/second-step-key-check.js';
import { LiveListener } from './modules/notifications/live/listener.js';
import { LiveSockets } from './modules/notifications/live/socket-server.js';
import { startReporting } from './reporting/reporting.js';

// Entry point of the API. The jobs worker has its own: src/worker.ts.
loadLocalEnvFile();
// The error reports first, so that a fault of the start is reported too (task 0.10).
startReporting(loadConfig(process.env).reporting);
const app = await NestFactory.create<NestExpressApplication>(AppModule);
await initApp(app);
// On a stop signal (a release on Render) the connections close in order and
// a running job gets time to finish; the reports leave last.
app.enableShutdownHooks();
// The live connection of the tabs, on the same server, before it listens (task 0.9).
app.get(LiveSockets).attach(app.getHttpServer());
// Now, not with the first job: a missing or older job schema stops the start.
await app.get(JobQueue).ready();
// A key that does not open the stored second steps stops the start too.
await app.get(SecondStepKeyCheck).run();
// What the worker and the routes push to the tabs comes over the database.
await app.get(LiveListener).start();
const config = app.get<AppConfig>(CONFIG);
await app.listen(config.port, config.host);
