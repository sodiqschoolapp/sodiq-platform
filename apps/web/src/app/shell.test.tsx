import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, nothing, refusal, renderApp, sessionOf } from '@/testing/render-app';

const heading = (name: string) => screen.findByRole('heading', { name });

// docs/spec/02-roles-and-access.md, Rules: staff sign in with login and
// password and must change the password at first sign-in; two-step
// verification is required for the Super Admin and Academic Vice Principal.
// The order of the steps is the server's: code, password change, set-up.
describe('the page a session is sent to', () => {
  it.each([
    ['nobody is signed in', refusal('not_signed_in', 401), en.signIn.title],
    ['the session owes the code', json(sessionOf({ secondStep: 'pending' })), en.code.title],
    [
      'the session owes the code and has a first password',
      json(sessionOf({ secondStep: 'pending', mustChangePassword: true })),
      en.code.title,
    ],
    [
      'a first password is in use',
      json(sessionOf({ mustChangePassword: true })),
      en.password.titleForced,
    ],
    [
      'a first password is in use and the second step is not set up',
      json(sessionOf({ mustChangePassword: true, secondStep: 'set_up_required' })),
      en.password.titleForced,
    ],
    [
      'a required second step is not set up',
      json(sessionOf({ secondStep: 'set_up_required' })),
      en.setUp.title,
    ],
    ['the session owes nothing', json(sessionOf({ secondStep: 'passed' })), en.home.title],
  ])('when %s', async (_name, answer, title) => {
    fakeApi({ 'GET /api/auth/session': () => answer.clone() });

    renderApp('/');

    expect(await heading(title)).toBeDefined();
  });

  it.each(['/sign-in', '/sign-in/code', '/second-step/set-up'])(
    'is the home page when a complete session opens %s',
    async (path) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });

      const { router } = renderApp(path);

      expect(await heading(en.home.title)).toBeDefined();
      expect(router.state.location.pathname).toBe('/');
    },
  );

  it.each(['/', '/password', '/second-step/set-up'])(
    'is the code page when a session that owes the code opens %s',
    async (path) => {
      fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ secondStep: 'pending' })) });

      const { router } = renderApp(path);

      expect(await heading(en.code.title)).toBeDefined();
      expect(router.state.location.pathname).toBe('/sign-in/code');
    },
  );

  it('opens the password change by choice for a complete session', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });

    renderApp('/password');

    expect(await heading(en.password.titleOwn)).toBeDefined();
    expect(screen.getByLabelText(en.password.current)).toBeDefined();
  });
});

describe('the app layout', () => {
  it('shows who is signed in, the language chooser and the main menu', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ login: 'n.saidova' })) });

    renderApp('/');

    await heading(en.home.title);
    expect(screen.getByRole('button', { name: en.layout.account }).textContent).toContain(
      'n.saidova',
    );
    expect(screen.getByRole('navigation', { name: en.layout.menu })).toBeDefined();
    expect(screen.getByLabelText(en.language.label)).toBeDefined();
    // docs/spec/12-ux-standards.md, Look and feel: an empty page says what it is for.
    expect(screen.getByText(en.home.empty)).toBeDefined();
  });
});

// docs/spec/12-ux-standards.md, Look and feel: error messages say what happened
// and what to do next; Navigation: every page has its own address.
describe('pages that cannot be opened', () => {
  it('says so when the server does not answer, and opens the page on "Try again"', async () => {
    let up = false;
    fakeApi({
      'GET /api/auth/session': () => (up ? json(sessionOf()) : new Response('', { status: 502 })),
    });

    renderApp('/');

    expect(await heading(en.problems.title)).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe(en.problems.noAnswer);

    up = true;
    fireEvent.click(screen.getByRole('button', { name: en.problems.retry }));

    expect(await heading(en.home.title)).toBeDefined();
  });

  it('has a page for an address that does not exist', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });

    renderApp('/no-such-page');

    expect(await heading(en.problems.notFoundTitle)).toBeDefined();
    expect(screen.getByRole('link', { name: en.problems.toHome })).toBeDefined();
  });
});

// Edge cases, "Accounts and sign-in": sessions end after a period without use,
// and rights are read again on every request.
describe('a session that ended or changed on the server', () => {
  it('goes to the sign-in page with "your session has ended" when a call is refused as not signed in', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ secondStep: 'pending' })),
      'POST /api/auth/second-step': () => refusal('not_signed_in', 401),
    });
    const { router } = renderApp('/sign-in/code');
    fireEvent.change(await screen.findByLabelText(en.code.label), { target: { value: '123456' } });

    fireEvent.click(screen.getByRole('button', { name: en.code.submit }));

    expect(await heading(en.signIn.title)).toBeDefined();
    expect(screen.getByText(en.signIn.sessionEnded)).toBeDefined();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('goes to the step the session owes when a call is refused for that step', async () => {
    let session = sessionOf();
    fakeApi({
      'GET /api/auth/session': () => json(session),
      'POST /api/auth/password': () => {
        // Since the page was opened, an administrator reset the second step and the role requires one.
        session = sessionOf({ secondStep: 'set_up_required' });
        return refusal('second_step_set_up_required', 403);
      },
    });
    renderApp('/password');
    fireEvent.change(await screen.findByLabelText(en.password.current), {
      target: { value: 'the-old-password' },
    });
    fireEvent.change(screen.getByLabelText(en.password.new), {
      target: { value: 'a-new-password-73' },
    });
    fireEvent.change(screen.getByLabelText(en.password.repeat), {
      target: { value: 'a-new-password-73' },
    });

    fireEvent.click(screen.getByRole('button', { name: en.password.submit }));

    expect(await heading(en.setUp.title)).toBeDefined();
  });

  it('signs out from a step page and forgets the session', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ secondStep: 'pending' })),
      'POST /api/auth/sign-out': nothing,
    });
    const { queryClient } = renderApp('/sign-in/code');

    fireEvent.click(await screen.findByRole('button', { name: en.layout.signOut }));

    expect(await heading(en.signIn.title)).toBeDefined();
    expect(screen.queryByText(en.signIn.sessionEnded)).toBeNull();
    expect(queryClient.getQueryData(['session'])).toBeNull();
    await waitFor(() => {
      expect(calls.map((call) => call.route)).toContain('POST /api/auth/sign-out');
    });
  });
});
