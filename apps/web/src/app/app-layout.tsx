import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { CircleUserRoundIcon, XIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setBranchInUse } from '@/api/branch-in-use';
import { PhoneMenu, SideMenu } from '@/features/access/app-menu';
import { BranchSwitcher, RoleSwitcher } from '@/features/access/switchers';
import { useView } from '@/features/access/use-view';
import { LanguageChooser } from '@/components/language-chooser';
import { CommandSearch } from '@/components/search/command-search';
import { ThemeSwitch } from '@/components/theme-switch';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDismissQuestionsOnLeave } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { UnsentBanner, UnsentGuard, useLeave } from '@/components/unsent/unsent-changes';
import { sessionQuery } from '@/features/auth/session';
import { FeedbackButton } from '@/features/feedback/feedback-button';
import { rememberTrustAsked, trustWasAsked } from '@/features/auth/trust-asked';
import { useSignOut } from '@/features/auth/use-sign-out';

/**
 * Edge cases, "Trust this device": trust never begins with a first or reset
 * password. Said once, to the person who had the switch on at such a sign-in.
 */
function NotTrustedNote({ trusted }: { trusted: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => trustWasAsked());

  // The device is trusted: the switch did what it was asked, nothing to say later.
  useEffect(() => {
    if (trusted) {
      rememberTrustAsked(false);
    }
  }, [trusted]);

  if (!open || trusted) {
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
            setOpen(false);
          }}
        >
          <XIcon aria-hidden />
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * The frame of every page after sign-in (docs/spec/12-ux-standards.md, One
 * pattern everywhere): the top bar with the search, the feedback button, the
 * theme and the language, the role and branch switchers (task 0.8c) and the
 * left menu of the active role. The year and quarter in the top bar come with
 * the school setup.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useQuery(sessionQuery);
  const signOut = useSignOut();
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

  return (
    <div className="flex min-h-svh flex-col">
      <UnsentGuard />
      {/* On a phone the tools do not fit beside the name: they wrap onto a second row. */}
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1">
        <PhoneMenu />
        <Link to="/" className="shrink-0 font-semibold">
          {t('app.name')}
        </Link>
        <UnsentBanner />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-2">
          <RoleSwitcher />
          <BranchSwitcher />
          <CommandSearch />
          <FeedbackButton />
          <ThemeSwitch />
          <LanguageChooser />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" aria-label={t('layout.account')} />}
            >
              <CircleUserRoundIcon aria-hidden />
              {/* On a phone the icon alone: the login would not fit in the row. */}
              <span className="hidden max-w-40 truncate sm:inline">{session?.login}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('layout.account')}</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    void navigate({ to: '/password' });
                  }}
                >
                  {t('layout.changePassword')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  // Sign-out takes a form with typed changes away: ask first.
                  void leave().then((leaves) => {
                    if (leaves) {
                      signOut.mutate();
                    }
                  });
                }}
              >
                {t('layout.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex flex-1">
        <SideMenu />
        <main className="min-w-0 flex-1 p-6">
          <NotTrustedNote trusted={session?.trustedUntil != null} />
          <FailureAlert error={signOut.error} />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
