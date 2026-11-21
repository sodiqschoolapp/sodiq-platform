import { Inject, Injectable, RequestMethod, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ASSISTANT_ROLES, type AssistantRole } from '@sodiq/shared';
import { API_PREFIX } from '../../app.setup.js';
import { declarationsOf } from './access.decorators.js';
import {
  ASSISTANT_ROUTE_LISTS,
  assistantRouteFault,
  type AssistantRouteLists,
} from './assistant-routes.js';

// Under these keys NestJS keeps the path and the method of a controller and a handler.
const PATH = 'path';
const METHOD = 'method';

/** `<METHOD> /api/<path>` of a handler, as Express registers it (one per path it is mounted on). */
function routeNamesOf(controller: object, handler: object): string[] {
  const method = Reflect.getMetadata(METHOD, handler) as RequestMethod | undefined;
  if (method === undefined) {
    return [];
  }
  const prefixes = [Reflect.getMetadata(PATH, controller) as string | string[] | undefined]
    .flat()
    .map((prefix) => prefix ?? '');
  const paths = [Reflect.getMetadata(PATH, handler) as string | string[] | undefined]
    .flat()
    .map((path) => path ?? '');
  return prefixes.flatMap((prefix) =>
    paths.map((path) => {
      const full = [API_PREFIX, prefix, path]
        .map((part) => part.replace(/^\/+|\/+$/g, ''))
        .filter((part) => part !== '')
        .join('/');
      return `${RequestMethod[method]} /${full}`;
    }),
  );
}

/**
 * The actions open to the assistant, by handler (task 11.12; `02`, Assistant: "a list fixed in
 * code for each of the three roles"). Built once at the start from `ASSISTANT_ROUTES`: the app
 * does not start with a listed route that does not exist or that `assistantRouteFault` refuses
 * (an export, a never-route, a change in 11.12). `PermissionGuard` asks it on each request
 * marked as the assistant's.
 */
@Injectable()
export class AssistantRoutes implements OnApplicationBootstrap {
  private readonly roles = new WeakMap<object, ReadonlySet<AssistantRole>>();
  private readonly names = new WeakMap<object, string>();
  private ready = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    @Inject(ASSISTANT_ROUTE_LISTS) private readonly lists: AssistantRouteLists,
  ) {}

  private listOf(role: AssistantRole): Readonly<Record<string, unknown>> {
    return this.lists[role] ?? {};
  }

  onApplicationBootstrap(): void {
    const faults: string[] = [];
    const found = new Set<string>();
    for (const wrapper of this.discovery.getControllers()) {
      const instance: unknown = wrapper.instance;
      const type: unknown = wrapper.metatype;
      if (instance === null || typeof instance !== 'object' || typeof type !== 'function') {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const method of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[method];
        if (typeof handler !== 'function') {
          continue;
        }
        for (const name of routeNamesOf(type, handler)) {
          const roles = ASSISTANT_ROLES.filter((role) =>
            Object.hasOwn(this.listOf(role), name),
          );
          if (roles.length === 0) {
            continue;
          }
          found.add(name);
          const fault = assistantRouteFault({
            name,
            method: name.slice(0, name.indexOf(' ')),
            declarations: declarationsOf(handler),
          });
          if (fault !== undefined) {
            faults.push(`${name} ${fault}`);
          }
          this.roles.set(handler, new Set(roles));
          this.names.set(handler, name);
        }
      }
    }
    for (const role of ASSISTANT_ROLES) {
      for (const name of Object.keys(this.listOf(role))) {
        if (!found.has(name)) {
          faults.push(`${name} is on the assistant’s list of ${role} and is not a route`);
        }
      }
    }
    if (faults.length > 0) {
      throw new Error(`Routes on the assistant’s lists against 02: ${faults.join('; ')}.`);
    }
    this.ready = true;
  }

  /** Whether the handler is on the list of the role. Before the start check ran: never. */
  opens(handler: object, role: AssistantRole): boolean {
    return this.ready && (this.roles.get(handler)?.has(role) ?? false);
  }

  /** The route name of a listed handler. */
  nameOf(handler: object): string | undefined {
    return this.names.get(handler);
  }
}
