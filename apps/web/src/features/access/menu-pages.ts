import { MENU_ITEMS, type MenuItem } from '@sodiq/shared';
import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';

export interface MenuPage {
  titleKey: ParseKeys;
  to: LinkProps['to'];
}

/**
 * The pages of the menu that are built. A menu item appears only when its page
 * exists (decided by the owner at the plan of task 0.8c); each later task adds
 * its item here with its page, and the menu table of `packages/shared` already
 * says which roles see it. `home` is the only one now.
 */
export const BUILT_PAGES: Partial<Record<MenuItem, MenuPage>> = {
  home: { titleKey: 'menu.home', to: '/' },
};

export const BUILT_ITEMS: ReadonlySet<MenuItem> = new Set(
  MENU_ITEMS.filter((item) => BUILT_PAGES[item] !== undefined),
);
