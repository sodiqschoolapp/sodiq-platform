import { describe, expect, it } from 'vitest';
import { LANGUAGES } from './language.js';
import { RATING_EXPORT_TEXTS } from './rating-exports.js';

const values = (texts: unknown): string[] =>
  typeof texts === 'string'
    ? [texts]
    : Object.values(texts as Record<string, unknown>).flatMap(values);

describe('the texts of the rating file', () => {
  it('have every text in the three languages, none empty', () => {
    for (const language of LANGUAGES) {
      for (const text of values(RATING_EXPORT_TEXTS[language])) {
        expect(text.trim(), language).not.toBe('');
      }
    }
  });

  it('write Uzbek oʻ and gʻ with U+02BB, never the keyboard apostrophe', () => {
    for (const text of values(RATING_EXPORT_TEXTS.uz)) {
      expect(text, text).not.toMatch(/['`’‘]/);
    }
  });

  // A sheet name of Excel has at most 31 characters and none of : \ / ? * [ ].
  it('give every sheet a name that Excel takes', () => {
    for (const language of LANGUAGES) {
      for (const name of Object.values(RATING_EXPORT_TEXTS[language].sheets)) {
        expect(name.length, name).toBeLessThanOrEqual(31);
        expect(name, name).not.toMatch(/[:\\/?*[\]]/);
      }
    }
  });
});
