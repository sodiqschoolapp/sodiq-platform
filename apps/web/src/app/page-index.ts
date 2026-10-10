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

/** The pages under "School setup" (tasks 1.1 and 1.2), indexed when the menu of the role has the item. */
export const SETUP_PAGES: readonly IndexedPage[] = [
  { titleKey: 'setup.branch.title', to: '/setup/branch' },
  { titleKey: 'setup.buildings.title', to: '/setup/buildings' },
  { titleKey: 'setup.rooms.title', to: '/setup/rooms' },
  { titleKey: 'setup.divisions.title', to: '/setup/divisions' },
];

/** Everything the search of a role lists: its menu pages, the pages under them, the common ones. */
export function indexedPages(menuPages: readonly IndexedPage[]): IndexedPage[] {
  const setup = menuPages.some((page) => page.to === '/setup') ? SETUP_PAGES : [];
  return [...menuPages, ...setup, ...COMMON_PAGES];
}
