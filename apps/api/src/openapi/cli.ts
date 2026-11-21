import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { loadLocalEnvFile, repositoryRoot } from '../database/config.js';
import { buildOpenApiDocument, serializeOpenApiDocument } from './build-document.js';
import {
  INTEGRATION_GUIDE,
  renderKeyOperations,
  withKeyOperations,
  type GuideDocument,
} from './integration-guide.js';
import {
  ASSISTANT_TOOLS_FILE,
  renderAssistantTools,
  type ToolsDocument,
} from './assistant-tools.js';

// First half of `pnpm api:client`: writes the OpenAPI document of the routes,
// and the operations open to integration keys into the integration guide.
// The application is built but never listens, and no query is sent: the
// database pool connects only on its first query.
loadLocalEnvFile();

// src/openapi and dist/openapi are both two levels below apps/api.
const file = path.resolve(import.meta.dirname, '../../openapi.generated.json');

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: ['error', 'warn'],
});
configureApp(app);
const text = serializeOpenApiDocument(buildOpenApiDocument(app));
writeFileSync(file, text);
await app.close();
console.log(`Wrote ${file}`);

// The guide is written from the text just written, as its test reads it.
const guide = path.join(repositoryRoot, INTEGRATION_GUIDE);
const operations = renderKeyOperations(JSON.parse(text) as GuideDocument);
writeFileSync(guide, withKeyOperations(readFileSync(guide, 'utf8'), operations));
console.log(`Wrote ${guide}`);

// Task 11.12: the assistant's tools, from the same text.
const tools = path.resolve(import.meta.dirname, '../..', ASSISTANT_TOOLS_FILE);
writeFileSync(tools, renderAssistantTools(JSON.parse(text) as ToolsDocument));
console.log(`Wrote ${tools}`);
