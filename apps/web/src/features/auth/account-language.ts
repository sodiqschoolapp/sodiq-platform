import type { QueryClient } from '@tanstack/react-query';
import type { i18n as I18n } from 'i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { languageOf } from '@/i18n/i18n';
import type { Language } from '@/i18n/languages';
import { languageChosenBeforeSignIn, rememberLanguageChosen } from './language-mark';
import { SESSION_KEY, stepOf, type Session } from './session';

/** Stores the language on the account and in the session the tab holds. */
export async function saveAccountLanguage(
  queryClient: QueryClient,
  language: Language,
): Promise<void> {
  await answerOf(api.PUT('/api/auth/language', { body: { language } }));
  queryClient.setQueryData<Session>(SESSION_KEY, (session) =>
    session == null ? session : { ...session, language },
  );
}

/**
 * docs/spec/12-ux-standards.md, Language: the choice is remembered. Decided
 * by the owner (task 0.8d): the account's language is applied at sign-in and
 * the browser's choice is for the pages before sign-in only. Called with every
 * answer about the session that the tab receives:
 *
 * - no session: the mark of a choice before sign-in goes, as the view does;
 * - a session that owes a step: nothing; the chooser changes the browser alone;
 * - a complete session: a language chosen in this tab before sign-in was
 *   complete is saved to the account, once; otherwise the account's language
 *   is applied to the tab.
 *
 * A save that fails is not shown: the tab keeps the chosen language, and the
 * next answer of the server puts the account's language back.
 */
export function followAccountLanguage(
  i18n: I18n,
  queryClient: QueryClient,
  session: Session | undefined,
): void {
  if (session === undefined) {
    return;
  }
  if (session === null) {
    rememberLanguageChosen(null);
    return;
  }
  if (stepOf(session) !== 'none') {
    return;
  }
  const chosen = languageChosenBeforeSignIn();
  if (chosen !== null) {
    rememberLanguageChosen(null);
    if (chosen !== session.language) {
      void saveAccountLanguage(queryClient, chosen).catch(() => undefined);
    }
    return;
  }
  if (session.language !== languageOf(i18n)) {
    void i18n.changeLanguage(session.language);
  }
}
