import { randomUUID } from 'node:crypto';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  ROLES,
  SCHOOL_WIDE_ROLES,
  STRICT_SIGN_IN_ROLES,
  type Role,
} from '@sodiq/shared';
import type { Response } from 'express';
import { of, type Observable } from 'rxjs';
import request from 'supertest';
import { ALL_METHODS, expressRoutesOf, routesOf } from './routes.js';
import { signInKit } from './sign-in-kit.js';

/**
 * Who may call a route, written by hand in the test of each application: no
 * sign-in needed, every signed-in account, or the roles that are allowed and
 * whether the route works for the branch of the request or for none. Nothing
 * the harness expects is taken from the declaration of the route itself.
 */
export type ExpectedAccess =
  'public' | 'any_signed_in' | { roles: readonly Role[]; branch: 'request' | 'none' };

const REACHED_HEADER = 'X-Harness-Reached-Handler';

/**
 * Stops a request after the guards and before the handler, and marks the
 * answer. With it the harness can call every route as every role without
 * running anything: a sign-out, a publish or a forced delete does not happen,
 * and no route needs a valid body. It does nothing until it is switched on, so
 * the callers can sign in first: `createTestApp({ handlerStop })`, then
 * `accessProblems(app, expected, callers, handlerStop)`.
 */
@Injectable()
export class StopBeforeHandler implements NestInterceptor {
  active = false;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.active) {
      return next.handle();
    }
    context.switchToHttp().getResponse<Response>().setHeader(REACHED_HEADER, '1');
    return of(undefined);
  }
}

/**
 * What is wrong with the routes as they are declared, before any request is
 * sent; an empty list means every route says who may call it and the list
 * written by hand agrees.
 */
export function declarationProblems(
  app: NestExpressApplication,
  expected: Readonly<Record<string, ExpectedAccess>>,
): string[] {
  const problems: string[] = [];
  const routes = routesOf(app);
  for (const route of routes) {
    if (route.access.length !== 1) {
      problems.push(
        `${route.name}: ${String(route.access.length)} access declarations, it needs exactly one`,
      );
    }
    if (!route.describesAnswer) {
      problems.push(`${route.name}: no @Returns, @ReturnsNothing or @ReturnsFile`);
    }
    if (route.method === ALL_METHODS) {
      // Left open by 0.7b: such a route crashed the harness instead of being named.
      problems.push(
        `${route.name}: answers every method (@All); a route names its one method, so that it can be called and listed`,
      );
    }
    if (!Object.hasOwn(expected, route.name)) {
      problems.push(`${route.name}: not in the list of who may call it`);
      continue;
    }
    const [access] = route.access;
    const listed = expected[route.name];
    const kind = typeof listed === 'string' ? listed : 'requires';
    if (access !== undefined && route.access.length === 1 && access.kind !== kind) {
      problems.push(`${route.name}: declared ${access.kind}, listed as ${kind}`);
    }
    if (
      access?.kind === 'requires' &&
      typeof listed === 'object' &&
      access.branch !== listed.branch
    ) {
      problems.push(
        `${route.name}: declared for the branch "${access.branch}", listed for "${listed.branch}"`,
      );
    }
    if (route.allowedBefore.length > 0 && access?.kind !== 'any_signed_in') {
      problems.push(
        `${route.name}: open to a session that owes a step of sign-in (${route.allowedBefore.join(', ')}), which only a route of the own account may be`,
      );
    }
  }
  const names = new Set(routes.map((route) => route.name));
  for (const name of Object.keys(expected)) {
    if (!names.has(name)) {
      problems.push(`${name}: listed, but the application has no such route`);
    }
  }
  // What Express answers by itself has no guard in front of it.
  // A route for every method is in the router once per method; it is named above, once.
  const everyMethod = new Set(
    routes.filter((route) => route.method === ALL_METHODS).map((route) => route.path),
  );
  for (const name of expressRoutesOf(app)) {
    if (!names.has(name) && !everyMethod.has(name.slice(name.indexOf(' ') + 1))) {
      problems.push(`${name}: a route of the Express router that no controller explains`);
    }
  }
  return problems;
}

/** One caller of the harness: nobody, an account without a role, or an account with one role. */
export interface Caller {
  name: string;
  role: Role | null;
  /** The cookies of its session; none for the caller who is not signed in. */
  cookies: string | undefined;
}

export interface HarnessCallers {
  /** The branch in which every caller with a branch role holds it. */
  home: string;
  /** A branch in which no caller holds a branch role. */
  other: string;
  callers: Caller[];
}

/** Invented names, one per role, in letters only: a login is made from them. */
const lastNameOf = (role: Role): string =>
  role
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');

/**
 * Signs in one account per role (15), one account without a role, and adds
 * the caller who is not signed in. Every session owes no step: the two strict
 * roles have their second step set up. Call once per application.
 */
export async function harnessCallers(
  app: NestExpressApplication,
  branches: { home: string; other: string },
): Promise<HarnessCallers> {
  const callers: Caller[] = [{ name: 'nobody', role: null, cookies: undefined }];
  const plain = await signInKit(app).fullSession('Norole', 'Harness');
  callers.push({ name: 'no role', role: null, cookies: plain.cookie });
  for (const role of ROLES) {
    const kit = signInKit(app, {
      newAccountsHold: SCHOOL_WIDE_ROLES.includes(role)
        ? { role }
        : { role, branchId: branches.home },
    });
    const browser = STRICT_SIGN_IN_ROLES.includes(role)
      ? await kit.completeSession('Harness', lastNameOf(role))
      : await kit.fullSession('Harness', lastNameOf(role));
    callers.push({ name: role, role, cookies: browser.cookie });
  }
  return { ...branches, callers };
}

type Outcome = 'allowed' | 'not_signed_in' | 'refused';

function expectedOutcome(listed: ExpectedAccess, caller: Caller, inHomeBranch: boolean): Outcome {
  if (listed === 'public') {
    return 'allowed';
  }
  if (caller.cookies === undefined) {
    return 'not_signed_in';
  }
  if (listed === 'any_signed_in') {
    return 'allowed';
  }
  if (caller.role === null || !listed.roles.includes(caller.role)) {
    return 'refused';
  }
  const anyBranch = listed.branch === 'none' || SCHOOL_WIDE_ROLES.includes(caller.role);
  return inHomeBranch || anyBranch ? 'allowed' : 'refused';
}

/**
 * docs/spec/14-quality-plan.md: "For every role and every API address, a test
 * checks what is allowed and what is refused." Calls every route of the
 * application as every caller, for the branch where the caller holds its role
 * and for another one, and compares with the list written by hand. Returns
 * what differs; an empty list means the server allows and refuses as listed.
 * It also names a route whose answer may be kept by a browser (no
 * `Cache-Control: no-store`), once per route.
 *
 * The application must be made with `handlerStop`. Subject, class
 * and own-lesson scope are not covered here: each route tests its own.
 */
export async function accessProblems(
  app: NestExpressApplication,
  expected: Readonly<Record<string, ExpectedAccess>>,
  callers: HarnessCallers,
  handlerStop: StopBeforeHandler,
): Promise<string[]> {
  handlerStop.active = true;
  try {
    return await compare(app, expected, callers);
  } finally {
    handlerStop.active = false;
  }
}

async function compare(
  app: NestExpressApplication,
  expected: Readonly<Record<string, ExpectedAccess>>,
  { home, other, callers }: HarnessCallers,
): Promise<string[]> {
  const server = app.getHttpServer();
  const problems: string[] = [];
  for (const route of routesOf(app)) {
    const listed = expected[route.name];
    if (listed === undefined) {
      // Named by `declarationProblems`.
      continue;
    }
    if (route.method === ALL_METHODS) {
      // Named here too, so that a caller of this function alone does not pass over it.
      problems.push(`${route.name}: answers every method (@All) and was not called`);
      continue;
    }
    let kept = false;
    // Every `:parameter` of the path becomes an id that names nothing.
    const path = route.path.replace(/:[A-Za-z0-9_]+/g, () => randomUUID());
    for (const caller of callers) {
      for (const branch of [home, other]) {
        let call = request(server)
          [route.method.toLowerCase() as 'get'](path)
          .set(BRANCH_HEADER, branch);
        if (caller.cookies !== undefined) {
          call = call.set('Cookie', caller.cookies);
        }
        const response = await call;
        const code = apiErrorSchema.safeParse(response.body).data?.error.code;
        const outcome: string =
          response.headers[REACHED_HEADER.toLowerCase()] === '1'
            ? 'allowed'
            : response.status === 401 && code === 'not_signed_in'
              ? 'not_signed_in'
              : response.status === 403 && code === 'permission_denied'
                ? 'refused'
                : `answered ${String(response.status)} ${code ?? ''}`.trim();
        // Task 0.7c: every answer carries `Cache-Control: no-store`, allowed or refused.
        if (response.headers['cache-control'] !== 'no-store' && !kept) {
          kept = true;
          problems.push(
            `${route.name} as ${caller.name}: the answer does not carry Cache-Control: no-store`,
          );
        }
        const wanted = expectedOutcome(listed, caller, branch === home);
        if (outcome !== wanted) {
          problems.push(
            `${route.name} as ${caller.name} in ${branch === home ? 'the own' : 'another'} branch: ${outcome}, listed as ${wanted}`,
          );
        }
      }
    }
  }
  return problems;
}
