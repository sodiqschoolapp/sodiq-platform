import { RequestMethod, type INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '../app.setup.js';
import { RESPONSE_SCHEMA } from '../http/response-schema.interceptor.js';
import { declarationsOf, type RouteAccess } from '../modules/access/access.decorators.js';
import { owedStepsAllowedOn } from '../modules/auth/session.guard.js';

export interface Route {
  /** Method and path, for example `GET /api/auth/session`. */
  name: string;
  method: string;
  path: string;
  /** Everything the handler declares about who may call it; a sound route has exactly one entry. */
  access: RouteAccess[];
  /** The owed steps of sign-in the handler may be reached with (`@AllowedBefore...`). */
  allowedBefore: string[];
  /** Whether the handler says what it answers: `@Returns(schema)` or `@ReturnsNothing()`. */
  describesAnswer: boolean;
}

// Under these keys NestJS keeps the path, the method and the status of a controller and a handler.
const PATH = 'path';
const METHOD = 'method';
const HTTP_CODE = '__httpCode__';

/**
 * The names of the methods of a controller, with those of the classes it
 * extends: NestJS makes a route of an inherited handler too (found by the review).
 */
function methodNames(prototype: object): Set<string> {
  const names = new Set<string>();
  for (
    let current: object | null = prototype;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(current)) {
      names.add(name);
    }
  }
  return names;
}

/** Every route of the application as it runs, read from its controllers. */
export function routesOf(app: INestApplication): Route[] {
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
      for (const name of methodNames(type.prototype as object)) {
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
              method: RequestMethod[method],
              path: `/${full}`,
              access: declarationsOf(handler),
              allowedBefore: owedStepsAllowedOn(handler),
              describesAnswer:
                Reflect.getMetadata(RESPONSE_SCHEMA, handler) !== undefined ||
                Reflect.getMetadata(HTTP_CODE, handler) === 204,
            });
          }
        }
      }
    }
  }
  return routes.sort((a, b) => a.name.localeCompare(b.name));
}

interface RouterLayer {
  route?: { path: unknown; methods: Record<string, boolean | undefined> };
}

/**
 * Every route the Express router itself answers, whoever registered it. What
 * is here and not in `routesOf` is not a handler of a controller, so no guard
 * stands in front of it.
 */
export function expressRoutesOf(app: NestExpressApplication): string[] {
  const express = app.getHttpAdapter().getInstance() as { router?: { stack?: RouterLayer[] } };
  const stack = express.router?.stack;
  if (stack === undefined) {
    throw new Error('The Express router of the application was not found.');
  }
  const names: string[] = [];
  for (const layer of stack) {
    if (layer.route === undefined) {
      continue;
    }
    for (const [method, on] of Object.entries(layer.route.methods)) {
      if (on === true) {
        names.push(`${method.toUpperCase()} ${String(layer.route.path)}`);
      }
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}
