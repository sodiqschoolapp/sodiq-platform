import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { CircleUserRoundIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageChooser } from '@/components/language-chooser';
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
import { FailureAlert } from '@/features/auth/form-helpers';
import { sessionQuery } from '@/features/auth/session';
import { rememberTrustAsked, trustWasAsked } from '@/features/auth/trust-asked';
import { useSignOut } from '@/features/auth/use-sign-out';

/**
 * Edge cases, "Trust this device": trust never begins with a first or reset
 * password. Said once, to the person who had the switch on at such a sign-in.
 */
function NotTrustedNote({ trusted }: { trusted: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => trustWasAsked());

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
 * pattern everywhere): the top bar and the left menu. The menu per role, the
 * role and branch switchers and the year and quarter in the top bar come in
 * task 0.8c and with the school setup.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useQuery(sessionQuery);
  const signOut = useSignOut();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link to="/" className="font-semibold">
          {t('app.name')}
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LanguageChooser />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" aria-label={t('layout.account')} />}
            >
              <CircleUserRoundIcon aria-hidden />
              <span className="max-w-40 truncate">{session?.login}</span>
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
                  signOut.mutate();
                }}
              >
                {t('layout.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex flex-1">
        <nav aria-label={t('layout.menu')} className="hidden w-56 shrink-0 border-r p-2 md:block" />
        <main className="min-w-0 flex-1 p-6">
          <NotTrustedNote trusted={session?.trustedUntil != null} />
          <FailureAlert error={signOut.error} />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
