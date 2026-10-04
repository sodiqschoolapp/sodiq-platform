import { createInstance, type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { isLanguage, preferredLanguage, type Language } from './languages';
import { en } from './locales/en';
import { ru } from './locales/ru';
import { uz } from './locales/uz';

export const RESOURCES = { uz, ru, en } as const;

/** Where a browser keeps the chosen language. Task 0.8d also stores it on the account. */
export const LANGUAGE_STORAGE_KEY = 'sodiq.language';

/** i18next with the three languages, ready at once: the texts are part of the app. */
export function createI18n(language: Language): I18n {
  const i18n = createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      uz: { translation: uz },
      ru: { translation: ru },
      en: { translation: en },
    },
    lng: language,
    fallbackLng: false,
    initAsync: false,
    // React escapes what it renders.
    interpolation: { escapeValue: false },
  });
  return i18n;
}

/** The chosen language of an instance. */
export function languageOf(i18n: I18n): Language {
  if (!isLanguage(i18n.language)) {
    throw new Error('i18next is in a language the app does not have.');
  }
  return i18n.language;
}

// A browser may refuse storage (private mode, settings): the choice then lasts
// for the visit only.
function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Nothing to do: see above.
  }
}

/**
 * The i18next of the running app (docs/spec/12-ux-standards.md, Language:
 * "Each person chooses a language; the choice is remembered"). The language
 * of the page (`<html lang>`) and its title follow the choice.
 */
export function startI18n(): I18n {
  const i18n = createI18n(preferredLanguage(readStoredLanguage(), window.navigator.languages));
  const show = () => {
    document.documentElement.lang = languageOf(i18n);
    document.title = i18n.t('app.name');
  };
  show();
  i18n.on('languageChanged', (language) => {
    show();
    if (isLanguage(language)) {
      storeLanguage(language);
    }
  });
  return i18n;
}
