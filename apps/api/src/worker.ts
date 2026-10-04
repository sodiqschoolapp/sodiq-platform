import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadLocalEnvFile } from './database/config.js';
import { JobRunner } from './jobs/job-runner.js';
import { WorkerModule } from './worker.module.js';

// Entry point of the jobs worker: no HTTP, only the queue.
loadLocalEnvFile();
const app = await NestFactory.createApplicationContext(WorkerModule);
// On a stop signal a running job gets time to finish (JobQueue).
app.enableShutdownHooks();
await app.get(JobRunner).start();
new Logger('Jobs').log('The jobs worker is running.');
