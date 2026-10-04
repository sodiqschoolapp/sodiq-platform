/** docs/spec/12-ux-standards.md, Language: Uzbek, Russian and English are complete. */
export const LANGUAGES = ['uz', 'ru', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/** A first visit with a browser in another language opens in Uzbek (decided by the owner). */
export const DEFAULT_LANGUAGE: Language = 'uz';

/** Each language under its own name, the same whatever language is in use. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  uz: 'Oʻzbekcha',
  ru: 'Русский',
  en: 'English',
};

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}

/**
 * The language of a visit: the one this browser chose before, else the first
 * language of the browser that is one of the three, else Uzbek.
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
