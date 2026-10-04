import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ApiExceptionFilter,
  errorFallback,
  notFoundFallback,
} from './http/api-exception.filter.js';
import { jsonOnlyMiddleware } from './http/json-only.js';
import { noStoreMiddleware } from './http/no-store.js';
import { requestIdMiddleware } from './http/request-id.js';
import { sameSiteMiddleware } from './http/same-site.js';
import { ResponseSchemaInterceptor } from './http/response-schema.interceptor.js';

/** Every route sits under this prefix, so the browser reaches web app and API on one origin. */
export const API_PREFIX = 'api';

/**
 * Settings shared by the running server, the tests and the OpenAPI command.
 * CORS is not turned on: web app and API share one origin, so no other site
 * gets permission to read an answer.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  // Answers do not name the framework that produced them.
  app.disable('x-powered-by');
  // Before the body parser, so that its refusals carry a request id too.
  app.use(requestIdMiddleware);
  app.use(noStoreMiddleware);
  // Before the body parser too: a request from another site is not even read.
  app.use(sameSiteMiddleware);
  // Nor is a body that is not JSON.
  app.use(jsonOnlyMiddleware);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseSchemaInterceptor());
}

/**
 * Configures and initialises the application. The two fallbacks must come
 * after every route, so they are added once NestJS has registered its own.
 */
export async function initApp(app: NestExpressApplication): Promise<void> {
  configureApp(app);
  await app.init();
  app.use(notFoundFallback);
  app.use(errorFallback);
}
