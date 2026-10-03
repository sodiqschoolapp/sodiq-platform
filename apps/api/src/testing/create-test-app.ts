import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { loadLocalEnvFile } from '../database/config.js';

/** The whole application, set up as in `main.ts`, without listening on a port. */
export async function createTestApp(): Promise<NestExpressApplication> {
  loadLocalEnvFile();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
