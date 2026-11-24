import { isAssistantRole, PERMISSIONS, permits, visibleMenu } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { assistantStatusQuery } from '@/features/assistant/assistant-api';
import { BUILT_ITEMS, BUILT_PAGES, type MenuPage } from './menu-pages';
import { useView } from './use-view';

/** The pages of the menu of the active role, in the order of its row; `home` alone for no role. */
export function useMenuPages(): MenuPage[] {
  const { role } = useView();
  // Task 11.16: the Assistant page only for the chosen role of the assistant, and only while the
  // assistant is on for it (`02`, Who has it: "it is off until switched on"). The status is the
  // panel's own query; while it is not known the item waits.
  const assistantRole = role !== null && isAssistantRole(role) ? role : null;
  const mayAsk = assistantRole !== null && permits(PERMISSIONS, assistantRole, 'assistant', 'view');
  const status = useQuery(assistantStatusQuery(assistantRole ?? 'super_admin', mayAsk));
  const assistantOn = mayAsk && status.isSuccess && status.data.refusal !== 'assistant_off';
  return useMemo(() => {
    if (role === null) {
      return BUILT_PAGES.home === undefined ? [] : [BUILT_PAGES.home];
    }
    return visibleMenu(role, BUILT_ITEMS, PERMISSIONS).flatMap((item) => {
      const page = BUILT_PAGES[item];
      if (item === 'assistant' && !assistantOn) return [];
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
      // Task 9.4a: "Results" of a role that reads no rating opens the early-warning list; task
      // 9.3b-2: of a role that reads neither, the reports.
      if (item === 'results' && !permits(PERMISSIONS, role, 'rating', 'view')) {
        return permits(PERMISSIONS, role, 'early_warning', 'view')
          ? [{ ...page, to: '/results/early-warning' as const }]
          : [{ ...page, to: '/results/reports' as const }];
      }
      return [page];
    });
  }, [role, assistantOn]);
}
