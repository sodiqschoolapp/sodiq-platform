import { LanguageIcon } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { languageOf } from '@/i18n/i18n';
import { isLanguage, LANGUAGE_NAMES, LANGUAGES, type Language } from '@/i18n/languages';

interface LanguageChooserProps {
  /**
   * What a choice does besides changing the language of the tab: on the pages
   * before sign-in it is marked for the account (task 0.8d); in the layout it
   * is stored on the account at once. Without it the choice changes the tab
   * alone, which the browser remembers.
   */
  onChange?: (language: Language) => void;
}

/**
 * docs/spec/12-ux-standards.md, Language: each person chooses a language and
 * the choice is remembered. On every page, before and after sign-in.
 */
export function LanguageChooser({ onChange }: LanguageChooserProps) {
  const { t, i18n } = useTranslation();

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <LanguageIcon className="text-muted-foreground" />
      <span className="sr-only">{t('language.label')}</span>
      <Select
        className="w-auto"
        value={languageOf(i18n)}
        onChange={(event) => {
          if (isLanguage(event.target.value)) {
            if (onChange === undefined) {
              void i18n.changeLanguage(event.target.value);
            } else {
              onChange(event.target.value);
            }
          }
        }}
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language} lang={language}>
            {LANGUAGE_NAMES[language]}
          </option>
        ))}
      </Select>
    </label>
  );
}
