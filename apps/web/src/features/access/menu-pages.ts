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
  HistoryIcon,
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
  // Task 2.6a, decision 9 of pull request #75.
  audit_log: HistoryIcon,
};

export interface MenuPage {
  titleKey: ParseKeys;
  /** The label of the phone tab bar (issue #105, H16): short enough for 360 px. */
  shortKey: ParseKeys;
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
 * says which roles see it. `setup` came with task 1.1, `people` with 2.2a,
 * `audit_log` with 2.6a.
 */
export const BUILT_PAGES: Partial<Record<MenuItem, MenuPage>> = {
  home: { titleKey: 'menu.home', shortKey: 'menu.short.home', to: '/', icon: MENU_ICONS.home },
  setup: {
    titleKey: 'menu.setup',
    shortKey: 'menu.short.setup',
    to: '/setup',
    icon: MENU_ICONS.setup,
  },
  people: {
    titleKey: 'menu.people',
    shortKey: 'menu.short.people',
    to: '/people',
    icon: MENU_ICONS.people,
    // Head Teachers and Senior Head Teachers view no staff list, only the
    // Head Teachers section (task 2.3b-2, decision 7 of #64); the Vice
    // Principal for Spiritual and Moral Education, the Head Tutor and the
    // Tutor only the students (task 2.4a).
    areas: ['staff', 'head_teachers', 'students'],
  },
  // The classes (task 3.1a): the area `classes` of the same name decides who sees it.
  classes: {
    titleKey: 'menu.classes',
    shortKey: 'menu.short.classes',
    to: '/classes',
    icon: MENU_ICONS.classes,
  },
  // The timetable (task 3.4a): the area `timetable` of the same name decides who sees it.
  timetable: {
    titleKey: 'menu.timetable',
    shortKey: 'menu.short.timetable',
    to: '/timetable',
    icon: MENU_ICONS.timetable,
  },
  // The journals (task 6.2): the area `journal` of the same name decides who sees it.
  journal: {
    titleKey: 'menu.journal',
    shortKey: 'menu.short.journal',
    to: '/journal',
    icon: MENU_ICONS.journal,
  },
  // The rating (task 9.3a): the area `rating`; the closing checklist is linked from the page.
  // Task 9.4a: the early-warning list; a role that reads no rating opens it (`use-menu.ts`).
  results: {
    titleKey: 'menu.results',
    shortKey: 'menu.short.results',
    to: '/results/rating',
    icon: MENU_ICONS.results,
    // Task 9.3b-2: the reports of `08`; a role that reads none of the above opens them.
    areas: [
      'rating',
      'early_warning',
      'attendance_report',
      'results_reports',
      'timetable_load',
      'journal_discipline',
    ],
  },
  // The lesson plans (task 7.1a): the area `plans` of the same name decides who sees it.
  plans: {
    titleKey: 'menu.plans',
    shortKey: 'menu.short.plans',
    to: '/plans',
    icon: MENU_ICONS.plans,
  },
  // The Audit log (task 2.6a): the area `audit_log` of the same name decides who sees it.
  audit_log: {
    titleKey: 'menu.audit_log',
    shortKey: 'menu.short.audit_log',
    to: '/audit',
    icon: MENU_ICONS.audit_log,
  },
};

export const BUILT_ITEMS: ReadonlySet<MenuItem> = new Set(
  MENU_ITEMS.filter((item) => BUILT_PAGES[item] !== undefined),
);
