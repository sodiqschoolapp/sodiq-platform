import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY, startI18n } from '@/i18n/i18n';
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
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

const signedOut = () => refusal('not_signed_in', 401);

describe('the sign-in page', () => {
  // Edge cases, "Trust this device": the switch is off by default, with the
  // note "do not use on a shared computer".
  it('has the "Trust this device" switch off, with its note', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });

    renderApp('/sign-in');
    await heading(en.signIn.title);

    const trust = screen.getByRole<HTMLInputElement>('checkbox', { name: en.signIn.trust });
    expect(trust.checked).toBe(false);
    expect(screen.getByText(en.signIn.trustNote)).toBeDefined();
    expect(en.signIn.trustNote).toContain('Do not use on a shared computer');
  });

  // A login is compared exactly: the field must not change what is typed.
  it('keeps the browser from changing the login', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });

    renderApp('/sign-in');
    await heading(en.signIn.title);

    const login = screen.getByLabelText(en.signIn.login);
    expect(login.getAttribute('autocapitalize')).toBe('none');
    expect(login.getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText(en.signIn.password).getAttribute('type')).toBe('password');
  });

  it('sends login and password without the switch, and opens the home page', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(sessionOf({ login: 'a.karimov' })),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    type(en.signIn.login, '  a.karimov ');
    type(en.signIn.password, 'the-password-1');
    press(en.signIn.submit);

    expect(await heading(en.home.title)).toBeDefined();
    expect(calls.find((call) => call.route === 'POST /api/auth/sign-in')?.body).toEqual({
      login: 'a.karimov',
      password: 'the-password-1',
    });
  });

  it('sends the switch when it is on', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(sessionOf({ trustedUntil: '2026-10-12T04:00:00.000Z' })),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'the-password-1');
    fireEvent.click(screen.getByRole('checkbox', { name: en.signIn.trust }));
    press(en.signIn.submit);

    await heading(en.home.title);
    expect(calls.find((call) => call.route === 'POST /api/auth/sign-in')?.body).toEqual({
      login: 'a.karimov',
      password: 'the-password-1',
      trustDevice: true,
    });
    // The device is trusted: nothing to say.
    expect(screen.queryByText(en.layout.notTrusted)).toBeNull();
  });

  it.each([
    ['the code page when the account has a second step', { secondStep: 'pending' }, en.code.title],
    [
      'the password change with a first password',
      { mustChangePassword: true },
      en.password.titleForced,
    ],
    [
      'the set-up when the second step is required',
      { secondStep: 'set_up_required' },
      en.setUp.title,
    ],
  ] as const)('goes on to %s', async (_name, fields, title) => {
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(sessionOf(fields)),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'the-password-1');
    press(en.signIn.submit);

    expect(await heading(title)).toBeDefined();
  });

  // Forms say in plain words what to fix (docs/spec/12-ux-standards.md, No lost work).
  it('asks for the login and the password before anything is sent', async () => {
    const calls = fakeApi({ 'GET /api/auth/session': signedOut });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    press(en.signIn.submit);

    expect(screen.getByText(en.signIn.loginMissing)).toBeDefined();
    expect(screen.getByText(en.signIn.passwordMissing)).toBeDefined();
    expect(screen.getByLabelText(en.signIn.login).getAttribute('aria-invalid')).toBe('true');
    expect(calls.map((call) => call.route)).toEqual(['GET /api/auth/session']);
  });

  // Edge cases, "Accounts and sign-in": an unknown login and a wrong password
  // get the same answer. The page shows the translation of the code, never the
  // English message of the API.
  it('shows one text for a failed sign-in and keeps what was typed', async () => {
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => refusal('sign_in_failed', 401),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'a-wrong-password');
    press(en.signIn.submit);

    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.sign_in_failed);
    expect(screen.queryByText(/ENGLISH TEXT FOR THE DEVELOPER/)).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(en.signIn.login).value).toBe('a.karimov');
    expect(button(en.signIn.submit).disabled).toBe(false);
  });

  // After five failures each further attempt is delayed; the answer names the wait.
  it('shows the wait of "too many attempts" and keeps the button off', async () => {
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => refusal('too_many_attempts', 429, 30),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'a-wrong-password');
    press(en.signIn.submit);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many failed attempts. Try again in 30 seconds.',
    );
    expect(button(en.signIn.submit).disabled).toBe(true);
  });

  it.each([
    ['password_expired', en.errors.password_expired],
    ['account_locked', en.errors.account_locked],
  ] as const)('says to ask an administrator for %s', async (code, text) => {
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => refusal(code, 403),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'the-password-1');
    press(en.signIn.submit);

    expect((await screen.findByRole('alert')).textContent).toBe(text);
    expect(text).toMatch(/administrator/);
  });

  it('says that the server did not answer', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'the-password-1');
    press(en.signIn.submit);

    expect((await screen.findByRole('alert')).textContent).toBe(en.problems.noAnswer);
  });
});

// Edge cases, "Accounts and sign-in": a code from an authenticator app; a
// recovery code goes into the same field.
describe('the code page', () => {
  it('sends the code and opens the home page', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ secondStep: 'pending' })),
      'POST /api/auth/second-step': () => json(sessionOf({ secondStep: 'passed' })),
    });
    renderApp('/sign-in/code');
    await heading(en.code.title);

    type(en.code.label, ' 123456 ');
    press(en.code.submit);

    expect(await heading(en.home.title)).toBeDefined();
    expect(calls.find((call) => call.route === 'POST /api/auth/second-step')?.body).toEqual({
      code: '123456',
    });
  });

  it('shows the refusal of a wrong code and sends nothing for an empty one', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ secondStep: 'pending' })),
      'POST /api/auth/second-step': () => refusal('second_step_code_wrong', 403),
    });
    renderApp('/sign-in/code');
    await heading(en.code.title);

    press(en.code.submit);
    expect(screen.getByText(en.code.missing)).toBeDefined();
    expect(calls).toHaveLength(1);

    type(en.code.label, '000000');
    press(en.code.submit);
    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.second_step_code_wrong);
  });
});

describe('the password page', () => {
  const fill = (current: string, next: string, repeat = next) => {
    type(en.password.currentOneTime, current);
    type(en.password.new, next);
    type(en.password.repeat, repeat);
  };

  // Edge cases: passwords have at least ten characters; the new one differs
  // from the current one. Checked as typed, before anything is sent.
  it('says what to fix as it is typed and sends nothing', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ mustChangePassword: true })),
    });
    renderApp('/password');
    await heading(en.password.titleForced);

    type(en.password.new, 'short');
    expect(screen.getByText('The password needs at least 10 characters.')).toBeDefined();

    type(en.password.new, 'x'.repeat(129));
    expect(screen.getByText('The password can have at most 128 characters.')).toBeDefined();

    fill('the-first-password', 'the-first-password');
    expect(screen.getByText(en.password.same)).toBeDefined();

    fill('the-first-password', 'a-new-password-73', 'a-new-password-74');
    expect(screen.getByText(en.password.mismatch)).toBeDefined();

    press(en.password.submit);
    fill('', 'a-new-password-73');
    press(en.password.submit);
    expect(screen.getByText(en.password.currentMissing)).toBeDefined();
    expect(calls.map((call) => call.route)).toEqual(['GET /api/auth/session']);
  });

  // docs/spec/02-roles-and-access.md, Rules: the password is changed at first sign-in.
  it('changes a first password and goes on to the next step', async () => {
    let session = sessionOf({ mustChangePassword: true, secondStep: 'set_up_required' });
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/password': () => {
        session = sessionOf({ secondStep: 'set_up_required' });
        return nothing();
      },
    });
    renderApp('/password');
    await heading(en.password.titleForced);
    expect(screen.getByText(en.password.textForced)).toBeDefined();
    // A forced change cannot be left.
    expect(screen.queryByRole('link', { name: en.password.back })).toBeNull();

    fill('the-first-password', 'a-new-password-73');
    press(en.password.submit);

    expect(await heading(en.setUp.title)).toBeDefined();
    expect(calls.find((call) => call.route === 'POST /api/auth/password')?.body).toEqual({
      currentPassword: 'the-first-password',
      newPassword: 'a-new-password-73',
    });
  });

  // Edge cases: after a reset the user sees "your password was reset by X".
  it('says who reset the password', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ mustChangePassword: true, passwordResetBy: 's.nazarov' })),
    });

    renderApp('/password');
    await heading(en.password.titleForced);

    expect(screen.getByText('Your password was reset by s.nazarov.')).toBeDefined();
  });

  it.each(['current_password_wrong', 'password_unchanged', 'password_expired'] as const)(
    'shows the refusal %s',
    async (code) => {
      fakeApi({
        'GET /api/auth/session': () => json(sessionOf({ mustChangePassword: true })),
        'POST /api/auth/password': () => refusal(code, 403),
      });
      renderApp('/password');
      await heading(en.password.titleForced);

      fill('the-first-password', 'a-new-password-73');
      press(en.password.submit);

      expect((await screen.findByRole('alert')).textContent).toBe(en.errors[code]);
    },
  );

  // Edge cases: staff change their own password with the current one.
  // Decided by the owner (task 0.8d): by choice the page is inside the layout,
  // under the account page; the old address still leads there.
  it('changes the password by choice, says so and stays, inside the layout', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'POST /api/auth/password': nothing,
    });
    const { router } = renderApp('/password');
    await heading(en.password.titleOwn);
    expect(router.state.location.pathname).toBe('/account/password');
    expect(screen.getByText(en.password.othersEnd)).toBeDefined();
    expect(screen.getByRole('navigation', { name: en.layout.menu })).toBeDefined();
    expect(
      within(screen.getByRole('navigation', { name: en.layout.breadcrumbs })).getByRole('link', {
        name: en.account.title,
      }),
    ).toBeDefined();

    type(en.password.current, 'the-old-password');
    type(en.password.new, 'a-new-password-73');
    type(en.password.repeat, 'a-new-password-73');
    press(en.password.submit);

    expect((await screen.findByText(en.password.changed)).getAttribute('role')).toBe('status');
    expect(screen.getByLabelText<HTMLInputElement>(en.password.new).value).toBe('');
    expect(screen.getByRole('link', { name: en.password.back })).toBeDefined();
  });

  // Edge cases, "Trust this device": trust never begins with a first password.
  it('says after a forced change that the device is not trusted, once', async () => {
    let session = sessionOf({ mustChangePassword: true });
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(session),
      'POST /api/auth/password': nothing,
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);
    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'the-first-password');
    fireEvent.click(screen.getByRole('checkbox', { name: en.signIn.trust }));
    press(en.signIn.submit);
    await heading(en.password.titleForced);
    session = sessionOf();
    fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/password': nothing,
    });

    fill('the-first-password', 'a-new-password-73');
    press(en.password.submit);

    await heading(en.home.title);
    expect(screen.getByText(en.layout.notTrusted)).toBeDefined();

    press(en.layout.dismiss);
    expect(screen.queryByText(en.layout.notTrusted)).toBeNull();
    expect(window.sessionStorage.getItem('sodiq.trustAsked')).toBeNull();
  });
});

// Edge cases, "Accounts and sign-in": the second step is a code from an
// authenticator app, with ten single-use recovery codes shown at set-up.
describe('the set-up of a required second step', () => {
  const recoveryCodes = Array.from({ length: 10 }, (_, index) => `code-${String(index)}-abcd`);
  const setUp = {
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    address: 'otpauth://totp/Sodiq%20School:s.nazarov?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  };

  it('starts only on request, shows the key, confirms the code and shows the recovery codes once', async () => {
    let session = sessionOf({ secondStep: 'set_up_required' });
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/second-step/set-up': () => json(setUp),
      'POST /api/auth/second-step/confirm': () => {
        session = sessionOf({ secondStep: 'passed' });
        return json({ recoveryCodes });
      },
    });
    renderApp('/second-step/set-up');
    await heading(en.setUp.title);
    // Every start makes a new key: nothing is started by opening the page.
    expect(calls.map((call) => call.route)).toEqual(['GET /api/auth/session']);

    press(en.setUp.start);

    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeDefined();
    expect(screen.getByRole('img', { name: en.setUp.qr })).toBeDefined();

    type(en.setUp.code, '123456');
    press(en.setUp.confirm);

    expect(await heading(en.setUp.codesTitle)).toBeDefined();
    const shown = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(shown.map((item) => item.textContent)).toEqual(recoveryCodes);
    expect(calls.find((call) => call.route.endsWith('/confirm'))?.body).toEqual({ code: '123456' });

    // The page is left only after the person says the codes are saved.
    expect(button(en.setUp.continue).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: en.setUp.saved }));
    press(en.setUp.continue);

    expect(await heading(en.home.title)).toBeDefined();
  });

  it('shows the refusal of a wrong code and keeps the key', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ secondStep: 'set_up_required' })),
      'POST /api/auth/second-step/set-up': () => json(setUp),
      'POST /api/auth/second-step/confirm': () => refusal('second_step_code_wrong', 403),
    });
    renderApp('/second-step/set-up');
    await heading(en.setUp.title);
    press(en.setUp.start);
    await screen.findByLabelText(en.setUp.code);

    press(en.setUp.confirm);
    expect(screen.getByText(en.setUp.codeMissing)).toBeDefined();

    type(en.setUp.code, '000000');
    press(en.setUp.confirm);

    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.second_step_code_wrong);
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeDefined();
  });

  it('begins again when the started set-up is gone on the server', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ secondStep: 'set_up_required' })),
      'POST /api/auth/second-step/set-up': () => json(setUp),
      'POST /api/auth/second-step/confirm': () => refusal('second_step_not_on', 409),
    });
    renderApp('/second-step/set-up');
    await heading(en.setUp.title);
    press(en.setUp.start);
    await screen.findByLabelText(en.setUp.code);

    type(en.setUp.code, '123456');
    press(en.setUp.confirm);

    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.second_step_not_on);
    expect(button(en.setUp.start)).toBeDefined();
  });
});

// docs/spec/12-ux-standards.md, Language: each person chooses a language; the
// choice is remembered.
describe('the language', () => {
  it('changes every text of the page at once', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });
    renderApp('/sign-in', 'uz');
    await heading(uz.signIn.title);

    fireEvent.change(screen.getByLabelText(uz.language.label), { target: { value: 'ru' } });

    expect(await heading(ru.signIn.title)).toBeDefined();
    expect(button(ru.signIn.submit)).toBeDefined();
    expect(screen.getByLabelText(ru.signIn.password)).toBeDefined();
  });

  it('shows a refusal in the chosen language', async () => {
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => refusal('too_many_attempts', 429, 3),
    });
    renderApp('/sign-in', 'ru');
    await heading(ru.signIn.title);

    type(ru.signIn.login, 'a.karimov');
    type(ru.signIn.password, 'a-wrong-password');
    press(ru.signIn.submit);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Слишком много неудачных попыток. Попробуйте снова через 3 секунды.',
    );
  });

  it('is remembered by the browser and named on the page', async () => {
    window.localStorage.clear();
    const i18n = startI18n();
    // jsdom names its browser language en-US.
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    await i18n.changeLanguage('uz');

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('uz');
    expect(document.documentElement.lang).toBe('uz');
    expect(document.title).toBe(uz.app.name);
    expect(startI18n().language).toBe('uz');
  });
});

// Edge cases, "Accounts and sign-in": after five failures each further attempt is delayed.
describe('the wait after too many attempts', () => {
  it('turns the sign-in button on again when the wait is over', async () => {
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => refusal('too_many_attempts', 429, 1),
    });
    renderApp('/sign-in');
    await heading(en.signIn.title);
    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'a-wrong-password');
    press(en.signIn.submit);
    await screen.findByRole('alert');
    expect(button(en.signIn.submit).disabled).toBe(true);

    await waitFor(
      () => {
        expect(button(en.signIn.submit).disabled).toBe(false);
      },
      { timeout: 3_000 },
    );
  });
});

// The reviews of task 0.8a.
describe('the recovery codes', () => {
  const recoveryCodes = Array.from({ length: 10 }, (_, index) => `code-${String(index)}-abcd`);
  const setUp = {
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    address: 'otpauth://totp/Sodiq%20School:s.nazarov?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  };

  // They are shown once: the page is left only after "I have saved the codes".
  it('stay on the page when the person goes back or follows a link before saving them', async () => {
    let session = sessionOf({ secondStep: 'set_up_required' });
    fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/second-step/set-up': () => json(setUp),
      'POST /api/auth/second-step/confirm': () => {
        session = sessionOf({ secondStep: 'passed' });
        return json({ recoveryCodes });
      },
    });
    const { router, queryClient } = renderApp('/second-step/set-up');
    await heading(en.setUp.title);
    press(en.setUp.start);
    await screen.findByLabelText(en.setUp.code);
    type(en.setUp.code, '123456');
    press(en.setUp.confirm);
    await heading(en.setUp.codesTitle);
    // As after a minute on the page: the next page would ask the server, which says "passed".
    await queryClient.invalidateQueries({ queryKey: ['session'], refetchType: 'none' });

    // A refused move never completes: nothing to wait for but time.
    void router.navigate({ to: '/password' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(router.state.location.pathname).toBe('/second-step/set-up');
    expect(screen.getByRole('heading', { name: en.setUp.codesTitle })).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);

    fireEvent.click(screen.getByRole('checkbox', { name: en.setUp.saved }));
    await router.navigate({ to: '/password' });

    expect(await heading(en.password.titleOwn)).toBeDefined();
  });

  // The answer of the confirmation was lost, or the set-up was finished in another tab.
  it.each(['set-up', 'confirm'] as const)(
    'are not waited for when the %s call says the second step is on already: the session decides',
    async (call) => {
      let session = sessionOf({ secondStep: 'set_up_required' });
      const alreadyOn = () => {
        session = sessionOf({ secondStep: 'passed' });
        return refusal('second_step_already_on', 409);
      };
      fakeApi({
        'GET /api/auth/session': () => json(session),
        'POST /api/auth/second-step/set-up': call === 'set-up' ? alreadyOn : () => json(setUp),
        'POST /api/auth/second-step/confirm': alreadyOn,
      });
      renderApp('/second-step/set-up');
      await heading(en.setUp.title);
      press(en.setUp.start);
      if (call === 'confirm') {
        await screen.findByLabelText(en.setUp.code);
        type(en.setUp.code, '123456');
        press(en.setUp.confirm);
      }

      expect(await heading(en.home.title)).toBeDefined();
    },
  );
});

describe('the forced password change', () => {
  // A one-time password can run out while the page is open: the person can still leave.
  it('can be left by signing out', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ mustChangePassword: true })),
      'POST /api/auth/password': () => refusal('password_expired', 403),
      'POST /api/auth/sign-out': nothing,
    });
    renderApp('/password');
    await heading(en.password.titleForced);
    type(en.password.currentOneTime, 'the-first-password');
    type(en.password.new, 'a-new-password-73');
    type(en.password.repeat, 'a-new-password-73');
    press(en.password.submit);
    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.password_expired);

    press(en.layout.signOut);

    expect(await heading(en.signIn.title)).toBeDefined();
    expect(calls.map((one) => one.route)).toContain('POST /api/auth/sign-out');
  });
});

// Edge cases, "Trust this device": trust ends at once on a password change.
describe('a password change on a trusted device', () => {
  it('says beforehand that the trust ends, and afterwards does not blame a one-time password', async () => {
    let session = sessionOf({ trustedUntil: '2026-10-12T04:00:00.000Z' });
    fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/sign-in': () => json(session),
    });
    const { router } = renderApp('/sign-in');
    await heading(en.signIn.title);
    type(en.signIn.login, 'a.karimov');
    type(en.signIn.password, 'the-old-password');
    fireEvent.click(screen.getByRole('checkbox', { name: en.signIn.trust }));
    press(en.signIn.submit);
    await heading(en.home.title);
    fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/password': () => {
        // The server keeps the session and ends its trust.
        session = sessionOf();
        return nothing();
      },
    });

    await router.navigate({ to: '/password' });
    await heading(en.password.titleOwn);
    expect(screen.getByText(en.password.othersEnd).textContent).toContain(
      'this device will no longer be trusted',
    );
    type(en.password.current, 'the-old-password');
    type(en.password.new, 'a-new-password-73');
    type(en.password.repeat, 'a-new-password-73');
    press(en.password.submit);
    await screen.findByText(en.password.changed);
    fireEvent.click(screen.getByRole('link', { name: en.password.back }));

    await heading(en.account.title);
    expect(screen.queryByText(en.layout.notTrusted)).toBeNull();
  });
});
