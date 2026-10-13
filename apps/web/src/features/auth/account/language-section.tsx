import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { languageOf } from '@/i18n/i18n';
import { isLanguage, LANGUAGE_NAMES, LANGUAGES } from '@/i18n/languages';
import { AccountSection } from './account-section';
import { useAccountLanguage } from '../use-account-language';

/** `12`, Language: the choice is remembered, on the account; the same as the chooser of the top bar. */
export function LanguageSection() {
  const { t, i18n } = useTranslation();
  const accountLanguage = useAccountLanguage();

  return (
    <AccountSection title={t('account.languageTitle')}>
      <div className="max-w-xs">
        <SelectField
          label={t('language.label')}
          name="account-language"
          value={languageOf(i18n)}
          options={LANGUAGES.map((language) => ({
            value: language,
            label: LANGUAGE_NAMES[language],
          }))}
          onChange={(event) => {
            if (isLanguage(event.target.value)) {
              accountLanguage.mutate(event.target.value);
            }
          }}
        />
      </div>
      <FailureAlert error={accountLanguage.error} />
    </AccountSection>
  );
}
