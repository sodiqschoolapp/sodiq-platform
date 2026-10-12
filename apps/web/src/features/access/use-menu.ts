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
      return [page];
    });
  }, [role]);
}
