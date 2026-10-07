import { z } from 'zod';

/**
 * docs/spec/12-ux-standards.md, Language: Uzbek, Russian and English are
 * complete, and each person chooses a language. The choice lives on the
 * account (task 0.8d), so that notices can be sent in it (task 0.9); a
 * browser keeps a choice of its own for the pages before sign-in.
 */
export const LANGUAGES = ['uz', 'ru', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/** A new account, and a first visit with a browser in another language, are in Uzbek (decided by the owner). */
export const DEFAULT_LANGUAGE: Language = 'uz';

export const languageSchema = z.enum(LANGUAGES);

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}
