import { ERROR_CODES, NOTIFICATION_KIND_NAMES } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { translationProblems, type TextTree } from './check';
import { createI18n, RESOURCES } from './i18n';
import { LANGUAGES, preferredLanguage } from './languages';

// docs/spec/12-ux-standards.md, Language: "Uzbek, Russian and English are
// complete: every label, message ... A missing translation fails the build."
describe('the texts of the three languages', () => {
  it('are complete: the same keys, no empty text, the plural forms and {{names}} of each language', () => {
    // English first: the other two are compared with it.
    expect(translationProblems({ en: RESOURCES.en, uz: RESOURCES.uz, ru: RESOURCES.ru })).toEqual(
      [],
    );
  });

  it('exist for exactly the three languages of the app', () => {
    expect(Object.keys(RESOURCES).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)('%s has a text for every error code of the API', (language) => {
    const i18n = createI18n(language);
    for (const code of ERROR_CODES) {
      expect(i18n.exists(`errors.${code}`), code).toBe(true);
    }
  });

  // Task 0.9: the text of a notification is made in the browser from its kind.
  it.each(LANGUAGES)('%s has a text for every kind of notification', (language) => {
    const i18n = createI18n(language);
    for (const kind of NOTIFICATION_KIND_NAMES) {
      expect(i18n.exists(`notifications.kinds.${kind}`), kind).toBe(true);
    }
    expect(i18n.exists('notifications.kinds.unknown')).toBe(true);
  });

  it('counts in Russian with all four forms', () => {
    const i18n = createI18n('ru');
    expect(i18n.t('problems.wait', { count: 1 })).toContain('1 секунду');
    expect(i18n.t('problems.wait', { count: 3 })).toContain('3 секунды');
    expect(i18n.t('problems.wait', { count: 30 })).toContain('30 секунд.');
    expect(i18n.t('problems.wait', { count: 1.5 })).toContain('1.5 секунды');
  });
});

// Decided by the owner (task 0.8a): Uzbek in Latin script. Its letters oʻ and gʻ
// take U+02BB and the tutuq belgisi U+02BC, never a sign of the keyboard.
describe('the Uzbek texts', () => {
  const textsOf = (tree: TextTree): string[] =>
    Object.values(tree).flatMap((value) => (typeof value === 'string' ? [value] : textsOf(value)));

  it('have no apostrophe, quotation mark or accent of the keyboard in place of a letter', () => {
    const wrong = textsOf(RESOURCES.uz).filter((text) => /['`\u2018\u2019]/.test(text));
    expect(wrong).toEqual([]);
  });

  it('use the letters oʻ and gʻ', () => {
    expect(textsOf(RESOURCES.uz).some((text) => text.includes('o\u02bb'))).toBe(true);
    expect(textsOf(RESOURCES.uz).some((text) => text.includes('g\u02bb'))).toBe(true);
  });
});

describe('the translation check', () => {
  const english: TextTree = {
    title: 'Sign in',
    greeting: 'Hello, {{name}}',
    wait_one: '{{count}} second',
    wait_other: '{{count}} seconds',
    errors: Object.fromEntries(ERROR_CODES.map((code) => [code, 'Refused.'])),
  };
  const russian: TextTree = {
    title: 'Вход',
    greeting: 'Здравствуйте, {{name}}',
    wait_one: '{{count}} секунда',
    wait_few: '{{count}} секунды',
    wait_many: '{{count}} секунд',
    wait_other: '{{count}} секунды',
    errors: Object.fromEntries(ERROR_CODES.map((code) => [code, 'Отказано.'])),
  };
  const without = (tree: TextTree, key: string): TextTree =>
    Object.fromEntries(Object.entries(tree).filter(([name]) => name !== key));

  it('finds nothing in complete texts', () => {
    expect(translationProblems({ en: english, ru: russian })).toEqual([]);
  });

  it('names a key that is missing in one language', () => {
    expect(translationProblems({ en: english, ru: without(russian, 'title') })).toEqual([
      'ru: "title" is missing.',
    ]);
  });

  it('names a key that only one language has', () => {
    expect(translationProblems({ en: english, ru: { ...russian, extra: 'Ещё' } })).toEqual([
      'ru: "extra" does not exist in en.',
    ]);
  });

  it('names an empty text', () => {
    expect(translationProblems({ en: english, ru: { ...russian, title: ' ' } })).toEqual([
      'ru: "title" is empty.',
    ]);
  });

  it('names a plural form that the language needs and does not have', () => {
    expect(translationProblems({ en: english, ru: without(russian, 'wait_few') })).toEqual([
      'ru: "wait" has no form few.',
    ]);
  });

  it('names a plural form that the language does not use', () => {
    expect(
      translationProblems({ en: { ...english, wait_few: '{{count}} seconds' }, ru: russian }),
    ).toEqual(['en: "wait" has the form few, which the language does not use.']);
  });

  it('names a text that fills other {{names}}', () => {
    expect(
      translationProblems({ en: english, ru: { ...russian, greeting: 'Здравствуйте, {{имя}}' } }),
    ).toEqual(['ru: "greeting" does not fill the same {{names}} as en.']);
    expect(
      translationProblems({ en: english, ru: { ...russian, wait_many: 'много секунд' } }),
    ).toEqual(['ru: "wait" does not fill the same {{names}} as en.']);
  });

  it('names an error code without a text', () => {
    const errors = without(russian.errors as TextTree, 'sign_in_failed');
    expect(translationProblems({ en: english, ru: { ...russian, errors } })).toEqual([
      'ru: the error code "sign_in_failed" has no text.',
      'ru: "errors.sign_in_failed" is missing.',
    ]);
  });
});

// Decided by the owner (task 0.8a): a first visit takes the browser language
// if it is one of the three, else Uzbek; a choice made before wins.
describe('the language of a visit', () => {
  it('is the one chosen before in this browser', () => {
    expect(preferredLanguage('ru', ['en-US'])).toBe('ru');
  });

  it('is the first browser language that is one of the three', () => {
    expect(preferredLanguage(null, ['ru-RU', 'en'])).toBe('ru');
    expect(preferredLanguage(null, ['de-DE', 'EN-gb'])).toBe('en');
    expect(preferredLanguage(null, ['uz-Cyrl-UZ'])).toBe('uz');
  });

  it('is Uzbek for any other browser, and when the stored value is not a language', () => {
    expect(preferredLanguage(null, ['de-DE', 'fr'])).toBe('uz');
    expect(preferredLanguage(null, [])).toBe('uz');
    expect(preferredLanguage('xx', ['kk'])).toBe('uz');
  });
});
