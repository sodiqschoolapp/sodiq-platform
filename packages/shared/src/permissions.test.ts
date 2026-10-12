import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  checkTable,
  freezeTable,
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

// Left open by task 0.7b: the table must not change while the program runs.
describe('a frozen permission table', () => {
  const frozen = freezeTable({
    rooms: rows({ super_admin: ['view'], teacher: ['view'] }),
  });

  it('is the table it was given', () => {
    expect(permits(frozen, 'teacher', 'rooms', 'view')).toBe(true);
    expect(permits(frozen, 'teacher', 'rooms', 'edit')).toBe(false);
  });

  it('refuses a new action for a role, another row and a new area', () => {
    const open = frozen as unknown as Record<string, Record<string, string[]>>;

    expect(() => open.rooms?.teacher?.push('edit')).toThrow(TypeError);
    expect(() => {
      // The test proves `rooms` exists; the assertion keeps the assignment a plain one.
      (open.rooms as Record<string, string[]>).teacher = ['view', 'edit'];
    }).toThrow(TypeError);
    expect(() => {
      open.journal = { teacher: ['edit'] };
    }).toThrow(TypeError);
    expect(permits(frozen, 'teacher', 'rooms', 'edit')).toBe(false);
    expect(permits(frozen, 'teacher', 'journal', 'edit')).toBe(false);
  });

  // Task 1.1: the first two areas (docs/spec/02-roles-and-access.md, Super
  // Admin: "Only this role creates branches, buildings, floors and rooms";
  // Principal: "Changes nothing"; the Academic Vice Principal's view was
  // approved by the owner, pull request #37, answer 5).
  // Task 1.2: `divisions` ("Only this role creates ... divisions"; the view
  // of the Principal and the Academic Vice Principal approved by the owner,
  // pull request #40, answer 5).
  // Task 2.2c-1, decision 2 of pull request #58: `export` in `rooms` and
  // `divisions` for the three roles that view them (`02`, Rules; `12`,
  // Lists: every list has export), and none in `branches`.
  // Task 2.3b-1, decision 8 of pull request #63: view only, for the roles that oversee or need the approver of a subject.
  it('lets five roles view the Head Teacher appointments and nobody change them there', () => {
    const viewers = [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'senior_head_teacher',
      'head_teacher',
    ];
    for (const role of ROLES) {
      expect(PERMISSIONS.head_teachers[role], role).toEqual(viewers.includes(role) ? ['view'] : []);
    }
  });

  // Task 2.4a, decision 2 of pull request #67: the student list and the
  // three groups of readers of edge/people-roles-accounts (Personal data and
  // the audit log).
  it('gives the student list to the roles of 02 and each group of fields to its readers', () => {
    const editors = ['super_admin', 'academic_vice_principal'];
    const viewers = [
      'principal',
      'spiritual_vice_principal',
      'head_tutor',
      'tutor',
      'senior_head_teacher',
      'head_teacher',
    ];
    const groups: Record<string, string[]> = {
      student_contact: [
        'super_admin',
        'principal',
        'academic_vice_principal',
        'spiritual_vice_principal',
        'head_tutor',
      ],
      student_identity: ['super_admin', 'academic_vice_principal'],
      student_financial: ['super_admin', 'principal', 'academic_vice_principal'],
    };
    for (const role of ROLES) {
      const students = editors.includes(role)
        ? ['view', 'create', 'edit']
        : viewers.includes(role)
          ? ['view']
          : [];
      expect(PERMISSIONS.students[role], role).toEqual(students);
      for (const [area, readers] of Object.entries(groups)) {
        const rowsOfArea = PERMISSIONS[area as keyof typeof PERMISSIONS];
        expect(rowsOfArea[role], `${area} ${role}`).toEqual(readers.includes(role) ? ['view'] : []);
      }
    }
  });

  it('gives the Super Admin alone the changes of branches, buildings, floors, rooms, divisions and departments', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual([
      'academic_years',
      'account_access',
      'accounts',
      'branches',
      'calendar',
      'current_period',
      'day_templates',
      'divisions',
      'head_teachers',
      'quarters',
      'rooms',
      'settings',
      'staff',
      'staff_teaching',
      'student_contact',
      'student_financial',
      'student_identity',
      'students',
      'subjects',
      'vacancies',
    ]);
    expect(PERMISSIONS.branches.super_admin).toEqual(['view', 'create', 'edit']);
    expect(PERMISSIONS.rooms.super_admin).toEqual(['view', 'create', 'edit', 'archive', 'export']);
    expect(PERMISSIONS.divisions.super_admin).toEqual([
      'view',
      'create',
      'edit',
      'archive',
      'export',
    ]);
    expect(PERMISSIONS.branches.principal).toEqual(['view']);
    expect(PERMISSIONS.branches.academic_vice_principal).toEqual(['view']);
    for (const area of ['rooms', 'divisions'] as const) {
      expect(PERMISSIONS[area].principal).toEqual(['view', 'export']);
      expect(PERMISSIONS[area].academic_vice_principal).toEqual(['view', 'export']);
    }
    for (const area of ['branches', 'rooms', 'divisions'] as const) {
      for (const role of ROLES) {
        if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
          expect(PERMISSIONS[area][role], `${area}: ${role}`).toEqual([]);
        }
        expect(permits(PERMISSIONS, role, area, 'create')).toBe(role === 'super_admin');
        expect(permits(PERMISSIONS, role, area, 'export')).toBe(
          area !== 'branches' &&
            ['super_admin', 'principal', 'academic_vice_principal'].includes(role),
        );
      }
    }
  });

  // Task 1.3: the owner's answer 3 (docs/decisions.md, "Decided ahead for
  // tasks 1.3 to 1.6"): `academic_years` — Super Admin view, create, edit;
  // Principal and Academic Vice Principal view. `quarters` — Super Admin and
  // Academic Vice Principal view, edit; Principal view.
  it('gives the years to the Super Admin and the quarters to the Super Admin and the Academic Vice Principal', () => {
    expect(PERMISSIONS.academic_years.super_admin).toEqual(['view', 'create', 'edit']);
    expect(PERMISSIONS.academic_years.principal).toEqual(['view']);
    expect(PERMISSIONS.academic_years.academic_vice_principal).toEqual(['view']);
    expect(PERMISSIONS.quarters.super_admin).toEqual(['view', 'edit']);
    expect(PERMISSIONS.quarters.principal).toEqual(['view']);
    expect(PERMISSIONS.quarters.academic_vice_principal).toEqual(['view', 'edit']);
    for (const area of ['academic_years', 'quarters'] as const) {
      for (const role of ROLES) {
        if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
          expect(PERMISSIONS[area][role], `${area}: ${role}`).toEqual([]);
        }
        expect(permits(PERMISSIONS, role, area, 'archive')).toBe(false);
        expect(permits(PERMISSIONS, role, area, 'export')).toBe(false);
      }
    }
  });

  // Task 1.5: the owner's answer 14: `day_templates` (slot types and
  // templates together) — Super Admin and Academic Vice Principal view,
  // create, edit, archive; Principal view.
  it('gives the slot types and day templates to the Super Admin and the Academic Vice Principal', () => {
    const all = ['view', 'create', 'edit', 'archive'];
    expect(PERMISSIONS.day_templates.super_admin).toEqual(all);
    expect(PERMISSIONS.day_templates.academic_vice_principal).toEqual(all);
    expect(PERMISSIONS.day_templates.principal).toEqual(['view']);
    for (const role of ROLES) {
      if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
        expect(PERMISSIONS.day_templates[role], role).toEqual([]);
      }
      expect(permits(PERMISSIONS, role, 'day_templates', 'export')).toBe(false);
    }
  });

  // Task 1.4: the owner's answer 18: `calendar` — Super Admin and Academic
  // Vice Principal view, create, edit, archive; Principal view.
  it('gives the calendar to the Super Admin and the Academic Vice Principal', () => {
    const all = ['view', 'create', 'edit', 'archive'];
    expect(PERMISSIONS.calendar.super_admin).toEqual(all);
    expect(PERMISSIONS.calendar.academic_vice_principal).toEqual(all);
    expect(PERMISSIONS.calendar.principal).toEqual(['view']);
    for (const role of ROLES) {
      if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
        expect(PERMISSIONS.calendar[role], role).toEqual([]);
      }
      expect(permits(PERMISSIONS, role, 'calendar', 'export')).toBe(false);
    }
  });

  // Task 2.1: the owner's answer 4 and decision 1 of pull request #52:
  // `subjects` — Super Admin and Academic Vice Principal view, create, edit,
  // archive; Principal view; nobody else. Task 2.2c-1, decision 2 of pull
  // request #58: `export` for the three.
  it('gives the subjects to the Super Admin and the Academic Vice Principal', () => {
    const all = ['view', 'create', 'edit', 'archive', 'export'];
    expect(PERMISSIONS.subjects.super_admin).toEqual(all);
    expect(PERMISSIONS.subjects.academic_vice_principal).toEqual(all);
    expect(PERMISSIONS.subjects.principal).toEqual(['view', 'export']);
    for (const role of ROLES) {
      if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
        expect(PERMISSIONS.subjects[role], role).toEqual([]);
      }
      expect(permits(PERMISSIONS, role, 'subjects', 'export')).toBe(
        ['super_admin', 'principal', 'academic_vice_principal'].includes(role),
      );
    }
  });

  // Task 2.2a, decision 2 of pull request #53 (confirmed at its review):
  // `staff` — the Super Admin views, creates and edits; the Academic Vice
  // Principal views and edits (the server keeps that edit to name, phone and
  // email); the Principal views. `staff_teaching` — subjects, grades and
  // languages: the Super Admin and the Academic Vice Principal view and edit;
  // the Principal views. Nobody else. Task 2.2c-1, decision 2 of pull request
  // #58: `export` in `staff` for the three; none in `staff_teaching`, which
  // has no list.
  it('gives the staff records to the Super Admin, the Academic Vice Principal and the Principal', () => {
    expect(PERMISSIONS.staff.super_admin).toEqual(['view', 'create', 'edit', 'export']);
    expect(PERMISSIONS.staff.academic_vice_principal).toEqual(['view', 'edit', 'export']);
    expect(PERMISSIONS.staff.principal).toEqual(['view', 'export']);
    expect(PERMISSIONS.staff_teaching.super_admin).toEqual(['view', 'edit']);
    expect(PERMISSIONS.staff_teaching.academic_vice_principal).toEqual(['view', 'edit']);
    expect(PERMISSIONS.staff_teaching.principal).toEqual(['view']);
    for (const role of ROLES) {
      for (const area of ['staff', 'staff_teaching'] as const) {
        if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
          expect(PERMISSIONS[area][role], role).toEqual([]);
        }
        expect(permits(PERMISSIONS, role, area, 'export')).toBe(
          area === 'staff' &&
            ['super_admin', 'principal', 'academic_vice_principal'].includes(role),
        );
        expect(permits(PERMISSIONS, role, area, 'archive')).toBe(false);
      }
    }
  });

  // Task 2.3a, decision 4 of pull request #62: `accounts` — the Super Admin
  // views, creates accounts and gives and ends roles ("The Super Admin creates
  // staff accounts and gives all roles", Who can act); the Principal views.
  // Nobody else, the Academic Vice Principal included.
  it('gives the accounts to the Super Admin, and their view to the Principal', () => {
    expect(PERMISSIONS.accounts.super_admin).toEqual(['view', 'create', 'edit']);
    expect(PERMISSIONS.accounts.principal).toEqual(['view']);
    for (const role of ROLES) {
      if (!['super_admin', 'principal'].includes(role)) {
        expect(PERMISSIONS.accounts[role], role).toEqual([]);
      }
      for (const action of ['create', 'edit'] as const) {
        expect(permits(PERMISSIONS, role, 'accounts', action)).toBe(role === 'super_admin');
      }
    }
  });

  // Task 2.3c-1, decision 2 of pull request #65 (Look first): `account_access` —
  // the Super Admin and the Academic Vice Principal view the sign-in access of
  // an account and lock, unlock and reset it (`edit`; Who can act: "He may
  // reset passwords and lock accounts only for Teachers, Tutors, Head Teachers
  // and the Head Tutor of his branch", decided further on the server); the
  // Principal views. Nobody else.
  it('gives the sign-in access to the Super Admin and the Academic Vice Principal, its view to the Principal', () => {
    expect(PERMISSIONS.account_access.super_admin).toEqual(['view', 'edit']);
    expect(PERMISSIONS.account_access.academic_vice_principal).toEqual(['view', 'edit']);
    expect(PERMISSIONS.account_access.principal).toEqual(['view']);
    for (const role of ROLES) {
      if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
        expect(PERMISSIONS.account_access[role], role).toEqual([]);
      }
      expect(permits(PERMISSIONS, role, 'account_access', 'edit')).toBe(
        role === 'super_admin' || role === 'academic_vice_principal',
      );
    }
  });

  // Task 2.2b, decision 1 of pull request #57: `vacancies` — the Super Admin
  // and the Academic Vice Principal view, create, edit and archive (close,
  // reopen, delete); the Principal views. Nobody else. Task 2.2c-1, decision
  // 2 of pull request #58: `export` for the three.
  it('gives the vacancies to the Super Admin, the Academic Vice Principal and the Principal', () => {
    const all = ['view', 'create', 'edit', 'archive', 'export'];
    expect(PERMISSIONS.vacancies.super_admin).toEqual(all);
    expect(PERMISSIONS.vacancies.academic_vice_principal).toEqual(all);
    expect(PERMISSIONS.vacancies.principal).toEqual(['view', 'export']);
    for (const role of ROLES) {
      if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
        expect(PERMISSIONS.vacancies[role], role).toEqual([]);
      }
      expect(permits(PERMISSIONS, role, 'vacancies', 'export')).toBe(
        ['super_admin', 'principal', 'academic_vice_principal'].includes(role),
      );
    }
  });

  // Task 1.6: the owner's answer 24: `settings` — Super Admin and Academic
  // Vice Principal view, edit; Principal view. Travel time stays under
  // `branches`, whose rows do not change.
  it('gives the settings to the Super Admin and the Academic Vice Principal', () => {
    expect(PERMISSIONS.settings.super_admin).toEqual(['view', 'edit']);
    expect(PERMISSIONS.settings.academic_vice_principal).toEqual(['view', 'edit']);
    expect(PERMISSIONS.settings.principal).toEqual(['view']);
    for (const role of ROLES) {
      if (!['super_admin', 'principal', 'academic_vice_principal'].includes(role)) {
        expect(PERMISSIONS.settings[role], role).toEqual([]);
      }
      for (const action of ['create', 'archive', 'export'] as const) {
        expect(permits(PERMISSIONS, role, 'settings', action)).toBe(false);
      }
    }
    expect(PERMISSIONS.branches.super_admin).toEqual(['view', 'create', 'edit']);
    expect(PERMISSIONS.branches.principal).toEqual(['view']);
    expect(PERMISSIONS.branches.academic_vice_principal).toEqual(['view']);
  });

  // Task 1.3, decision 8 of pull request #44: the year and quarter of the top
  // bar for every role (`03`; `12`, Context), and nothing else.
  it('lets every role read the year and quarter of the top bar and change nothing there', () => {
    for (const role of ROLES) {
      expect(PERMISSIONS.current_period[role], role).toEqual(['view']);
    }
  });

  it('is what the application reads', () => {
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    for (const areaRows of Object.values<PermissionRows>(PERMISSIONS)) {
      expect(Object.isFrozen(areaRows)).toBe(true);
      for (const actions of Object.values(areaRows)) {
        expect(Object.isFrozen(actions)).toBe(true);
      }
    }
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
