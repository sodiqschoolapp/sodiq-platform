import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { LanguageSection } from './account/language-section';
import { PasswordSection } from './account/password-section';
import { SecondStepSection } from './account/second-step-section';
import { SessionsSection } from './account/sessions-section';
import { TrustedDevicesSection } from './account/trusted-devices-section';

/**
 * The page of the own account (task 0.8d; edge cases, "Accounts and sign-in":
 * the profile lists the sessions with "sign out everywhere" and the trusted
 * devices, each removable; `02`, Rules: the second step is optional for most
 * roles; `12`, Language: the choice is remembered). Decided by the owner: at
 * `/account`, in every role's menu as "Account"; notification settings, the
 * photo, phone, email and name are not here.
 */
export function AccountPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('account.title')} />
      <div className="grid gap-10">
        <LanguageSection />
        <PasswordSection />
        <SessionsSection />
        <TrustedDevicesSection />
        <SecondStepSection />
      </div>
    </>
  );
}
