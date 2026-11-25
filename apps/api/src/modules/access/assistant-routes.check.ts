import { Inject, Injectable, RequestMethod, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  ASSISTANT_ROLES,
  permits,
  type Action,
  type AssistantRole,
  type PermissionTable,
} from '@sodiq/shared';
import { API_PREFIX } from '../../app.setup.js';
import { RETURNS_FILE, TAKES_FILE } from '../../http/schemas.js';
import { declarationsOf } from './access.decorators.js';
import {
  ASSISTANT_ROUTE_LINES,
  assistantLineFault,
  assistantRouteFault,
  notThroughAssistant,
  routeKindOf,
  type AssistantRouteKind,
  type AssistantRouteLine,
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
 * The actions open to the assistant, by handler (task 11.20; `02`, build order: "limited to the
 * actions of that role the Super Admin switched on for the assistant. A test holds that every
 * action of each role is on its list"). Built once at the start: a role's list is every handler
 * with one `@Requires(area, action)` that the permission table gives the role, except the
 * assistant's own routes, each with its line of `ROUTE_LINES`. The app does not start with a
 * line that `assistantRouteFault` or `assistantLineFault` refuses, or that names no route.
 * `PermissionGuard` asks it on each request marked as the assistant's; the switches narrow it
 * further in the dispatcher (`assistant-switches.service.ts`).
 */
@Injectable()
export class AssistantRoutes implements OnApplicationBootstrap {
  private readonly roles = new WeakMap<object, ReadonlySet<AssistantRole>>();
  private readonly names = new WeakMap<object, string>();
  /** The lines of each role once the start check ran. */
  private readonly derived = new Map<AssistantRole, Record<string, AssistantRouteLine>>();
  /** What each listed route is: its area, action and whether it works for no branch. */
  private readonly facts = new Map<string, ListedRoute>();
  /** Routes a role holds that have no line yet (a test fails on each; none is offered). */
  private readonly unlined = new Set<string>();
  private ready = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    @Inject(ASSISTANT_ROUTE_LINES)
    private readonly lines: Readonly<Record<string, AssistantRouteLine>>,
    @Inject(PERMISSION_TABLE) private readonly table: PermissionTable,
  ) {}

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
          const line = this.lines[name];
          const facts = {
            name,
            method: name.slice(0, name.indexOf(' ')),
            declarations,
            takesFile: Reflect.getMetadata(TAKES_FILE, handler) !== undefined,
            returnsFile: Reflect.getMetadata(RETURNS_FILE, handler) === true,
            ...(line === undefined ? {} : { line }),
          };
          if (line !== undefined) {
            found.add(name);
            const fault = assistantRouteFault(facts);
            if (fault !== undefined) {
              faults.push(`${name} ${fault}`);
              continue;
            }
          }
          const [declaration] = declarations;
          if (
            declarations.length !== 1 ||
            declaration?.kind !== 'requires' ||
            declaration.area === undefined ||
            declaration.action === undefined ||
            notThroughAssistant(name)
          ) {
            continue;
          }
          const { area, action } = declaration;
          const roles = ASSISTANT_ROLES.filter((role) => permits(this.table, role, area, action));
          if (roles.length === 0) {
            continue;
          }
          if (line === undefined) {
            this.unlined.add(name);
            continue;
          }
          this.facts.set(name, {
            area,
            action,
            kind: routeKindOf(facts),
            branchNone: (declaration as { branch?: string }).branch === 'none',
          });
          for (const role of roles) {
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
    // controllers and answer no request: nothing is open there.
    if (found.size === 0) {
      this.ready = true;
      return;
    }
    // A line whose route this context does not hold (a controller registered only in some
    // contexts) is not on a list here; `assistant-routes.test.ts` holds that every line names a
    // route of the whole application.
    for (const role of ASSISTANT_ROLES) {
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

  /** The lines open to a role, by route name. Before the start check ran: none. */
  linesOf(role: AssistantRole, starting = false): Readonly<Record<string, AssistantRouteLine>> {
    return this.ready || starting ? (this.derived.get(role) ?? {}) : {};
  }

  /** The area, action and kind of a listed route. */
  factsOf(name: string): ListedRoute | undefined {
    return this.facts.get(name);
  }

  /** The routes a role holds that have no line (`assistant-lines.test.ts` fails on each). */
  routesWithoutLine(): readonly string[] {
    return [...this.unlined].sort();
  }

  /** The route name of a listed handler. */
  nameOf(handler: object): string | undefined {
    return this.names.get(handler);
  }
}

/** What `AssistantRoutes` knows of a listed route. */
export interface ListedRoute {
  area: string;
  action: Action;
  kind: AssistantRouteKind;
  /** `@Requires(…, { branch: 'none' })`: sent with no branch header. */
  branchNone: boolean;
}
