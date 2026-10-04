import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  checkTable,
  PERMISSIONS,
  permits,
  type Action,
  type PermissionRows,
  type PermissionTable,
} from './permissions.js';
import { ROLES, type Role } from './roles.js';

/** A row for each of the 15 roles: nothing, unless named. */
function rows(named: Partial<Record<Role, readonly Action[]>>): PermissionRows {
  return Object.fromEntries(ROLES.map((role) => [role, named[role] ?? []])) as PermissionRows;
}

const SOUND: PermissionTable = {
  rooms: rows({
    super_admin: ['view', 'create', 'edit', 'archive', 'export'],
    principal: ['view', 'export'],
    academic_vice_principal: ['view', 'edit'],
    teacher: ['view'],
  }),
};

// docs/spec/02-roles-and-access.md, Rules: "Permissions are a table: rows are
// roles, columns are actions (view, create, edit, archive, export) per area."
describe('the permission table', () => {
  it('has the five actions of the spec', () => {
    expect(ACTIONS).toEqual(['view', 'create', 'edit', 'archive', 'export']);
  });

  it('gives a role the actions of its row and no other', () => {
    expect(permits(SOUND, 'academic_vice_principal', 'rooms', 'edit')).toBe(true);
    expect(permits(SOUND, 'academic_vice_principal', 'rooms', 'archive')).toBe(false);
    expect(permits(SOUND, 'teacher', 'rooms', 'view')).toBe(true);
    expect(permits(SOUND, 'teacher', 'rooms', 'edit')).toBe(false);
    expect(permits(SOUND, 'student', 'rooms', 'view')).toBe(false);
  });

  it.each(['journal', 'constructor', 'toString', '__proto__', ''])(
    'gives nothing in the area "%s", which it does not have',
    (area) => {
      for (const role of ROLES) {
        for (const action of ACTIONS) {
          expect(permits(SOUND, role, area, action)).toBe(false);
        }
      }
    },
  );

  it('gives nothing to a role whose row is missing', () => {
    const broken = { rooms: { teacher: ['view'] } } as unknown as PermissionTable;

    expect(permits(broken, 'tutor', 'rooms', 'view')).toBe(false);
    expect(permits(broken, 'teacher', 'rooms', 'view')).toBe(true);
  });
});

describe('the rules no permission table may break', () => {
  it('are kept by a sound table', () => {
    expect(checkTable(SOUND)).toEqual([]);
  });

  it('are kept by the table of the application', () => {
    expect(checkTable(PERMISSIONS)).toEqual([]);
  });

  it('name a role without a row: an empty list is written out', () => {
    const others = Object.fromEntries(
      Object.entries(rows({})).filter(([role]) => role !== 'librarian'),
    );
    const table = { rooms: others } as unknown as PermissionTable;

    expect(checkTable(table)).toEqual(['rooms: no row for librarian']);
  });

  it('name a role and an action that do not exist', () => {
    const table = {
      rooms: { ...rows({ super_admin: ['view'] }), accountant: [], teacher: ['delete'] },
    } as unknown as PermissionTable;

    expect(checkTable(table)).toEqual([
      'rooms: teacher has delete, which is not an action',
      'rooms: accountant is not a role',
      'rooms: teacher has delete and the Super Admin does not',
    ]);
  });

  // Roles table: the Principal "changes nothing". Edge cases, "Who can act":
  // "Exports are allowed"; "Personal data and the audit log", last row: "the
  // Principal has no edit rights".
  it.each(['create', 'edit', 'archive'] as const)('name a Principal who may %s', (action) => {
    const table: PermissionTable = {
      rooms: rows({ super_admin: [...ACTIONS], principal: ['view', 'export', action] }),
    };

    expect(checkTable(table)).toEqual([`rooms: the Principal has ${action}`]);
  });

  // Roles table, Super Admin: "Everything every other role can do".
  it('name an action that another role has and the Super Admin has not', () => {
    const table: PermissionTable = {
      rooms: rows({ super_admin: ['view'], teacher: ['view'] }),
      plans: rows({ super_admin: ['view', 'edit'], head_teacher: ['view', 'edit', 'export'] }),
    };

    expect(checkTable(table)).toEqual([
      'plans: head_teacher has export and the Super Admin does not',
    ]);
  });
});
