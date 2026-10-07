import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { Role } from '@sodiq/shared';
import { sessionQuery } from '@/features/auth/session';
import { resolveView, type View } from './view';
import type { ViewStore } from './view-store';

export const ViewContext = createContext<ViewStore | null>(null);

export function useViewStore(): ViewStore {
  const store = useContext(ViewContext);
  if (store === null) {
    throw new Error('The view store is missing: wrap the app in ViewContext.Provider.');
  }
  return store;
}

export interface UseView extends View {
  chooseRole: (role: Role) => void;
  chooseBranch: (branchId: string) => void;
}

/** The role and the branch on display, and the way to change them. */
export function useView(): UseView {
  const store = useViewStore();
  const { data: session } = useQuery(sessionQuery);
  const chosen = useSyncExternalStore(store.subscribe, store.snapshot);
  const view = useMemo(() => resolveView(session ?? null, chosen), [session, chosen]);
  return {
    ...view,
    chooseRole: (role) => {
      store.chooseRole(role);
    },
    chooseBranch: (branchId) => {
      store.chooseBranch(branchId);
    },
  };
}
