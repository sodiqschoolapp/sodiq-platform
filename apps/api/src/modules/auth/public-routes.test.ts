import { RequestMethod, type INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../app.setup.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { PUBLIC_ROUTE } from './session.guard.js';

/**
 * docs/spec/02-roles-and-access.md, "Accounts and sign-in: build order": a short
 * list of routes works without sign-in; each is declared public in code, and a
 * test holds the exact list. This is the list, each route with its reason. A
 * new public route is a decision for the owner and fails here until it is added.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'GET /api/health': 'Uptime monitoring and the deploy smoke test call it without a session.',
  'POST /api/auth/sign-in': 'Sign-in cannot require a session.',
};

interface Route {
  name: string;
  public: boolean;
}

// Under these keys NestJS keeps the path and the method of a controller and a handler.
const PATH = 'path';
const METHOD = 'method';

/** Every route of the application as it runs, read from its controllers. */
function routesOf(app: INestApplication): Route[] {
  const routes: Route[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const controller of module.controllers.values()) {
      const type = controller.metatype;
      if (typeof type !== 'function') {
        continue;
      }
      const prototype = type.prototype as Record<string, unknown>;
      const prefixes = [Reflect.getMetadata(PATH, type) as string | string[] | undefined]
        .flat()
        .map((prefix) => prefix ?? '');
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') {
          continue;
        }
        const method = Reflect.getMetadata(METHOD, handler) as RequestMethod | undefined;
        if (method === undefined) {
          continue;
        }
        const paths = [Reflect.getMetadata(PATH, handler) as string | string[] | undefined]
          .flat()
          .map((path) => path ?? '');
        for (const prefix of prefixes) {
          for (const path of paths) {
            const full = [API_PREFIX, prefix, path]
              .map((part) => part.replace(/^\/+|\/+$/g, ''))
              .filter((part) => part !== '')
              .join('/');
            routes.push({
              name: `${RequestMethod[method]} /${full}`,
              public: Reflect.getMetadata(PUBLIC_ROUTE, handler) === true,
            });
          }
        }
      }
    }
  }
  return routes.sort((a, b) => a.name.localeCompare(b.name));
}

describe('the routes that work without sign-in', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The application as `main.ts` builds it: no test-only controller.
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('are exactly the listed ones', () => {
    const open = routesOf(app)
      .filter((route) => route.public)
      .map((route) => route.name);

    expect(open).toEqual(Object.keys(PUBLIC_ROUTES).sort());
  });

  it('each have a reason', () => {
    for (const reason of Object.values(PUBLIC_ROUTES)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  // The check above is only worth something if it sees every route.
  it('are found among all routes of the application', () => {
    expect(routesOf(app).map((route) => route.name)).toEqual([
      'GET /api/auth/session',
      'GET /api/health',
      'POST /api/auth/password',
      'POST /api/auth/sign-in',
      'POST /api/auth/sign-out',
    ]);
  });
});
