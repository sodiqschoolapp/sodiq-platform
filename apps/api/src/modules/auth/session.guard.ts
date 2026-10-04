import {
  createParamDecorator,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../../http/api-exception.js';
import { readSessionToken } from '../../http/session-cookie.js';
import { Sessions, type ActiveSession } from './sessions.service.js';

/** Metadata key of `@Public()`. The test of the public routes reads it. */
export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');
const BEFORE_PASSWORD_CHANGE = Symbol('BEFORE_PASSWORD_CHANGE');

/**
 * Declares a route that works without sign-in, on the handler itself. The spec
 * allows a short list (docs/spec/02-roles-and-access.md, "Accounts and sign-in:
 * build order"); `public-routes.test.ts` holds it and fails for a route that is
 * public and not listed.
 */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_ROUTE, true);

/**
 * Declares a route that a session with a first password may use: the password
 * change itself, reading the session and sign-out. Every other route waits
 * until the password is changed.
 */
export const AllowedBeforePasswordChange = (): MethodDecorator =>
  SetMetadata(BEFORE_PASSWORD_CHANGE, true);

/** The session the guard found for a request. Not on the request object: nothing else can set it. */
const SESSIONS = new WeakMap<Request, ActiveSession>();

/**
 * The session of the request, as the guard read it from the database.
 *
 *     read(@CurrentSession() session: ActiveSession)
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession => {
    const session = SESSIONS.get(context.switchToHttp().getRequest<Request>());
    if (session === undefined) {
      throw new Error('CurrentSession was used on a route that is public.');
    }
    return session;
  },
);

/**
 * On every route of the application: no session, no answer, unless the handler
 * is declared `@Public()`. The session and the account are read from the
 * database on every request, so a session that was ended elsewhere stops at
 * once. Who may do what (role, branch, scope) is the permission guard of task
 * 0.7, which builds on this one.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: Sessions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    // Only the handler is asked: a whole controller cannot be made public.
    if (this.reflector.get<boolean | undefined>(PUBLIC_ROUTE, handler) === true) {
      // A public route does not read the session at all.
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = readSessionToken(request);
    const session = token === undefined ? undefined : await this.sessions.resolve(token);
    if (session === undefined) {
      throw new ApiException('not_signed_in', 401);
    }
    if (
      session.mustChangePassword &&
      this.reflector.get<boolean | undefined>(BEFORE_PASSWORD_CHANGE, handler) !== true
    ) {
      throw new ApiException('password_change_required', 403);
    }
    SESSIONS.set(request, session);
    return true;
  }
}
