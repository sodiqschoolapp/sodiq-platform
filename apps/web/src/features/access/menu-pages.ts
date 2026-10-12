import { MENU_ITEMS, type MenuItem } from '@sodiq/shared';
import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';

export interface MenuPage {
  titleKey: ParseKeys;
  to: LinkProps['to'];
  /**
   * The areas of the pages under the item, when it is an entry page whose
   * item has no area of its own: the item shows only when the role views one
   * of them (task 2.2a: "People" for a role that sees no list of people yet
   * would lead to an empty page).
   */
  areas?: readonly string[];
}

/**
 * The pages of the menu that are built. A menu item appears only when its page
 * exists (decided by the owner at the plan of task 0.8c); each later task adds
 * its item here with its page, and the menu table of `packages/shared` already
 * says which roles see it. `setup` came with task 1.1, `people` with 2.2a.
 */
export const BUILT_PAGES: Partial<Record<MenuItem, MenuPage>> = {
  home: { titleKey: 'menu.home', to: '/' },
  setup: { titleKey: 'menu.setup', to: '/setup' },
  people: { titleKey: 'menu.people', to: '/people', areas: ['staff'] },
};

export const BUILT_ITEMS: ReadonlySet<MenuItem> = new Set(
  MENU_ITEMS.filter((item) => BUILT_PAGES[item] !== undefined),
);
