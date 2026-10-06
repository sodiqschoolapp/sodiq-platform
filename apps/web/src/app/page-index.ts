import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';

export interface IndexedPage {
  /** The key of the title of the page, as its heading shows it. */
  titleKey: ParseKeys;
  to: LinkProps['to'];
}

/**
 * The pages the Ctrl+K search knows (docs/spec/12-ux-standards.md, One pattern
 * everywhere, Search: "Ctrl+K opens a search across students, staff, classes,
 * groups and pages"; task 0.8b-3: pages only). Task 0.8c filters this list by
 * the menu of the role and adds the pages of the menus; the records come with
 * the tasks that build them, each with the rights of the role.
 */
export const PAGE_INDEX: readonly IndexedPage[] = [
  { titleKey: 'home.title', to: '/' },
  { titleKey: 'password.titleOwn', to: '/password' },
  // The sample of the shared patterns exists in development only (task 0.8b-1).
  ...(import.meta.env.DEV ? [{ titleKey: 'sample.title', to: '/dev/patterns' } as const] : []),
];
