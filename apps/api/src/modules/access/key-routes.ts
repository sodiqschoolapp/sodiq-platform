import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { Area } from '@sodiq/shared';

/**
 * The routes open to integration keys (task 10.10; `02`, Integration keys:
 * "The routes open to keys are a list fixed in code; a route added later
 * stays closed to keys until a task adds it"). A route is open to keys only
 * with a mark on its handler; `key-routes.test.ts` holds the exact list
 * (`KEY_ROUTES`) and fails for a marked route that is not on it.
 */
const KEY_ROUTE = Symbol('KEY_ROUTE');

/** The mark of an operation open to keys in the OpenAPI document (`docs/integration-guide.md`). */
export const OPEN_TO_KEYS_EXTENSION = 'x-open-to-integration-keys';

/** `person`: acts for the person named by staff ID; `key_only`: the key's own people list. */
export type KeyRouteKind = 'person' | 'key_only';

/**
 * Opens a route with a permission to a request made through a key, for the
 * person it names, with only their Teacher, Head Teacher and Senior Head
 * Teacher assignments. Everything else of the route (scope, edit periods,
 * locks, cell versions) is the same as for the person's own session.
 */
export const OpenToKeys = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(KEY_ROUTE, 'person'),
    // The OpenAPI document names the routes open to keys for the department platforms.
    ApiExtension(OPEN_TO_KEYS_EXTENSION, true),
  );

/** For `KeyOnly` of `access.decorators.ts`: the mark of the key's own route. */
export const markKeyOnly = (): MethodDecorator =>
  applyDecorators(SetMetadata(KEY_ROUTE, 'key_only'), ApiExtension(OPEN_TO_KEYS_EXTENSION, true));

/** How a handler is open to keys, or `undefined`: closed to keys. */
export function keyRouteOf(handler: object): KeyRouteKind | undefined {
  const mark: unknown = Reflect.getMetadata(KEY_ROUTE, handler);
  return mark === 'person' || mark === 'key_only' ? mark : undefined;
}

/**
 * The areas never open to a key (`02`: "Never through a key: exports, a
 * student's record (profile, diagnostic score, history …), moving students
 * between groups, and the person's own account"), with the class and group
 * lists left out by decision 1 of pull request #369.
 */
export const NEVER_THROUGH_KEYS: readonly Area[] = [
  'students',
  'student_diagnostic',
  'student_history',
  'group_transfers',
  'classes',
  'groups',
  'accounts',
  'account_access',
];

/** What a handler declares, as `keyRouteFault` reads it. */
export interface KeyRouteFacts {
  mark: KeyRouteKind | undefined;
  /** `declarationsOf(handler)`, as kinds with the area and action of a `requires`. */
  declarations: readonly { kind: string; area?: string; action?: string }[];
  /** `owedStepsAllowedOn(handler)`. */
  owedSteps: readonly string[];
}

/**
 * Why a handler's mark is a fault of the code, or `undefined` when it is sound.
 * The application does not start with such a route (`KeyRoutesCheck`), and
 * `key-routes.test.ts` runs the same check over every route.
 */
export function keyRouteFault(facts: KeyRouteFacts): string | undefined {
  const { mark, declarations, owedSteps } = facts;
  if (mark === undefined) {
    return undefined;
  }
  const [declaration] = declarations;
  if (declaration === undefined || declarations.length !== 1) {
    return 'is open to keys without exactly one access declaration';
  }
  if (owedSteps.length > 0) {
    return 'is open to keys and to a session that owes a step of sign-in';
  }
  if (mark === 'key_only') {
    return declaration.kind === 'integration_key'
      ? undefined
      : 'is marked as the key’s own route without `KeyOnly`';
  }
  if (declaration.kind !== 'requires') {
    return `is open to keys with the declaration ${declaration.kind}; only a route with a permission may be`;
  }
  if (declaration.action === 'export') {
    return 'is an export, never open to keys';
  }
  if (NEVER_THROUGH_KEYS.some((area) => area === declaration.area)) {
    return `needs the area ${String(declaration.area)}, never open to keys`;
  }
  return undefined;
}
