import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { LanguageSection } from './account/language-section';
import { AuthPage } from './auth-page';
import { sessionQuery } from './session';
import { useSignOut } from './use-sign-out';

/**
 * The frame of a parent session (task 11.1, decision 13): no staff menu and no branch, only
 * what the owner approved for the parent ("signs in and changes its own password and
 * language"): the language, the password change and sign-out. The parent pages come with
 * task 11.2.
 */
export function ParentHomePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data: session } = useQuery(sessionQuery);
  const signOut = useSignOut();
  return (
    <AuthPage title={t('parent.title')} text={session?.fullName ?? session?.login ?? ''}>
      <div className="grid gap-6">
        <LanguageSection />
        <div className="flex flex-wrap gap-2">
          <Link to="/parent/password" className={buttonVariants({ variant: 'secondary' })}>
            {t('parent.password')}
          </Link>
          <Button
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate();
            }}
          >
            {t('parent.signOut')}
          </Button>
        </div>
        <FailureAlert error={signOut.error} />
      </div>
    </AuthPage>
  );
}
