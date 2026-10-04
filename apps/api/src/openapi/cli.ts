import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { loadLocalEnvFile } from '../database/config.js';
import { buildOpenApiDocument, serializeOpenApiDocument } from './build-document.js';

// First half of `pnpm api:client`: writes the OpenAPI document of the routes.
// The application is built but never listens, and no query is sent: the
// database pool connects only on its first query.
loadLocalEnvFile();

// src/openapi and dist/openapi are both two levels below apps/api.
const file = path.resolve(import.meta.dirname, '../../openapi.generated.json');

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: ['error', 'warn'],
});
configureApp(app);
writeFileSync(file, serializeOpenApiDocument(buildOpenApiDocument(app)));
await app.close();
console.log(`Wrote ${file}`);
