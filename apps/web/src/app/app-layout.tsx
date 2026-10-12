import { useQuery } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { CloseIcon } from '@/components/icons';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setBranchInUse } from '@/api/branch-in-use';
import { PhoneTabBar, SideMenu, type PersonActions } from '@/features/access/app-menu';
import { Logo } from '@/components/brand/logo';
import { BranchSwitcher, RoleSwitcher } from '@/features/access/switchers';
import { useView } from '@/features/access/use-view';
import { CommandSearch } from '@/components/search/command-search';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useDismissQuestionsOnLeave } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { UnsentBanner, UnsentGuard, useLeave } from '@/components/unsent/unsent-changes';
import { sessionQuery } from '@/features/auth/session';
import { FeedbackButton } from '@/features/feedback/feedback-button';
import { NotificationsButton } from '@/features/notifications/notifications-button';
import { CurrentPeriod } from '@/features/setup/current-period';
import { rememberTrustAsked, trustWasAsked } from '@/features/auth/trust-asked';
import { useAccountLanguage } from '@/features/auth/use-account-language';
import { useSignOut } from '@/features/auth/use-sign-out';

/**
 * Edge cases, "Trust this device": trust never begins with a first or reset
 * password. Said once, to the person who had the switch on at such a sign-in.
 */
function NotTrustedNote({ trusted }: { trusted: boolean }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  // The device is trusted: the switch did what it was asked, nothing to say
  // later, also when the trust ends while the layout stays (a password change
  // by choice or "sign out everywhere", task 0.8d): the mark is read again at
  // each render and is gone by then.
  useEffect(() => {
    if (trusted) {
      rememberTrustAsked(false);
    }
  }, [trusted]);

  if (dismissed || trusted || !trustWasAsked()) {
    return null;
  }
  return (
    <Alert className="mb-4">
      <AlertDescription>{t('layout.notTrusted')}</AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('layout.dismiss')}
          onClick={() => {
            rememberTrustAsked(false);
            setDismissed(true);
          }}
        >
          <CloseIcon aria-hidden />
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * The frame of every page after sign-in (docs/spec/12-ux-standards.md, One
 * pattern everywhere; docs/design-system.md, Layout shell): the navy menu of
 * the active role at the left (the tab bar below 640 px) with the person at
 * its foot, and the top bar: the branch, the academic year and quarter (task
 * 1.3), the search (Ctrl K), the notifications (task 0.9), the feedback button
 * and the role switch (task 0.8c).
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { data: session } = useQuery(sessionQuery);
  const signOut = useSignOut();
  const accountLanguage = useAccountLanguage();
  const { leave } = useLeave();
  const { branchId } = useView();
  useDismissQuestionsOnLeave();

  // Before any query of the page runs: every call names the branch of the switcher.
  useLayoutEffect(() => {
    setBranchInUse(branchId);
    return () => {
      setBranchInUse(null);
    };
  }, [branchId]);

  const actions: PersonActions = {
    signOut: () => {
      // Sign-out takes a form with typed changes away: ask first.
      void leave().then((leaves) => {
        if (leaves) {
          signOut.mutate();
        }
      });
    },
    chooseLanguage: accountLanguage.mutate,
  };

  return (
    <div className="flex min-h-svh">
      <UnsentGuard />
      <SideMenu actions={actions} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 64 high, white (dark: the top bar navy), a bottom border. On a phone the
            year and quarter wrap under the other tools. */}
        <header
          aria-label={t('layout.topBar')}
          data-print="hide"
          className="sticky top-0 z-30 flex min-h-16 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-top-bar px-8 py-3 max-sm:px-4 max-sm:py-2"
        >
          <Link to="/" className="shrink-0 rounded-lg sm:hidden">
            {/* The colour shield on white, the on-dark one on the dark top bar (Logo). */}
            <Logo variant="mark" className="h-8 dark:hidden" />
            <Logo variant="mark-on-dark" className="hidden h-8 dark:block" />
          </Link>
          <div className="flex min-w-0 items-center gap-x-4 gap-y-1 max-sm:order-last max-sm:basis-full">
            <BranchSwitcher />
            <CurrentPeriod />
          </div>
          <UnsentBanner />
          <div className="ml-auto flex items-center gap-2">
            <CommandSearch />
            <NotificationsButton />
            <div className="max-sm:hidden">
              <FeedbackButton />
            </div>
            <RoleSwitcher />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-8 max-sm:p-4 max-sm:pb-24">
          <NotTrustedNote trusted={session?.trustedUntil != null} />
          <FailureAlert error={signOut.error ?? accountLanguage.error} />
          <Outlet />
        </main>
      </div>
      <PhoneTabBar actions={actions} />
    </div>
  );
}
