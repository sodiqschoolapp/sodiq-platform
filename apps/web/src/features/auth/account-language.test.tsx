import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, nothing, refusal, renderApp, sessionOf } from '@/testing/render-app';

const heading = (name: string) => screen.findByRole('heading', { name });
const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const press = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
};
const chooseLanguage = (label: string, language: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value: language } });
};
const signedOut = () => refusal('not_signed_in', 401);
const MARK = 'sodiq.languageChosen';

function signInAs(password = 'the-password-1') {
  type(en.signIn.login, 'a.karimov');
  type(en.signIn.password, password);
  press(en.signIn.submit);
}

// docs/spec/12-ux-standards.md, Language: each person chooses a language and
// the choice is remembered. Decided by the owner (task 0.8d): the account's
// language is applied at sign-in; the browser's choice is for the pages before
// sign-in; a language chosen in the tab before sign-in was complete is saved
// to the account at the first complete answer.
describe('the language of the account', () => {
  it('is applied at sign-in, to the page and to the document', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(sessionOf({ language: 'ru' })),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    signInAs();

    expect(await heading(ru.home.title)).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>(ru.language.label).value).toBe('ru');
    // Nothing was chosen in this tab: nothing is saved to the account.
    expect(calls.map((call) => call.route)).not.toContain('PUT /api/auth/language');
  });

  it('is applied when the session is read again, as at a reload or in another tab', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ language: 'uz' })) });

    renderApp('/');

    expect(await heading(uz.home.title)).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>(uz.language.label).value).toBe('uz');
  });

  it('is not applied while a step is owed: the code page stays in the language of the browser', async () => {
    let session = sessionOf({ language: 'ru', secondStep: 'pending' });
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(session),
      'POST /api/auth/second-step': () => {
        session = sessionOf({ language: 'ru', secondStep: 'passed' });
        return json(session);
      },
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    signInAs();

    expect(await heading(en.code.title)).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>(en.language.label).value).toBe('en');

    // The code completes the sign-in: the account's language applies.
    type(en.code.label, '123456');
    press(en.code.submit);

    expect(await heading(ru.home.title)).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>(ru.language.label).value).toBe('ru');
  });

  it('is saved from a choice made on the sign-in page, once the sign-in is complete', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(sessionOf({ language: 'ru' })),
      'PUT /api/auth/language': nothing,
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    chooseLanguage(en.language.label, 'uz');
    await heading(uz.signIn.title);
    expect(window.sessionStorage.getItem(MARK)).toBe('uz');
    // Before sign-in the choice goes to the browser only.
    expect(calls.map((call) => call.route)).not.toContain('PUT /api/auth/language');

    type(uz.signIn.login, 'a.karimov');
    type(uz.signIn.password, 'the-password-1');
    press(uz.signIn.submit);

    // The page stays in the chosen language, and the account takes it.
    expect(await heading(uz.home.title)).toBeDefined();
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'PUT /api/auth/language')).toEqual([
        { route: 'PUT /api/auth/language', body: { language: 'uz' } },
      ]);
    });
    expect(window.sessionStorage.getItem(MARK)).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>(uz.language.label).value).toBe('uz');
  });

  it('is saved from a choice made at the forced password change, after the change', async () => {
    let session = sessionOf({ language: 'uz', mustChangePassword: true });
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/password': () => {
        session = sessionOf({ language: 'uz' });
        return nothing();
      },
      'PUT /api/auth/language': nothing,
    });
    renderApp('/password');
    await heading(en.password.titleForced);

    chooseLanguage(en.language.label, 'ru');
    await heading(ru.password.titleForced);
    expect(calls.map((call) => call.route)).not.toContain('PUT /api/auth/language');

    type(ru.password.currentOneTime, 'the-first-password');
    type(ru.password.new, 'a-new-password-73');
    type(ru.password.repeat, 'a-new-password-73');
    press(ru.password.submit);

    expect(await heading(ru.home.title)).toBeDefined();
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'PUT /api/auth/language')).toEqual([
        { route: 'PUT /api/auth/language', body: { language: 'ru' } },
      ]);
    });
    expect(window.sessionStorage.getItem(MARK)).toBeNull();
  });

  it('is not saved again when the choice before sign-in is the language of the account', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(sessionOf({ language: 'ru' })),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);
    chooseLanguage(en.language.label, 'ru');
    await heading(ru.signIn.title);

    type(ru.signIn.login, 'a.karimov');
    type(ru.signIn.password, 'the-password-1');
    press(ru.signIn.submit);

    expect(await heading(ru.home.title)).toBeDefined();
    expect(calls.map((call) => call.route)).not.toContain('PUT /api/auth/language');
    expect(window.sessionStorage.getItem(MARK)).toBeNull();
  });

  // On a shared computer the next person gets their own account's language.
  it('forgets a choice before sign-in at sign-out, and the next sign-in applies the account', async () => {
    let session: unknown = sessionOf({ language: 'en' });
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/sign-out': () => {
        session = null;
        return nothing();
      },
      'POST /api/auth/sign-in': () => json(sessionOf({ language: 'ru' })),
    });
    renderApp('/');
    await heading(en.home.title);
    window.sessionStorage.setItem(MARK, 'uz');

    fireEvent.click(screen.getByRole('button', { name: en.layout.account }));
    fireEvent.click(await screen.findByRole('menuitem', { name: en.layout.signOut }));

    await heading(en.signIn.title);
    expect(window.sessionStorage.getItem(MARK)).toBeNull();

    signInAs();

    expect(await heading(ru.home.title)).toBeDefined();
    expect(calls.map((call) => call.route)).not.toContain('PUT /api/auth/language');
  });

  it('is saved by the chooser of the top bar, which switches the page at once', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'PUT /api/auth/language': nothing,
    });
    renderApp('/');
    await heading(en.home.title);

    chooseLanguage(en.language.label, 'ru');

    expect(await heading(ru.home.title)).toBeDefined();
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'PUT /api/auth/language')).toEqual([
        { route: 'PUT /api/auth/language', body: { language: 'ru' } },
      ]);
    });
    expect(window.sessionStorage.getItem(MARK)).toBeNull();
  });

  it('says in the layout when the save fails', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'PUT /api/auth/language': () => refusal('internal_error', 500),
    });
    renderApp('/');
    await heading(en.home.title);

    chooseLanguage(en.language.label, 'ru');

    expect((await screen.findByRole('alert')).textContent).toBe(ru.errors.internal_error);
  });
});
