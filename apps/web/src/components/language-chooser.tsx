import { LanguagesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { languageOf } from '@/i18n/i18n';
import { isLanguage, LANGUAGE_NAMES, LANGUAGES } from '@/i18n/languages';

/**
 * docs/spec/12-ux-standards.md, Language: each person chooses a language and
 * the choice is remembered. On every page, before and after sign-in.
 */
export function LanguageChooser() {
  const { t, i18n } = useTranslation();

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <LanguagesIcon aria-hidden className="size-4 text-muted-foreground" />
      <span className="sr-only">{t('language.label')}</span>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={languageOf(i18n)}
        onChange={(event) => {
          if (isLanguage(event.target.value)) {
            void i18n.changeLanguage(event.target.value);
          }
        }}
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language} lang={language}>
            {LANGUAGE_NAMES[language]}
          </option>
        ))}
      </select>
    </label>
  );
}
