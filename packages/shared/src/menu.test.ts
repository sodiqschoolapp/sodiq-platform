import { describe, expect, it } from 'vitest';
import { freezeTable, type PermissionRows, type PermissionTable } from './permissions.js';
import { HOME_KIND, MENU, MENU_ITEMS, MENU_MAX_ITEMS, visibleMenu, type MenuItem } from './menu.js';
import { ROLES, type Role } from './roles.js';

/** Written out by hand from the approved table of pull request #27. */
const EXPECTED: Record<Role, MenuItem[]> = {
  super_admin: [
    'home',
    'setup',
    'people',
    'classes',
    'timetable',
    'journal',
    'results',
    'plans',
    'requests',
  ],
  principal: ['home', 'setup', 'people', 'classes', 'timetable', 'journal', 'results', 'plans'],
  academic_vice_principal: [
    'home',
    'setup',
    'people',
    'classes',
    'timetable',
    'journal',
    'results',
    'plans',
    'requests',
  ],
  spiritual_vice_principal: ['home', 'people', 'classes', 'timetable', 'journal', 'results'],
  head_tutor: ['home', 'people', 'classes', 'timetable', 'journal', 'results'],
  tutor: ['home', 'people', 'timetable', 'journal', 'results'],
  senior_head_teacher: [
    'home',
    'people',
    'classes',
    'timetable',
    'journal',
    'results',
    'plans',
    'requests',
  ],
  head_teacher: [
    'home',
    'people',
    'classes',
    'timetable',
    'journal',
    'results',
    'plans',
    'requests',
  ],
  teacher: ['home', 'timetable', 'journal', 'plans', 'results'],
  student: ['home'],
  parent: ['home'],
  hr: ['home'],
  nurse: ['home'],
  psychologist: ['home'],
  librarian: ['home'],
};

const EVERYTHING = new Set<MenuItem>(MENU_ITEMS);

describe('the menu per role', () => {
  it('is the approved table for each of the 15 roles', () => {
    for (const role of ROLES) {
      expect(MENU[role], role).toEqual(EXPECTED[role]);
    }
  });

  it('has no more than about ten items, each once, home first', () => {
    for (const role of ROLES) {
      const items = MENU[role];
      expect(items.length, role).toBeLessThanOrEqual(MENU_MAX_ITEMS);
      expect(new Set(items).size, role).toBe(items.length);
      expect(items[0], role).toBe('home');
    }
  });

  it('gives the Super Admin every item of every other role', () => {
    for (const role of ROLES) {
      for (const item of MENU[role]) {
        expect(MENU.super_admin, `${role} ${item}`).toContain(item);
      }
    }
  });

  it('has a kind of home page for each role', () => {
    expect(HOME_KIND.teacher).toBe('teaching');
    expect(HOME_KIND.head_teacher).toBe('teaching');
    expect(HOME_KIND.senior_head_teacher).toBe('teaching');
    expect(HOME_KIND.tutor).toBe('tutor');
    expect(HOME_KIND.head_tutor).toBe('attendance_overview');
    expect(HOME_KIND.spiritual_vice_principal).toBe('attendance_overview');
    expect(HOME_KIND.academic_vice_principal).toBe('academic_vice_principal');
    expect(HOME_KIND.principal).toBe('branch_summary');
    expect(HOME_KIND.super_admin).toBe('branch_summary');
    for (const role of ['student', 'parent', 'hr', 'nurse', 'psychologist', 'librarian'] as const) {
      expect(HOME_KIND[role]).toBe('later_release');
    }
  });
});

describe('the menu a role sees', () => {
  const rowsWith = (allowed: readonly Role[]): PermissionRows =>
    ({
      ...Object.fromEntries(ROLES.map((role) => [role, []])),
      ...Object.fromEntries(allowed.map((role) => [role, ['view']])),
    }) as unknown as PermissionRows;

  it('is home alone while no page is built', () => {
    for (const role of ROLES) {
      expect(visibleMenu(role, new Set(), {}), role).toEqual(['home']);
    }
  });

  it('lists the built items of the row, in the order of the row', () => {
    expect(visibleMenu('teacher', new Set(['journal', 'timetable']), {})).toEqual([
      'home',
      'timetable',
      'journal',
    ]);
  });

  it('never adds an item the row does not have', () => {
    expect(visibleMenu('teacher', EVERYTHING, {})).toEqual(EXPECTED.teacher);
  });

  it('drops an item whose area the permission table does not give the role to view', () => {
    const table = freezeTable({
      journal: rowsWith(['teacher']),
    } as const satisfies PermissionTable);

    expect(visibleMenu('teacher', EVERYTHING, table)).toContain('journal');
    expect(visibleMenu('tutor', EVERYTHING, table)).not.toContain('journal');
    expect(visibleMenu('tutor', EVERYTHING, table)).toContain('timetable');
  });
});
