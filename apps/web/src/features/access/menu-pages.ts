import { MENU_ITEMS, type MenuItem } from '@sodiq/shared';
import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import {
  AssignmentIcon,
  BarChartIcon,
  CalendarMonthIcon,
  ForumIcon,
  GridViewIcon,
  GroupIcon,
  HomeIcon,
  MenuBookIcon,
  TuneIcon,
  type IconProps,
} from '@/components/icons';

type Icon = (props: IconProps) => React.JSX.Element;

/**
 * docs/design-system.md, This app, Menu icons: each item of the menu table of
 * `packages/shared` with its icon. Typed over every item, so an item added to
 * the table without an icon fails the type-check.
 */
export const MENU_ICONS: Record<MenuItem, Icon> = {
  home: HomeIcon,
  setup: TuneIcon,
  // The entry page of the staff lists (and of the students, task 2.4).
  people: GroupIcon,
  classes: GridViewIcon,
  timetable: CalendarMonthIcon,
  journal: MenuBookIcon,
  results: BarChartIcon,
  plans: AssignmentIcon,
  requests: ForumIcon,
};

export interface MenuPage {
  titleKey: ParseKeys;
  to: LinkProps['to'];
  icon: Icon;
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
  home: { titleKey: 'menu.home', to: '/', icon: MENU_ICONS.home },
  setup: { titleKey: 'menu.setup', to: '/setup', icon: MENU_ICONS.setup },
  people: {
    titleKey: 'menu.people',
    to: '/people',
    icon: MENU_ICONS.people,
    // Head Teachers and Senior Head Teachers view no staff list, only the
    // Head Teachers section (task 2.3b-2, decision 7 of #64); the Vice
    // Principal for Spiritual and Moral Education, the Head Tutor and the
    // Tutor only the students (task 2.4a).
    areas: ['staff', 'head_teachers', 'students'],
  },
};

export const BUILT_ITEMS: ReadonlySet<MenuItem> = new Set(
  MENU_ITEMS.filter((item) => BUILT_PAGES[item] !== undefined),
);
