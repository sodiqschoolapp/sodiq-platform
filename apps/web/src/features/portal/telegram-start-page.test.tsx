import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, nothing, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { captureTelegramLaunch, forgetTelegramLaunch, telegramLaunchData } from './telegram';

// Task 11.4, pull request #298: the page the school's bot opens. All names, logins and launch
// data are invented; the server checks the signature, the page only hands the data on.
const LAUNCH = 'auth_date=1793000000&query_id=AAHinvented&user=%7B%22id%22%3A7001%7D&hash=ab12';
const PARENT = sessionOf({
  login: 'd.karimova',
  kind: 'parent',
  fullName: 'Dilfuza Karimova',
  assignments: [],
  branches: [],
});

describe('the start page of the mini app', () => {
  beforeEach(() => {
    captureTelegramLaunch(`#tgWebAppData=${encodeURIComponent(LAUNCH)}&tgWebAppVersion=8.0`);
  });

  afterEach(() => {
    forgetTelegramLaunch();
  });

  it('keeps the launch data from the address, before the router changes it', () => {
    expect(telegramLaunchData()).toBe(LAUNCH);
  });

  it('opens the portal from a linked chat without the password', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => refusal('not_signed_in', 401),
      'POST /api/auth/sign-in': () => json(PARENT),
      'GET /api/portal/children': () => json({ children: [] }),
    });
    renderApp('/portal/telegram');
    await screen.findByText(en.portal.noChild);
    expect(calls.find((call) => call.route === 'POST /api/auth/sign-in')?.body).toEqual({
      telegramInitData: LAUNCH,
    });
  });

  it('asks for the login and password once when the chat is not linked, and sends the launch with them', async () => {
    let signIns = 0;
    const calls = fakeApi({
      'GET /api/auth/session': () => refusal('not_signed_in', 401),
      'POST /api/auth/sign-in': () => {
        signIns += 1;
        return signIns === 1 ? refusal('telegram_sign_in_needed', 401) : json(PARENT);
      },
      'GET /api/portal/children': () => json({ children: [] }),
    });
    renderApp('/portal/telegram');
    const login = await screen.findByLabelText(en.signIn.login);
    // "Not linked" is the next step, not a failure.
    expect(screen.queryByText(en.errors.telegram_sign_in_needed)).toBeNull();
    fireEvent.change(login, { target: { value: 'd.karimova' } });
    fireEvent.change(screen.getByLabelText(en.signIn.password), {
      target: { value: 'invented-password-12' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));
    await screen.findByText(en.portal.noChild);
    expect(calls.filter((call) => call.route === 'POST /api/auth/sign-in').at(-1)?.body).toEqual({
      login: 'd.karimova',
      password: 'invented-password-12',
      telegramInitData: LAUNCH,
    });
  });

  it('says so when the chat is linked to another parent account', async () => {
    fakeApi({
      'GET /api/auth/session': () => refusal('not_signed_in', 401),
      'POST /api/auth/sign-in': (body) =>
        typeof body === 'object' && body !== null && 'login' in body
          ? refusal('telegram_chat_linked', 409)
          : refusal('telegram_sign_in_needed', 401),
    });
    renderApp('/portal/telegram');
    fireEvent.change(await screen.findByLabelText(en.signIn.login), {
      target: { value: 'd.karimova' },
    });
    fireEvent.change(screen.getByLabelText(en.signIn.password), {
      target: { value: 'invented-password-12' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));
    await screen.findByText(en.errors.telegram_chat_linked);
  });

  it('goes to the forced password change first, which sends the launch again', async () => {
    let session = sessionOf({ ...PARENT, mustChangePassword: true });
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/sign-in': () => json(session),
      'POST /api/auth/password': () => {
        session = PARENT;
        return nothing();
      },
      'GET /api/portal/children': () => json({ children: [] }),
    });
    renderApp('/portal/telegram');
    fireEvent.change(await screen.findByLabelText(en.password.currentOneTime), {
      target: { value: 'First-Slip-Pass-1' },
    });
    fireEvent.change(screen.getByLabelText(en.password.new), {
      target: { value: 'a-new-password-73' },
    });
    fireEvent.change(screen.getByLabelText(en.password.repeat), {
      target: { value: 'a-new-password-73' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.password.submit }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/auth/password')?.body).toEqual({
        currentPassword: 'First-Slip-Pass-1',
        newPassword: 'a-new-password-73',
        telegramInitData: LAUNCH,
      });
    });
  });
});

describe('the start page outside Telegram', () => {
  it('is the ordinary sign-in', async () => {
    forgetTelegramLaunch();
    fakeApi({ 'GET /api/auth/session': () => refusal('not_signed_in', 401) });
    renderApp('/portal/telegram');
    await screen.findByRole('heading', { name: en.signIn.title });
  });
});
