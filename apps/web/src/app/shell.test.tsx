import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
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
  it('shows who is signed in, the main menu, and the language and theme in the person menu', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ login: 'n.saidova' })) });

    renderApp('/');

    await heading(en.home.title);
    expect(screen.getByRole('button', { name: en.layout.account }).textContent).toContain(
      'n.saidova',
    );
    expect(screen.getByRole('navigation', { name: en.layout.menu })).toBeDefined();
    // docs/design-system.md, Layout shell: the person at the foot of the menu
    // holds the language and the theme (pull request #61, decision 3).
    fireEvent.click(screen.getByRole('button', { name: en.layout.account }));
    expect(await screen.findByRole('menuitemradio', { name: 'English' })).toBeDefined();
    expect(screen.getByRole('menuitemradio', { name: en.theme.dark })).toBeDefined();
    // docs/spec/12-ux-standards.md, Look and feel: an empty part says what it is for;
    // the Teacher's home lists the own lessons since task 5.9b, here none.
    expect(await screen.findByText(en.home.lessons.noToday)).toBeDefined();
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

  it.each([
    ['second_step_required', { secondStep: 'pending' }, en.code.title],
    ['password_change_required', { mustChangePassword: true }, en.password.titleForced],
    ['second_step_set_up_required', { secondStep: 'set_up_required' }, en.setUp.title],
  ] as const)(
    'goes to the step the session owes when a call is refused with %s',
    async (code, owed, title) => {
      let session = sessionOf();
      fakeApi({
        'GET /api/auth/session': () => json(session),
        'POST /api/auth/password': () => {
          // Since the page was opened, the session came to owe a step on the server.
          session = sessionOf(owed);
          return refusal(code, 403);
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

      expect(await heading(title)).toBeDefined();
    },
  );

  it('says that sign-out failed and stays signed in', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ secondStep: 'pending' })) });
    const { queryClient } = renderApp('/sign-in/code');

    fireEvent.click(await screen.findByRole('button', { name: en.layout.signOut }));

    expect((await screen.findByRole('alert')).textContent).toBe(en.problems.noAnswer);
    expect(screen.getByRole('heading', { name: en.code.title })).toBeDefined();
    expect(queryClient.getQueryData(['session'])).not.toBeNull();
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

describe('the sign-in page after leaving', () => {
  // Issue #39, hand test of 13 October 2026, finding 9: a chosen sign-out
  // says "You are signed out.", even when a query of the page still on its
  // way is refused once the session is gone.
  it('says "You are signed out." after a chosen sign-out', async () => {
    let signedOut = false;
    fakeApi({
      'GET /api/auth/session': () =>
        signedOut
          ? refusal('not_signed_in', 401)
          : json(sessionOf({ assignments: [{ role: 'super_admin', branchId: null }] })),
      'GET /api/access/super-admins': () =>
        signedOut ? refusal('not_signed_in', 401) : json({ active: 2 }),
      'POST /api/auth/sign-out': () => {
        signedOut = true;
        return nothing();
      },
    });
    const { queryClient, router } = renderApp('/');
    await heading(en.home.title);

    fireEvent.click(await screen.findByRole('button', { name: en.layout.signOut }));

    expect(await heading(en.signIn.title)).toBeDefined();
    expect((await screen.findByRole('status')).textContent).toBe(en.signIn.signedOut);
    // A query of the page that was still on its way is refused afterwards.
    await queryClient
      .fetchQuery({
        queryKey: ['on its way'],
        queryFn: () => answerOf(api.GET('/api/access/super-admins')),
      })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.search).toEqual({ reason: 'signed_out' });
    expect(screen.getByRole('status').textContent).toBe(en.signIn.signedOut);
    expect(screen.queryByText(en.signIn.sessionEnded)).toBeNull();
  });

  it('still says "Your session has ended." when a call finds the session over', async () => {
    let ended = false;
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'GET /api/notifications': () =>
        ended ? refusal('not_signed_in', 401) : json({ notifications: [], unread: 0 }),
    });
    const { queryClient } = renderApp('/');
    await heading(en.home.title);
    ended = true;

    await queryClient.refetchQueries({ queryKey: ['notifications'] });

    expect(await heading(en.signIn.title)).toBeDefined();
    expect(await screen.findByText(en.signIn.sessionEnded)).toBeDefined();
    expect(screen.queryByText(en.signIn.signedOut)).toBeNull();
  });
});

// docs/decisions.md, task 0.8a: the session is asked again when a page opens
// more than a minute after the last answer, never by itself: a call the app
// makes on its own would count as use and keep an idle session alive
// (edge cases, "Accounts and sign-in": sessions end after a period without use).
describe('how often the session is asked for', () => {
  it('asks once for pages opened within a minute, not on focus, and again after a minute', async () => {
    const calls = fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    const asked = () => calls.filter((call) => call.route === 'GET /api/auth/session').length;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const start = new Date('2026-10-05T09:00:00+05:00');
      vi.setSystemTime(start);
      const { router } = renderApp('/');
      await heading(en.home.title);
      expect(asked()).toBe(1);

      await router.navigate({ to: '/password' });
      await heading(en.password.titleOwn);
      vi.setSystemTime(start.getTime() + 59_000);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
      await router.navigate({ to: '/' });
      await heading(en.home.title);
      expect(asked()).toBe(1);

      vi.setSystemTime(start.getTime() + 61_000);
      await router.navigate({ to: '/password' });
      await heading(en.password.titleOwn);
      expect(asked()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('repeats no call by itself', () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });

    const { queryClient } = renderApp('/');

    expect(queryClient.getDefaultOptions().queries).toEqual({
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });
});

// docs/spec/12-ux-standards.md, Look and feel: error messages say what happened.
describe('a fault of the app itself', () => {
  it('is not blamed on the connection', async () => {
    // An answer the app cannot read: the session without its fields.
    fakeApi({ 'GET /api/auth/session': () => json({ login: 5 }) });

    renderApp('/');

    expect(await heading(en.problems.title)).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe(en.problems.unexpected);
  });
});
