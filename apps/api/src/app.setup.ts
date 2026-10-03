import type { INestApplication } from '@nestjs/common';

/** Every route sits under this prefix, so the browser reaches web app and API on one origin. */
export const API_PREFIX = 'api';

/** Settings shared by the running server and the tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
}
