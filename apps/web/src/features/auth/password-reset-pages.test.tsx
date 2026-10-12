import { MAIL_TEXTS, LANGUAGES } from '@sodiq/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, nothing, refusal, renderApp } from '@/testing/render-app';

const LOCALES = { en, ru, uz } as const;
const TOKEN = 'Q1nv3nted-t0ken-for-the-test-only-abcdefghi';
const CHOSEN = 'a chosen new password 7';

const heading = (name: string) => screen.findByRole('heading', { name });
const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const press = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
};
const signedOut = () => refusal('not_signed_in', 401);

// Task 2.3c-2, pull request #66: the password reset by email
// (docs/spec/02-roles-and-access.md, Accounts and sign-in: build order;
// docs/design-system.md, This app, Sign-in).
describe('"Forgot your password?"', () => {
  it('is a link under the large button of the sign-in page', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });
    renderApp('/sign-in');
    await heading(en.signIn.title);

    const link = screen.getByRole('link', { name: en.signIn.forgot });
    expect(link.getAttribute('href')).toBe('/forgot-password');
    const submit = screen.getByRole('button', { name: en.signIn.submit });
    // Under the button: it follows it in the page.
    expect(submit.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sends the login and then says the same whatever the login is', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/password-reset': () => new Response(null, { status: 202 }),
    });
    renderApp('/forgot-password');
    await heading(en.forgot.title);

    press(en.forgot.submit);
    expect(await screen.findByText(en.forgot.loginMissing)).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/auth/password-reset')).toBe(false);

    type(en.forgot.login, '  d.rahimova ');
    press(en.forgot.submit);
    const sent = await screen.findByRole('status');
    expect(sent.textContent).toBe(en.forgot.sent);
    expect(calls.find((call) => call.route === 'POST /api/auth/password-reset')?.body).toEqual({
      login: 'd.rahimova',
    });
    expect(screen.queryByLabelText(en.forgot.login)).toBeNull();
    expect(screen.getByRole('link', { name: en.forgot.back }).getAttribute('href')).toBe(
      '/sign-in',
    );
  });

  it('speaks Russian', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });
    renderApp('/forgot-password', 'ru');
    expect(await heading(ru.forgot.title)).toBeDefined();
    expect(screen.getByRole('button', { name: ru.forgot.submit })).toBeDefined();
  });
});

describe('the page of the reset link', () => {
  it('reads the token from the fragment, takes it out of the address, and sets the password', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': signedOut,
      'POST /api/auth/password-reset/confirm': nothing,
    });
    const shell = renderApp(`/reset-password#token=${TOKEN}`);
    await heading(en.reset.title);
    await waitFor(() => {
      expect(shell.router.state.location.hash).toBe('');
    });
    expect(shell.router.state.location.pathname).toBe('/reset-password');

    type(en.password.new, 'short');
    expect(await screen.findByText(en.password.tooShort.replace('{{min}}', '10'))).toBeDefined();
    type(en.password.new, CHOSEN);
    type(en.password.repeat, `${CHOSEN}x`);
    press(en.reset.submit);
    expect(await screen.findByText(en.password.mismatch)).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/auth/password-reset/confirm')).toBe(
      false,
    );

    type(en.password.repeat, CHOSEN);
    press(en.reset.submit);
    expect(await heading(en.signIn.title)).toBeDefined();
    expect((await screen.findByRole('status')).textContent).toBe(en.signIn.passwordChanged);
    expect(
      calls.find((call) => call.route === 'POST /api/auth/password-reset/confirm')?.body,
    ).toEqual({ token: TOKEN, newPassword: CHOSEN });

    // `.claude/rules/web.md`, the rule on secrets: nothing keeps the token or the password.
    await waitFor(() => {
      const kept = JSON.stringify(
        shell.queryClient
          .getMutationCache()
          .getAll()
          .map((one) => [one.state.data, one.state.variables]),
      );
      expect(kept).not.toContain(TOKEN);
      expect(kept).not.toContain(CHOSEN);
    });
    const queries = JSON.stringify(
      shell.queryClient
        .getQueryCache()
        .getAll()
        .map((one) => one.state.data),
    );
    expect(queries).not.toContain(TOKEN);
    expect(queries).not.toContain(CHOSEN);
  });

  it.each(['reset_link_invalid', 'reset_link_expired'] as const)(
    'shows %s and offers a new link',
    async (code) => {
      fakeApi({
        'GET /api/auth/session': signedOut,
        'POST /api/auth/password-reset/confirm': () => refusal(code, 400),
      });
      renderApp(`/reset-password#token=${TOKEN}`);
      await heading(en.reset.title);
      type(en.password.new, CHOSEN);
      type(en.password.repeat, CHOSEN);
      press(en.reset.submit);

      expect(await screen.findByText(en.errors[code])).toBeDefined();
      expect(screen.getByRole('link', { name: en.reset.askAgain }).getAttribute('href')).toBe(
        '/forgot-password',
      );
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: en.reset.submit }).disabled,
      ).toBe(true);
    },
  );

  it('says a link without its token is not complete', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });
    renderApp('/reset-password');
    await heading(en.reset.title);
    expect(screen.getByText(en.reset.noToken)).toBeDefined();
    expect(screen.queryByLabelText(en.password.new)).toBeNull();
  });

  it('speaks Russian', async () => {
    fakeApi({ 'GET /api/auth/session': signedOut });
    renderApp(`/reset-password#token=${TOKEN}`, 'ru');
    expect(await heading(ru.reset.title)).toBeDefined();
    expect(screen.getByRole('button', { name: ru.reset.submit })).toBeDefined();
  });
});

// Decision 16 of #66: the mail and the page it opens use the same words.
describe('the texts of the reset mail', () => {
  it('name the mail as the page it opens is titled, in the three languages', () => {
    for (const language of LANGUAGES) {
      expect(MAIL_TEXTS[language].passwordReset.subject).toBe(LOCALES[language].reset.title);
    }
  });
});
