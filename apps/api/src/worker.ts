import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config/config.js';
import { loadLocalEnvFile } from './database/config.js';
import { JobRunner } from './jobs/job-runner.js';
import { SecondStepKeyCheck } from './modules/auth/second-step-key-check.js';
import { startReporting } from './reporting/reporting.js';
import { WorkerModule } from './worker.module.js';

// Entry point of the jobs worker: no HTTP, only the queue.
loadLocalEnvFile();
// The error reports first, so that a fault of the start is reported too (task 0.10).
startReporting(loadConfig(process.env).reporting);
const app = await NestFactory.createApplicationContext(WorkerModule);
// On a stop signal a running job gets time to finish (JobQueue).
app.enableShutdownHooks();
// The same check as in the API: no job runs with a key that does not open the stored second steps.
await app.get(SecondStepKeyCheck).run();
await app.get(JobRunner).start();
new Logger('Jobs').log('The jobs worker is running.');
