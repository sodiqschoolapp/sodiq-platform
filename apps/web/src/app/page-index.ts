import type { Action } from '@sodiq/shared';
import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';

export interface IndexedPage {
  /** The key of the title of the page, as its heading shows it. */
  titleKey: ParseKeys;
  to: LinkProps['to'];
}

/**
 * The pages the Ctrl+K search knows besides the menu of the active role
 * (docs/spec/12-ux-standards.md, One pattern everywhere, Search: "Ctrl+K opens
 * a search across students, staff, classes, groups and pages"): the pages
 * every role has. The pages of the menu come from `useMenuPages`, so the search
 * never lists a page the menu of the role does not (task 0.8c); the records
 * come with the tasks that build them, each with the rights of the role.
 */
export const COMMON_PAGES: readonly IndexedPage[] = [
  { titleKey: 'account.title', to: '/account' },
  { titleKey: 'password.titleOwn', to: '/account/password' },
  // The sample of the shared patterns exists in development only (task 0.8b-1).
  ...(import.meta.env.DEV ? [{ titleKey: 'sample.title', to: '/dev/patterns' } as const] : []),
];

/**
 * The pages under "School setup" (tasks 1.1 to 1.6, subjects from task 2.1),
 * indexed when the menu of the role has the item. A page that only some roles
 * of the menu may open names its area and action (the Branches list, task
 * 2.7c-3, decision 13): the search never lists a page the role cannot open.
 */
export const SETUP_PAGES: readonly (IndexedPage & { area?: string; action?: Action })[] = [
  { titleKey: 'setup.branches.title', to: '/setup/branches', area: 'branches', action: 'create' },
  { titleKey: 'setup.branch.title', to: '/setup/branch' },
  { titleKey: 'setup.buildings.title', to: '/setup/buildings' },
  { titleKey: 'setup.rooms.title', to: '/setup/rooms' },
  { titleKey: 'setup.divisions.title', to: '/setup/divisions' },
  { titleKey: 'setup.years.title', to: '/setup/years' },
  { titleKey: 'setup.slotTypes.title', to: '/setup/slot-types' },
  { titleKey: 'setup.dayTemplates.title', to: '/setup/day-templates' },
  { titleKey: 'setup.templateSettings.title', to: '/setup/day-template-settings' },
  { titleKey: 'setup.calendar.title', to: '/setup/calendar' },
  { titleKey: 'setup.settings.title', to: '/setup/settings' },
  { titleKey: 'setup.travelTimes.title', to: '/setup/travel-times' },
  { titleKey: 'setup.subjects.title', to: '/setup/subjects' },
];

/** The pages under "People" (task 2.2a), each with the area the role must view. */
export const PEOPLE_PAGES: readonly (IndexedPage & { area: string })[] = [
  { titleKey: 'people.staff.title', to: '/people/staff', area: 'staff' },
  { titleKey: 'people.students.title', to: '/people/students', area: 'students' },
  { titleKey: 'people.relatives.title', to: '/people/parents', area: 'relatives' },
  { titleKey: 'people.vacancies.title', to: '/people/vacancies', area: 'vacancies' },
  { titleKey: 'people.headTeachers.title', to: '/people/head-teachers', area: 'head_teachers' },
  { titleKey: 'people.neverUsed.title', to: '/people/never-used', area: 'account_access' },
];

/**
 * The pages under "Classes" (task 3.2a): the Groups list, reached from the
 * Classes page, indexed when the menu of the role has the item and the role
 * views groups.
 */
export const CLASS_PAGES: readonly (IndexedPage & { area: string; action?: Action })[] = [
  { titleKey: 'groups.title', to: '/groups', area: 'groups' },
  // Task 3.2b: the bulk placement screen, for the roles that place.
  { titleKey: 'groups.placement.title', to: '/groups/placement', area: 'groups', action: 'edit' },
];

/** The pages under "Timetable" (task 3.4a), indexed when the menu of the role has the item. */
export const TIMETABLE_PAGES: readonly IndexedPage[] = [
  { titleKey: 'timetable.load.title', to: '/timetable/load' },
];

/** Everything the search of a role lists: its menu pages, the pages under them, the common ones. */
export function indexedPages(
  menuPages: readonly IndexedPage[],
  views: (area: string, action?: Action) => boolean = () => true,
): IndexedPage[] {
  const setup = menuPages.some((page) => page.to === '/setup')
    ? SETUP_PAGES.filter((page) => page.area === undefined || views(page.area, page.action)).map(
        ({ titleKey, to }) => ({ titleKey, to }),
      )
    : [];
  const people = menuPages.some((page) => page.to === '/people')
    ? PEOPLE_PAGES.filter((page) => views(page.area)).map(({ titleKey, to }) => ({ titleKey, to }))
    : [];
  const classes = menuPages.some((page) => page.to === '/classes')
    ? CLASS_PAGES.filter((page) => views(page.area, page.action)).map(({ titleKey, to }) => ({
        titleKey,
        to,
      }))
    : [];
  // The menu shows "Timetable" only to the roles that view the area.
  const timetable = menuPages.some((page) => page.to === '/timetable') ? TIMETABLE_PAGES : [];
  return [...menuPages, ...setup, ...people, ...classes, ...timetable, ...COMMON_PAGES];
}
