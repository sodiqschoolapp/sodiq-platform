import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACTING_STAFF_ID_HEADER,
  INTEGRATION_KEY_HEADER,
  INTEGRATION_KEY_SECRET_FORMAT,
  staffIdSchema,
} from '@sodiq/shared';
import type { Request } from 'express';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { ApiException } from '../../http/api-exception.js';
import { currentRequestContext } from '../../http/request-context.js';
import { carriesIntegrationKey } from '../../http/same-site.js';
import { readSessionToken } from '../../http/session-cookie.js';
import {
  IntegrationKeyRequests,
  type FoundKey,
  type KeyPerson,
} from '../access/integration-key-requests.service.js';
import { keyRouteOf } from '../access/key-routes.js';
import { Sessions, type ActiveSession } from './sessions.service.js';

/** Metadata key of `@Public()`. The test of the public routes reads it. */
export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');
const BEFORE_PASSWORD_CHANGE = Symbol('BEFORE_PASSWORD_CHANGE');
const BEFORE_SECOND_STEP = Symbol('BEFORE_SECOND_STEP');
const BEFORE_SECOND_STEP_SET_UP = Symbol('BEFORE_SECOND_STEP_SET_UP');

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

/**
 * Declares a route that a session may use after the password and before the
 * second step: the second step itself, reading the session and sign-out.
 */
export const AllowedBeforeSecondStep = (): MethodDecorator => SetMetadata(BEFORE_SECOND_STEP, true);

/**
 * Declares a route that a session may use while the second step is required
 * for the account and not set up: the set-up itself, reading the session,
 * sign-out and the own password.
 */
export const AllowedBeforeSecondStepSetUp = (): MethodDecorator =>
  SetMetadata(BEFORE_SECOND_STEP_SET_UP, true);

/**
 * The owed steps of sign-in that the handler may be reached with. Only routes
 * of the own sign-in carry such a mark; the permission guard refuses a route
 * with a permission that carries one, and a test holds the list.
 */
export function owedStepsAllowedOn(handler: object): string[] {
  const marks: [symbol, string][] = [
    [BEFORE_SECOND_STEP, 'second_step'],
    [BEFORE_PASSWORD_CHANGE, 'password_change'],
    [BEFORE_SECOND_STEP_SET_UP, 'second_step_set_up'],
  ];
  return marks
    .filter(([key]) => Reflect.getMetadata(key, handler) === true)
    .map(([, name]) => name);
}

/** The session the guard found for a request. Not on the request object: nothing else can set it. */
const SESSIONS = new WeakMap<Request, ActiveSession>();

/** The session `SessionGuard` found for the request; none on a public route. For the permission guard. */
export const sessionOf = (request: Request): ActiveSession | undefined => SESSIONS.get(request);

/**
 * A request made through an integration key (task 10.10): the key, and the person it acts
 * for, `null` on the key's own route (`KeyOnly`). Never a session: nothing of the account.
 */
export interface KeyActor {
  key: FoundKey;
  person: KeyPerson | null;
}

/** Not on the request object either: nothing else can set it. */
const KEY_ACTORS = new WeakMap<Request, KeyActor>();

/** The key actor `SessionGuard` found for the request; none for a session or a public route. */
export const keyActorOf = (request: Request): KeyActor | undefined => KEY_ACTORS.get(request);

/**
 * The key of a `KeyOnly` route (task 10.10).
 *
 *     people(@CurrentIntegrationKey() key: FoundKey)
 */
export const CurrentIntegrationKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): FoundKey => {
    const actor = KEY_ACTORS.get(context.switchToHttp().getRequest<Request>());
    if (actor === undefined) {
      throw new Error('CurrentIntegrationKey was used on a route that is not KeyOnly.');
    }
    return actor.key;
  },
);

/** One value of a header, or `undefined` when it is missing, empty or repeated. */
function oneValue(header: string | string[] | undefined): string | undefined {
  return typeof header === 'string' && header !== '' ? header : undefined;
}

/**
 * The session of the request, as the guard read it from the database.
 *
 *     read(@CurrentSession() session: ActiveSession)
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession => {
    const session = SESSIONS.get(context.switchToHttp().getRequest<Request>());
    if (session === undefined) {
      throw new Error(
        'CurrentSession was used on a route that is public, or on a request made through a key.',
      );
    }
    return session;
  },
);

/**
 * On every route of the application: no session, no answer, unless the handler
 * is declared `@Public()`. The session and the account are read from the
 * database on every request, so a session that was ended elsewhere stops at
 * once. A session that still owes a step of sign-in (the second step, the
 * forced password change, the set-up of a required second step) reaches only
 * the routes declared for that step. Who may do what (role and branch) is
 * decided by `PermissionGuard`, which runs after this one.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: Sessions,
    private readonly keyRequests: IntegrationKeyRequests,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const request = context.switchToHttp().getRequest<Request>();
    // Task 10.10: a request with the key header is a key request, before anything else, the
    // public routes included (review finding 7 of the plan): its cookie is never read.
    if (carriesIntegrationKey(request.headers)) {
      await this.keyRequest(request, handler);
      return true;
    }
    // Only the handler is asked: a whole controller cannot be made public.
    if (this.reflector.get<boolean | undefined>(PUBLIC_ROUTE, handler) === true) {
      // A public route does not read the session at all.
      return true;
    }
    const token = readSessionToken(request);
    const session = token === undefined ? undefined : await this.sessions.resolve(token);
    if (session === undefined) {
      throw new ApiException('not_signed_in', 401);
    }
    const allowed = (key: symbol): boolean =>
      this.reflector.get<boolean | undefined>(key, handler) === true;
    // One thing at a time, in this order. The second step comes before the
    // forced password change: an administrator who reset the password of an
    // account with a second step still cannot enter it. The set-up comes after
    // it: a first password is changed before anything is added to the account.
    if (session.secondStep === 'pending') {
      if (!allowed(BEFORE_SECOND_STEP)) {
        throw new ApiException('second_step_required', 403);
      }
    } else if (session.mustChangePassword) {
      if (!allowed(BEFORE_PASSWORD_CHANGE)) {
        throw new ApiException('password_change_required', 403);
      }
    } else if (session.secondStep === 'set_up_required') {
      if (!allowed(BEFORE_SECOND_STEP_SET_UP)) {
        throw new ApiException('second_step_set_up_required', 403);
      }
    }
    SESSIONS.set(request, session);
    return true;
  }

  /**
   * A request made through an integration key (`02`, Integration keys; task 10.10, the plan
   * of pull request #369): HTTPS where the proxy says it, the key (not revoked, not ended,
   * counted against the limit, its last use written), the route on the list of routes open to
   * keys, and the person named by staff ID, on the key and active, with only their Teacher,
   * Head Teacher and Senior Head Teacher assignments. Read again on every request. No session
   * is read, used or opened.
   */
  private async keyRequest(request: Request, handler: object): Promise<void> {
    if (this.config.trustProxy && request.protocol !== 'https') {
      throw new ApiException('integration_key_https_required', 400);
    }
    const secret = oneValue(request.headers[INTEGRATION_KEY_HEADER.toLowerCase()]);
    if (secret === undefined || !INTEGRATION_KEY_SECRET_FORMAT.test(secret)) {
      throw new ApiException('integration_key_invalid', 401);
    }
    const key = await this.keyRequests.use(secret);
    const mark = keyRouteOf(handler);
    if (mark === undefined) {
      throw new ApiException('integration_key_route_closed', 403);
    }
    let person: KeyPerson | null = null;
    if (mark === 'person') {
      const staffId = staffIdSchema.safeParse(
        oneValue(request.headers[ACTING_STAFF_ID_HEADER.toLowerCase()]),
      );
      if (!staffId.success) {
        throw new ApiException('validation_failed', 400, undefined, [
          {
            path: ACTING_STAFF_ID_HEADER,
            code: 'invalid',
            message: 'The staff ID of the person the request acts for, S-YYNNNN.',
          },
        ]);
      }
      person = await this.keyRequests.person(key, staffId.data);
    }
    KEY_ACTORS.set(request, { key, person });
    const store = currentRequestContext();
    if (store === undefined) {
      // Without the context the audit entries would not name the key: never run the route.
      throw new Error('A key request reached the guard outside the request context.');
    }
    store.integrationKey = { id: key.id, name: key.name };
  }
}
