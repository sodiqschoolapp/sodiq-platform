import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

// Entry point of the API. The jobs worker gets its own entry point in task 0.5,
// and configuration loading replaces the direct read of PORT in task 0.4.
const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(Number(process.env.PORT ?? 3000));
