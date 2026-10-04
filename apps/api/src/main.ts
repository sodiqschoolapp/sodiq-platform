import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { initApp } from './app.setup.js';
import { CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/config.js';
import { loadLocalEnvFile } from './database/config.js';
import { JobQueue } from './jobs/job-queue.js';
import { SecondStepKeyCheck } from './modules/auth/second-step-key-check.js';

// Entry point of the API. The jobs worker has its own: src/worker.ts.
loadLocalEnvFile();
const app = await NestFactory.create<NestExpressApplication>(AppModule);
await initApp(app);
// Now, not with the first job: a missing or older job schema stops the start.
await app.get(JobQueue).ready();
// A key that does not open the stored second steps stops the start too.
await app.get(SecondStepKeyCheck).run();
const config = app.get<AppConfig>(CONFIG);
await app.listen(config.port, config.host);
