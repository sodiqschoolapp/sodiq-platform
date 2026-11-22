import { Inject, Injectable, RequestMethod, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ASSISTANT_ROLES, type AssistantRole, type PermissionTable } from '@sodiq/shared';
import { API_PREFIX } from '../../app.setup.js';
import { declarationsOf } from './access.decorators.js';
import {
  ASSISTANT_ROUTE_LISTS,
  DERIVED_ASSISTANT_LISTS,
  assistantLineFault,
  assistantRouteFault,
  derivedOpens,
  type AssistantRouteLine,
  type AssistantRouteLists,
} from './assistant-routes.js';
import { PERMISSION_TABLE } from './permission-table.token.js';

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
  /** The lines of each role once the start check ran, the derived lists included (11.13). */
  private readonly derived = new Map<AssistantRole, Record<string, AssistantRouteLine>>();
  private ready = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    @Inject(ASSISTANT_ROUTE_LISTS) private readonly lists: AssistantRouteLists,
    @Inject(PERMISSION_TABLE) private readonly table: PermissionTable,
  ) {}

  /** The written list of a role, or the list a derived role is narrowed from. */
  private listOf(role: AssistantRole): Readonly<Record<string, AssistantRouteLine>> {
    const source = DERIVED_ASSISTANT_LISTS[role];
    return this.lists[role] ?? (source === undefined ? undefined : this.lists[source]) ?? {};
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
          const declarations = declarationsOf(handler);
          const [declaration] = declarations;
          const roles = ASSISTANT_ROLES.filter(
            (role) =>
              Object.hasOwn(this.listOf(role), name) &&
              (DERIVED_ASSISTANT_LISTS[role] === undefined ||
                (this.lists[role] === undefined &&
                  declaration?.kind === 'requires' &&
                  derivedOpens(this.table, role, declaration))),
          );
          if (roles.length === 0) {
            continue;
          }
          found.add(name);
          for (const role of roles) {
            const line = this.listOf(role)[name];
            if (line === undefined) {
              continue;
            }
            const fault = assistantRouteFault({
              name,
              method: name.slice(0, name.indexOf(' ')),
              declarations,
              line,
            });
            if (fault !== undefined) {
              faults.push(`${name} ${fault}`);
            }
            const lines = this.derived.get(role) ?? {};
            lines[name] = line;
            this.derived.set(role, lines);
          }
          this.roles.set(handler, new Set(roles));
          this.names.set(handler, name);
        }
      }
    }
    // The jobs worker's context, the seeds and the first-account command hold none of the
    // listed controllers and answer no request: nothing is open there. The application's own
    // start, and `assistant-routes.test.ts`, hold every listed route.
    if (found.size === 0) {
      this.ready = true;
      return;
    }
    for (const role of ASSISTANT_ROLES) {
      for (const name of Object.keys(this.listOf(role))) {
        if (!found.has(name)) {
          faults.push(`${name} is on the assistant’s list of ${role} and is not a route`);
        }
      }
      const lines = this.linesOf(role, true);
      for (const [name, line] of Object.entries(lines)) {
        const fault = assistantLineFault(name, line, lines);
        if (fault !== undefined) {
          faults.push(`${name} (${role}) ${fault}`);
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

  /**
   * The lines open to a role, by route name: its written list, or for a derived role the lines
   * the table opens (task 11.13). Before the start check ran: none.
   */
  linesOf(role: AssistantRole, starting = false): Readonly<Record<string, AssistantRouteLine>> {
    return this.ready || starting ? (this.derived.get(role) ?? {}) : {};
  }

  /** The route name of a listed handler. */
  nameOf(handler: object): string | undefined {
    return this.names.get(handler);
  }
}
