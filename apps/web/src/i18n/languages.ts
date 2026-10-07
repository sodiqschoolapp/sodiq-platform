import { DEFAULT_LANGUAGE, isLanguage, LANGUAGES, type Language } from '@sodiq/shared';

/**
 * docs/spec/12-ux-standards.md, Language: Uzbek, Russian and English are
 * complete. The list, the default and the type are shared with the API, which
 * stores the language on the account (task 0.8d).
 */
export { DEFAULT_LANGUAGE, isLanguage, LANGUAGES, type Language };

/** Each language under its own name, the same whatever language is in use. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  uz: 'Oʻzbekcha',
  ru: 'Русский',
  en: 'English',
};

/**
 * The language of a visit: the one this browser chose before, else the first
 * language of the browser that is one of the three, else Uzbek (decided by the
 * owner). Once signed in, the language of the account applies (task 0.8d).
 */
export function preferredLanguage(
  stored: string | null,
  browserLanguages: readonly string[],
): Language {
  if (isLanguage(stored)) {
    return stored;
  }
  for (const tag of browserLanguages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) {
      return primary;
    }
  }
  return DEFAULT_LANGUAGE;
}
