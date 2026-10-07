import {
  hashKey,
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ApiFailure, type FailureCode } from '@/api/failure';
import { ConfirmProvider } from '@/components/confirm-dialog';
import { ViewContext } from '@/features/access/use-view';
import { ViewStore } from '@/features/access/view-store';
import { UnsentProvider } from '@/components/unsent/unsent-changes';
import { followAccountLanguage } from '@/features/auth/account-language';
import {
  forgetSession,
  refreshSession,
  SESSION_CHANGED_CODES,
  SESSION_KEY,
  type Session,
} from '@/features/auth/session';
import { ThemeContext, type ThemeStore } from '@/theme/theme';
import { createAppRouter, type AppRouter } from './router';

export interface Shell {
  queryClient: QueryClient;
  router: AppRouter;
  /** The role and the branch chosen in this tab. */
  view: ViewStore;
}

const sessionChanged = (code: FailureCode): boolean =>
  SESSION_CHANGED_CODES.some((changed) => changed === code);

/**
 * The query client and the router of one tab, wired together: when any call
 * is refused because the session ended or owes a step again (rights are read
 * on every request), the tab goes to the page of that step. `i18n` is the
 * language of the tab, which follows the account once signed in (task 0.8d).
 */
export function createShell(i18n: I18n, history?: RouterHistory): Shell {
  const onError = (error: unknown): void => {
    if (!(error instanceof ApiFailure) || !sessionChanged(error.code)) {
      return;
    }
    if (error.code === 'not_signed_in') {
      forgetSession(queryClient);
      view.clear();
      // Nothing can be saved without a session, so the warning before leaving
      // with typed changes is not asked (decided by the owner, task 0.8b-2).
      void router.navigate({ to: '/sign-in', search: { reason: 'ended' }, ignoreBlocker: true });
      return;
    }
    // The pages' own guards send the tab to the step the session owes now.
    void refreshSession(queryClient)
      .catch(() => undefined)
      .then(() => router.invalidate());
  };

  const view = new ViewStore();
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      // Nothing is asked again by itself: a repeat would count as use of the session.
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
  const router = createAppRouter(queryClient, history);
  // The role and the branch of the tab belong to the person who chose them: they
  // go when the session is known to be over (an ended session read as `null`,
  // sign-out) and when somebody signs in after that. The language of the tab
  // follows the account from the first complete answer on.
  let signedOut = false;
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') {
      return;
    }
    if (event.query.queryHash !== hashKey(SESSION_KEY)) {
      return;
    }
    const session = event.query.state.data as Session | undefined;
    followAccountLanguage(i18n, queryClient, session);
    if (session === null) {
      view.clear();
      signedOut = true;
    } else if (signedOut) {
      view.clear();
      signedOut = false;
    }
  });
  return { queryClient, router, view };
}

interface AppProps {
  i18n: I18n;
  shell: Shell;
  /** The theme of the tab, applied before the first render (`startTheme`). */
  theme: ThemeStore;
}

export function App({ i18n, shell, theme }: AppProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeContext.Provider value={theme}>
        <QueryClientProvider client={shell.queryClient}>
          <ViewContext.Provider value={shell.view}>
            <ConfirmProvider>
              <UnsentProvider>
                <RouterProvider router={shell.router} />
              </UnsentProvider>
            </ConfirmProvider>
          </ViewContext.Provider>
        </QueryClientProvider>
      </ThemeContext.Provider>
    </I18nextProvider>
  );
}
