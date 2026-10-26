import { PERMISSIONS, permits, visibleMenu } from '@sodiq/shared';
import { useMemo } from 'react';
import { BUILT_ITEMS, BUILT_PAGES, type MenuPage } from './menu-pages';
import { useView } from './use-view';

/** The pages of the menu of the active role, in the order of its row; `home` alone for no role. */
export function useMenuPages(): MenuPage[] {
  const { role } = useView();
  return useMemo(() => {
    if (role === null) {
      return BUILT_PAGES.home === undefined ? [] : [BUILT_PAGES.home];
    }
    return visibleMenu(role, BUILT_ITEMS, PERMISSIONS).flatMap((item) => {
      const page = BUILT_PAGES[item];
      if (
        page === undefined ||
        (page.areas !== undefined &&
          !page.areas.some((area) => permits(PERMISSIONS, role, area, 'view')))
      ) {
        return [];
      }
      // Task 5.9a (decision 2): "Timetable" of a role that sees no draft opens the views.
      if (item === 'timetable' && !permits(PERMISSIONS, role, 'timetable', 'view')) {
        return [{ ...page, to: '/timetable/views' as const }];
      }
      // Task 9.4a: "Results" of a role that reads no rating opens the early-warning list.
      if (item === 'results' && !permits(PERMISSIONS, role, 'rating', 'view')) {
        return [{ ...page, to: '/results/early-warning' as const }];
      }
      return [page];
    });
  }, [role]);
}
