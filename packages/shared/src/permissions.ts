import { ROLES, type Role } from './roles.js';

/**
 * docs/spec/02-roles-and-access.md, Rules: "Permissions are a table: rows are
 * roles, columns are actions (view, create, edit, archive, export) per area."
 */
export const ACTIONS = ['view', 'create', 'edit', 'archive', 'export'] as const;

export type Action = (typeof ACTIONS)[number];

/** One area of the table: for each of the 15 roles, the actions it may take. */
export type PermissionRows = Readonly<Record<Role, readonly Action[]>>;

export type PermissionTable = Readonly<Record<string, PermissionRows>>;

/**
 * The table of the application, fixed in code for the 15 roles. It has no area
 * yet: each task adds the rows of its area with its first route, and writes
 * out an empty list for a role that may do nothing there. The server guard
 * reads it for every request; the menus read the same table.
 */
export const PERMISSIONS = {} as const satisfies PermissionTable;

export type Area = keyof typeof PERMISSIONS;

/** Whether the table gives the role this action in this area. An unknown area gives nothing. */
export function permits(table: PermissionTable, role: Role, area: string, action: Action): boolean {
  if (!Object.hasOwn(table, area)) {
    return false;
  }
  const rows: Partial<PermissionRows> | undefined = table[area];
  return rows !== undefined && Object.hasOwn(rows, role) && (rows[role]?.includes(action) ?? false);
}

/** The Principal "views everything in the branch ... changes nothing"; exports are allowed. */
const PRINCIPAL_ACTIONS: readonly Action[] = ['view', 'export'];

/**
 * The rules no table may break, each named with its area when it is broken; an
 * empty list means the table is sound.
 *
 * - Every area has a row for each of the 15 roles and names only known roles
 *   and actions.
 * - The Principal has no action but view and export (edge cases, "Who can
 *   act" and the last row of "Personal data and the audit log": "the Principal
 *   has no edit rights").
 * - The Super Admin has every action that any other role has: "Everything
 *   every other role can do".
 */
export function checkTable(table: PermissionTable): string[] {
  const problems: string[] = [];
  const known = new Set<string>(ROLES);
  const actions = new Set<string>(ACTIONS);
  for (const [area, rows] of Object.entries(table)) {
    const written: Partial<Record<string, readonly string[]>> = rows;
    for (const role of ROLES) {
      if (!Object.hasOwn(written, role)) {
        problems.push(`${area}: no row for ${role}`);
      }
    }
    for (const [role, allowed] of Object.entries(written)) {
      if (!known.has(role)) {
        problems.push(`${area}: ${role} is not a role`);
      }
      for (const action of allowed ?? []) {
        if (!actions.has(action)) {
          problems.push(`${area}: ${role} has ${action}, which is not an action`);
        }
      }
    }
    for (const action of written.principal ?? []) {
      if (!PRINCIPAL_ACTIONS.some((allowed) => allowed === action)) {
        problems.push(`${area}: the Principal has ${action}`);
      }
    }
    const superAdmin = new Set(written.super_admin ?? []);
    for (const role of ROLES) {
      for (const action of written[role] ?? []) {
        if (!superAdmin.has(action)) {
          problems.push(`${area}: ${role} has ${action} and the Super Admin does not`);
        }
      }
    }
  }
  return problems;
}
