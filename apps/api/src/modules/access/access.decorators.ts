import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  branchIdSchema,
  type Action,
  type Area,
} from '@sodiq/shared';
import { toOpenApiSchema } from '../../http/schemas.js';
import { PUBLIC_ROUTE } from '../auth/session.guard.js';
import type { Requirement } from './permission-check.js';

/**
 * Who may call a route. Every route declares exactly one of the four, on the
 * handler itself:
 *
 * - `@Public()`: works without sign-in (the short list of `public-routes.test.ts`);
 * - `@AnySignedIn()`: every signed-in account, for its own account only;
 * - `@Requires(area, action)`: a role that the permission table gives the action;
 * - `@PortalChild()`: a parent session, for a child of its own (task 11.2).
 */
export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'any_signed_in'; parent: boolean }
  | { kind: 'portal' }
  | ({ kind: 'requires' } & Requirement);

const ACCESS = Symbol('ACCESS');

/** Added to what the handler declared before, so that a second declaration is seen and refused. */
function declare(access: RouteAccess): MethodDecorator {
  return (_target, _key, descriptor) => {
    const handler: unknown = descriptor.value;
    if (typeof handler !== 'function') {
      throw new Error('An access declaration belongs on a route method.');
    }
    const earlier = (Reflect.getMetadata(ACCESS, handler) as RouteAccess[] | undefined) ?? [];
    Reflect.defineMetadata(ACCESS, [...earlier, access], handler);
  };
}

/** Everything a handler declares about who may call it. A sound route has exactly one entry. */
export function declarationsOf(handler: object): RouteAccess[] {
  const declared = (Reflect.getMetadata(ACCESS, handler) as RouteAccess[] | undefined) ?? [];
  return Reflect.getMetadata(PUBLIC_ROUTE, handler) === true
    ? [{ kind: 'public' }, ...declared]
    : declared;
}

/**
 * Declares a route that every signed-in account may call, whatever its roles,
 * the Principal included: the own sign-in, password, sessions and second step,
 * and a feedback report about the own experience of the app (edge cases, "Who
 * can act"; docs/spec-changes.md, 6 October 2026). Such a route acts on the
 * account of the session only and never on one named in the request.
 */
/**
 * Every signed-in account. `{ parent: true }` also lets a parent session in (task 11.1): only
 * the routes of the own account the owner approved for the `parent` role ("signs in and
 * changes its own password and language", build plan 11.1); every other route refuses a
 * parent session.
 */
export const AnySignedIn = (options: { parent?: true } = {}): MethodDecorator =>
  declare({ kind: 'any_signed_in', parent: options.parent === true });

/**
 * A route of the parent portal (task 11.2, pull request #294, decision 1, Look first). The
 * guard lets in a parent session only, when the permission table gives the `parent` role
 * `view` in the `portal` area; every staff session is refused, the Super Admin's too (build
 * plan 11.2: "no staff role has it"). A Parent account has no assignment (0158), so
 * `Requires` cannot let it in. The route then checks the child scope on every request
 * (`portalChild` of `modules/portal/portal-scope.ts`): the guard decides the role only.
 */
export const PortalChild = (): MethodDecorator =>
  applyDecorators(
    declare({ kind: 'portal' }),
    ApiResponse({ status: 403, schema: toOpenApiSchema(apiErrorSchema, 'output') }),
  );

export interface RequiresOptions {
  /** `none` for school-wide work, which names no branch. Left out: the branch of the request. */
  branch?: 'none';
}

/**
 * `Requires` for an area given as text. Only for controllers that exist in
 * tests with a table of their own; a route of the application uses `Requires`,
 * which accepts the areas of the real table only.
 */
export function requiresInTable(
  area: string,
  action: Action,
  options: RequiresOptions = {},
): MethodDecorator {
  const refusal = ApiResponse({ status: 403, schema: toOpenApiSchema(apiErrorSchema, 'output') });
  if (options.branch === 'none') {
    return applyDecorators(declare({ kind: 'requires', area, action, branch: 'none' }), refusal);
  }
  return applyDecorators(
    declare({ kind: 'requires', area, action, branch: 'request' }),
    ApiHeader({
      name: BRANCH_HEADER,
      required: true,
      schema: toOpenApiSchema(branchIdSchema, 'input'),
    }),
    refusal,
  );
}

/**
 * Declares the action in an area of the permission table that a route needs
 * (docs/spec/02-roles-and-access.md, Rules). The request names its branch in
 * the `X-Branch-Id` header; the guard allows it when a current assignment of
 * the account has a role with that action, in that branch. The route reads
 * what was allowed with `@CurrentAccess()`.
 *
 *     @Get()
 *     @Requires('rooms', 'view')
 *     list(@CurrentAccess() access: Access)
 */
export const Requires = (
  area: Area,
  action: Action,
  options: RequiresOptions = {},
): MethodDecorator => requiresInTable(area, action, options);
