import {
  PERMISSIONS,
  permits,
  ROLES,
  SCHOOL_WIDE_ROLES,
  roleSchema,
  type Role,
  type SessionResponse,
} from '@sodiq/shared';

/** The role and the branch on display in one tab (`edge/people-roles-accounts`: kept per tab). */
export interface Chosen {
  role: Role | null;
  branchId: string | null;
}

export interface View {
  /** The roles the account holds now, once each, in the order of the table of `02`. */
  roles: Role[];
  role: Role | null;
  /** The branches that suit the active role, by name. */
  branches: SessionResponse['branches'];
  branchId: string | null;
}

/**
 * What the tab shows, from what the server says the account holds and what the
 * tab chose. A choice the account no longer holds falls back to the default:
 * the first role of the table of `02`, and the first branch that suits it. A
 * role of a branch suits the branches of its assignments; the two roles that
 * work across branches suit every branch. Display only.
 */
export function resolveView(
  session: Pick<SessionResponse, 'assignments' | 'branches'> | null,
  chosen: Chosen,
): View {
  const assignments = session?.assignments ?? [];
  // The order of the table of `02` holds here on its own, whatever order came in.
  const roles = ROLES.filter((held) => assignments.some(({ role }) => role === held));
  const role =
    chosen.role !== null && roles.includes(chosen.role) ? chosen.role : (roles[0] ?? null);
  const all = session?.branches ?? [];
  const branches =
    role === null || SCHOOL_WIDE_ROLES.includes(role)
      ? all
      : all.filter((branch) =>
          assignments.some(
            (assignment) => assignment.role === role && assignment.branchId === branch.id,
          ),
        );
  const branchId =
    chosen.branchId !== null && branches.some((branch) => branch.id === chosen.branchId)
      ? chosen.branchId
      : (branches[0]?.id ?? null);
  return { roles, role, branches, branchId };
}

/**
 * Whether the page of an area may be opened in the branch of the tab: the
 * server's own reading (`.claude/rules/api.md`: "The guard allows a request
 * when any current assignment of the account permits it"), so a person with
 * two roles is never refused here what the server serves, whatever role is on
 * display. Display only: the server checks every call (task 2.7a, finding 4).
 */
export function mayView(
  session: Pick<SessionResponse, 'assignments'> | null,
  branchId: string | null,
  area: string,
): boolean {
  return (session?.assignments ?? []).some(
    (assignment) =>
      permits(PERMISSIONS, assignment.role, area, 'view') &&
      ((assignment.branchId === null && SCHOOL_WIDE_ROLES.includes(assignment.role)) ||
        (branchId !== null && assignment.branchId === branchId)),
  );
}

export const isRole = (value: unknown): value is Role => roleSchema.safeParse(value).success;
