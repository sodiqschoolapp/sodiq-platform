import type { NestExpressApplication } from '@nestjs/platform-express';

/** Every route sits under this prefix, so the browser reaches web app and API on one origin. */
export const API_PREFIX = 'api';

/** Settings shared by the running server and the tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  // Answers do not name the framework that produced them.
  app.disable('x-powered-by');
}
