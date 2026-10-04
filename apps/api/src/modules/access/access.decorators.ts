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
 * Who may call a route. Every route declares exactly one of the three, on the
 * handler itself:
 *
 * - `@Public()`: works without sign-in (the short list of `public-routes.test.ts`);
 * - `@AnySignedIn()`: every signed-in account, for its own account only;
 * - `@Requires(area, action)`: a role that the permission table gives the action.
 */
export type RouteAccess =
  { kind: 'public' } | { kind: 'any_signed_in' } | ({ kind: 'requires' } & Requirement);

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
 * the Principal included: the own sign-in, password, sessions and second step.
 * Such a route acts on the account of the session only and never on one named
 * in the request.
 */
export const AnySignedIn = (): MethodDecorator => declare({ kind: 'any_signed_in' });

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
