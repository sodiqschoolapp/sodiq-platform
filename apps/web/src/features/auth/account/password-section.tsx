import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { AccountSection } from './account-section';

/** Edge cases, "Accounts and sign-in": staff change their own password with the current one. */
export function PasswordSection() {
  const { t } = useTranslation();
  return (
    <AccountSection title={t('account.passwordTitle')} text={t('account.passwordText')}>
      <div>
        <Link to="/account/password" className={buttonVariants({ variant: 'secondary' })}>
          {t('layout.changePassword')}
        </Link>
      </div>
    </AccountSection>
  );
}
