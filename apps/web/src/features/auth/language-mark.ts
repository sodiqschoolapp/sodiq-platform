import { isLanguage, type Language } from '@/i18n/languages';

// Decided by the owner (task 0.8d): when the chooser was used in this tab
// before the session was complete (on the sign-in page, at the code, at the
// forced password change, at the set-up), that language is saved to the
// account at the first complete answer, instead of being overwritten by the
// account's language. The mark is per tab, set only by an explicit use of the
// chooser while no complete session exists, and cleared after that save, at
// sign-out and when the session ends. A tab whose sign-in page merely shows
// the last person's language sets no mark: on a shared computer the next
// person gets their own account's language.

const KEY = 'sodiq.languageChosen';

export function rememberLanguageChosen(language: Language | null): void {
  try {
    if (language === null) {
      window.sessionStorage.removeItem(KEY);
    } else {
      window.sessionStorage.setItem(KEY, language);
    }
  } catch {
    // Storage is refused: the account's language applies at sign-in.
  }
}

/** The language chosen in this tab before sign-in was complete, if any. */
export function languageChosenBeforeSignIn(): Language | null {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}
