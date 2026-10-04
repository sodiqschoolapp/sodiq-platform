import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { initApp } from './app.setup.js';
import { CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/config.js';
import { loadLocalEnvFile } from './database/config.js';

// Entry point of the API. The jobs worker gets its own entry point in task 0.5.
loadLocalEnvFile();
const app = await NestFactory.create<NestExpressApplication>(AppModule);
await initApp(app);
const config = app.get<AppConfig>(CONFIG);
await app.listen(config.port, config.host);
