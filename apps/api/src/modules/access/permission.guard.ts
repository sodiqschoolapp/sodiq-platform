import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  BRANCH_HEADER,
  branchIdSchema,
  freezeTable,
  type PermissionTable,
  type Role,
} from '@sodiq/shared';
import type { Request } from 'express';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { HeaderPipe } from '../../http/validation.js';
import { owedStepsAllowedOn, sessionOf } from '../auth/session.guard.js';
import { declarationsOf } from './access.decorators.js';
import { CLASS_SCOPED_AREAS, tutorClassesAt } from './class-scope.js';
import type { CurrentAssignment } from './current-assignments.js';
import { taughtAt } from './taught-scope.js';
import { permitting, reachingBranch } from './permission-check.js';
import { PERMISSION_TABLE } from './permission-table.token.js';

/** What the guard allowed for a request of a `@Requires` route. */
export interface Access {
  accountId: string;
  /** The assignment that allowed the action; the audit entry of the change names it. */
  assignmentId: string;
  role: Role;
  /** The branch of the request, in small letters; `null` on a route declared with `branch: 'none'`. */
  branchId: string | null;
  /** For `Transactions.run`: the branch of the request, or nothing for school-wide work. */
  branchIds: readonly string[];
  /**
   * Every current assignment of the account, by id, as the session read them
   * for this request. A route that allows a part of its change to one role only
   * decides it from all of them, never from `role` (edge cases, "Who can act":
   * "The server allows an action if any current assignment permits it").
   */
  assignments: readonly CurrentAssignment[];
  /**
   * The assignments that permit this route in this branch, by id; the first
   * is `assignmentId`. A route with subject scope takes the one whose
   * subjects fit (`inSubjectScope`, task 2.3b-1), a route with class scope
   * the one whose classes fit (`inClassScope`, task 3.1c).
   */
  permitting: readonly CurrentAssignment[];
}

/** Not on the request object: nothing else can set it. */
const ACCESSES = new WeakMap<Request, Access>();

/**
 * What the permission guard allowed, on a route declared with `@Requires`.
 * The branch of a transaction comes from here, never from the path, the query
 * or the body.
 *
 *     list(@CurrentAccess() access: Access) {
 *       return this.transactions.run(access.branchIds, ...);
 *     }
 */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Access => {
    const access = ACCESSES.get(context.switchToHttp().getRequest<Request>());
    if (access === undefined) {
      throw new Error('CurrentAccess was used on a route that is not declared with Requires.');
    }
    return access;
  },
);

const branchHeader = new HeaderPipe(BRANCH_HEADER, branchIdSchema);

/**
 * On every route of the application, after `SessionGuard`
 * (docs/spec/02-roles-and-access.md: "Every request passes one permission
 * check on the server"). A route says who may call it with exactly one
 * declaration; a route with none, or with two, is never run.
 *
 * The roles are those `SessionGuard` read with the session for this request
 * ("Rights are read again on every request"); the table of assignments is not
 * read a second time.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly table: PermissionTable;

  constructor(
    @Inject(PERMISSION_TABLE) table: PermissionTable,
    private readonly transactions: Transactions,
  ) {
    // Whatever table was provided: nothing can widen it while the server runs.
    this.table = freezeTable(table);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const declarations = declarationsOf(handler);
    const [access] = declarations;
    if (access === undefined || declarations.length !== 1) {
      // A fault of the code, answered as one: the route is not run for anybody.
      throw new Error(
        `The route ${context.getClass().name}.${handler.name} has ${String(declarations.length)} access declarations; it needs exactly one.`,
      );
    }
    if (access.kind === 'public') {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const session = sessionOf(request);
    if (session === undefined) {
      throw new Error('The permission guard ran before the session guard.');
    }
    if (access.kind === 'any_signed_in') {
      return true;
    }
    if (owedStepsAllowedOn(handler).length > 0) {
      // Found by the review: such a mark would let a session that has not passed
      // the second step, or still has a first password, act with its roles.
      throw new Error(
        `The route ${context.getClass().name}.${handler.name} needs a permission and is also open to a session that owes a step of sign-in.`,
      );
    }
    const branchId =
      access.branch === 'none'
        ? null
        : branchHeader.transform(request.headers[BRANCH_HEADER.toLowerCase()]).toLowerCase();
    const first = permitting(access, session.assignments, branchId, this.table);
    if (first.length === 0) {
      throw new ApiException('permission_denied', 403);
    }
    // An assignment with a branch proves that the branch exists. The two roles
    // without one could name any uuid; an unknown branch is refused like a
    // branch of somebody else, so the answer does not tell which ids exist.
    // The hidden Monitoring branch is reached by the Super Admin and by the
    // assignments of the branch itself only (task 10.2b, `reachingBranch`).
    let monitoring = false;
    if (branchId !== null && first.some((assignment) => assignment.branchId === null)) {
      const branch = await this.branchOf(branchId);
      if (branch === undefined) {
        throw new ApiException('permission_denied', 403);
      }
      monitoring = branch.monitoring;
    }
    const reaching = reachingBranch(session.assignments, monitoring);
    const assignments =
      branchId === null || !CLASS_SCOPED_AREAS.includes(access.area)
        ? reaching
        : await this.withClasses(reaching, session.accountId, branchId);
    const allowing = permitting(access, assignments, branchId, this.table);
    const [assignment] = allowing;
    if (assignment === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    ACCESSES.set(request, {
      accountId: session.accountId,
      assignmentId: assignment.id,
      role: assignment.role,
      branchId,
      branchIds: branchId === null ? [] : [branchId],
      assignments,
      permitting: allowing,
    });
    return true;
  }

  /**
   * The assignments with the classes of every Tutor assignment of the branch
   * of the request, whether it permits this route or not: a route decides a
   * group of fields from every assignment (task 3.1c, decision 6 of pull
   * request #90). Read on every request ("Rights are read again on every
   * request"), through the branch filter of the request; the session's
   * objects are not changed, and a Tutor assignment of another branch keeps
   * no class. A Teacher assignment of the branch gets the classes and groups
   * the published load in force gives the teacher (task 3.6a, `taughtAt`).
   */
  private async withClasses(
    assignments: readonly CurrentAssignment[],
    accountId: string,
    branchId: string,
  ): Promise<readonly CurrentAssignment[]> {
    const ofBranch = (role: string) =>
      assignments
        .filter(
          (assignment) =>
            assignment.role === role && assignment.branchId?.toLowerCase() === branchId,
        )
        .map((assignment) => assignment.id);
    const tutors = ofBranch('tutor');
    const teachers = ofBranch('teacher');
    if (tutors.length === 0 && teachers.length === 0) {
      return assignments;
    }
    const [classes, taught] = await this.transactions.run([branchId], async (transaction) => [
      await tutorClassesAt(transaction, tutors),
      teachers.length === 0 ? undefined : await taughtAt(transaction, accountId, branchId),
    ]);
    return assignments.map((assignment) => {
      if (tutors.includes(assignment.id)) {
        return Object.freeze({
          ...assignment,
          classIds: Object.freeze(classes.get(assignment.id) ?? []),
        });
      }
      // Task 3.6a (L48): the classes and groups the load in force gives the teacher.
      if (teachers.includes(assignment.id) && taught !== undefined) {
        return Object.freeze({
          ...assignment,
          classIds: Object.freeze([...taught.classIds]),
          groupIds: Object.freeze([...taught.groupIds]),
        });
      }
      return assignment;
    });
  }

  private branchOf(branchId: string): Promise<{ monitoring: boolean } | undefined> {
    // `branches` is school-wide: the names are read without a branch filter.
    return this.transactions.run([], async (transaction) => {
      const found = await transaction
        .selectFrom('branches')
        .select('purpose')
        .where('id', '=', branchId)
        .executeTakeFirst();
      return found === undefined ? undefined : { monitoring: found.purpose === 'monitoring' };
    });
  }
}
