import type { Notification, NotificationList } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import {
  fakeApi,
  json,
  NORTH,
  nothing,
  refusal,
  renderApp,
  sessionOf,
  type Handler,
} from '@/testing/render-app';
import { ThemeStore } from '@/theme/theme';
import type { LiveConnector, LiveHandlers } from './live';

const LIST = 'GET /api/notifications';
const READ_ALL = 'POST /api/notifications/read-all';

const MONDAY: Notification = {
  id: '0199c000-0000-7000-8000-000000000001',
  kind: 'sample.message',
  data: { text: 'Monday changed.' },
  branchId: NORTH.id,
  branchName: NORTH.name,
  createdAt: '2026-10-08T04:00:00.000Z',
  readAt: null,
};
const ROOM: Notification = {
  id: '0199c000-0000-7000-8000-000000000002',
  kind: 'sample.message',
  data: { text: 'Room 12 is taken.' },
  branchId: null,
  branchName: null,
  createdAt: '2026-10-07T04:00:00.000Z',
  readAt: '2026-10-07T05:00:00.000Z',
};
const LATER: Notification = {
  id: '0199c000-0000-7000-8000-000000000003',
  kind: 'sample.message',
  data: { text: 'A lesson is about to lock.' },
  branchId: NORTH.id,
  branchName: NORTH.name,
  createdAt: '2026-10-08T05:00:00.000Z',
  readAt: null,
};

const TWO: NotificationList = { unreadCount: 1, items: [MONDAY, ROOM] };

/** A live connection the test drives by hand. */
function fakeLive() {
  const connections: { handlers: LiveHandlers; closed: boolean }[] = [];
  const connect: LiveConnector = (handlers) => {
    const connection = { handlers, closed: false };
    connections.push(connection);
    return {
      close: () => {
        connection.closed = true;
      },
    };
  };
  const last = () => {
    const connection = connections.at(-1);
    if (connection === undefined) {
      throw new Error('No live connection was opened.');
    }
    return connection;
  };
  return { connect, connections, last };
}

/** The app on the home page with the given answers; the rest is the usual. */
function open(handlers: Record<string, Handler> = {}, language: 'en' | 'ru' = 'en') {
  const live = fakeLive();
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf()),
    [LIST]: () => json(TWO),
    [READ_ALL]: nothing,
    ...handlers,
  });
  const shell = renderApp('/', language, new ThemeStore(), live.connect);
  return {
    ...shell,
    calls,
    live,
    callsTo: (route: string) => calls.filter((c) => c.route === route),
  };
}

const t = { en, ru };

/** The bell of the top bar, also while the dialog in front of it hides the page. */
const bell = (language: 'en' | 'ru', unread?: number) =>
  screen.findByRole('button', {
    name:
      unread === undefined
        ? t[language].notifications.button
        : new RegExp(`^${t[language].notifications.title}, ${String(unread)} `),
    hidden: true,
  });

async function openDialog(language: 'en' | 'ru' = 'en', unread?: number) {
  fireEvent.click(await bell(language, unread));
  return screen.findByRole('dialog', { name: t[language].notifications.title });
}

const items = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('listitem')
    .map((item) => item.textContent ?? '');

// docs/spec/10-portal-notifications-release-2.md, last paragraph: staff
// notifications in the app are Release 1. docs/build-plan.md, task 0.9: the
// list and unread count in the top bar; live arrival. Decided by the owner at
// the plan: the text is made here from the kind and its data, in the language
// of the tab; the panel is a dialog, not a page; nothing polls.
describe('the notifications of the top bar', () => {
  it('show the unread count on the bell and the latest ones in the dialog, newest first, with the branch and the unread mark', async () => {
    open();

    const dialog = await openDialog('en', 1);

    const shown = items(dialog);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain('Sample: Monday changed.');
    expect(shown[0]).toContain(NORTH.name);
    expect(shown[0]).toContain(en.notifications.unread);
    expect(shown[1]).toContain('Sample: Room 12 is taken.');
    expect(shown[1]).not.toContain(en.notifications.unread);
    const buttons = within(dialog)
      .getAllByRole('listitem')
      .map((item) => within(item).getByRole('button'));
    expect(buttons[0]?.hasAttribute('disabled')).toBe(false);
    expect(buttons[1]?.hasAttribute('disabled')).toBe(true);
  });

  it('speak the language of the tab', async () => {
    open({}, 'ru');

    const dialog = await openDialog('ru', 1);

    expect(within(dialog).getByText(ru.notifications.text)).toBeDefined();
    expect(items(dialog)[0]).toContain('Пример: Monday changed.');
    expect(items(dialog)[0]).toContain(ru.notifications.unread);
  });

  it('mark one read on a click and ask the list again', async () => {
    let marked = false;
    const { callsTo } = open({
      [LIST]: () =>
        json(
          marked
            ? { unreadCount: 0, items: [{ ...MONDAY, readAt: '2026-10-08T06:00:00.000Z' }, ROOM] }
            : TWO,
        ),
      [`POST /api/notifications/${MONDAY.id}/read`]: () => {
        marked = true;
        return nothing();
      },
    });
    const dialog = await openDialog('en', 1);

    fireEvent.click(
      within(within(dialog).getAllByRole('listitem')[0] ?? dialog).getByRole('button'),
    );

    await waitFor(() => {
      expect(callsTo(`POST /api/notifications/${MONDAY.id}/read`)).toHaveLength(1);
    });
    expect(await bell('en')).toBeDefined();
    expect(callsTo(LIST)).toHaveLength(2);
    expect(items(dialog)[0]).not.toContain(en.notifications.unread);
  });

  it('mark all read and ask the list again', async () => {
    let marked = false;
    const { callsTo } = open({
      [LIST]: () => json(marked ? { unreadCount: 0, items: [] } : TWO),
      [READ_ALL]: () => {
        marked = true;
        return nothing();
      },
    });
    const dialog = await openDialog('en', 1);

    fireEvent.click(within(dialog).getByRole('button', { name: en.notifications.markAllRead }));

    expect(await bell('en')).toBeDefined();
    expect(callsTo(READ_ALL)).toHaveLength(1);
    expect(callsTo(LIST)).toHaveLength(2);
    expect(within(dialog).getByText(en.notifications.empty)).toBeDefined();
    expect(
      within(dialog)
        .getByRole('button', { name: en.notifications.markAllRead })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('show what the server refused and offer to try again', async () => {
    let failed = false;
    open({
      [LIST]: () => {
        if (failed) {
          return json(TWO);
        }
        failed = true;
        return refusal('internal_error', 500);
      },
    });

    const dialog = await openDialog('en');

    expect((await within(dialog).findByRole('alert')).textContent).toBe(en.errors.internal_error);
    fireEvent.click(within(dialog).getByRole('button', { name: en.problems.retry }));
    await waitFor(() => {
      expect(items(dialog)).toHaveLength(2);
    });
  });

  it('say so when there is nothing yet', async () => {
    open({ [LIST]: () => json({ unreadCount: 0, items: [] }) });

    const dialog = await openDialog('en');

    expect(within(dialog).getByText(en.notifications.empty)).toBeDefined();
  });

  it('show a kind this version does not know as such, instead of nothing', async () => {
    open({
      [LIST]: () =>
        json({
          unreadCount: 1,
          items: [{ ...MONDAY, kind: 'timetable.changed', data: { date: '2026-10-09' } }],
        }),
    });

    const dialog = await openDialog('en', 1);

    expect(items(dialog)[0]).toContain(en.notifications.kinds.unknown);
  });

  it('close with the Close button and with Escape', async () => {
    open();
    const dialog = await openDialog('en', 1);

    fireEvent.click(within(dialog).getByRole('button', { name: en.notifications.close }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    const again = await openDialog('en', 1);
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('arrive live', () => {
    it('as a new notification, without a call to the API, each id once', async () => {
      const { live, callsTo } = open();
      await bell('en', 1);

      live.last().handlers.onNew([LATER]);

      expect(await bell('en', 2)).toBeDefined();
      const dialog = await openDialog('en', 2);
      expect(items(dialog)[0]).toContain('Sample: A lesson is about to lock.');
      expect(items(dialog)).toHaveLength(3);

      live.last().handlers.onNew([LATER, LATER]);
      await waitFor(() => {
        expect(items(dialog)).toHaveLength(3);
      });
      expect(await bell('en', 2)).toBeDefined();
      expect(callsTo(LIST)).toHaveLength(1);
    });

    it('as a read mark made in another tab, and as "read all"', async () => {
      const { live } = open();
      await bell('en', 1);
      live.last().handlers.onNew([LATER]);
      await bell('en', 2);

      live.last().handlers.onRead([MONDAY.id], '2026-10-08T06:00:00.000Z');

      expect(await bell('en', 1)).toBeDefined();
      const dialog = await openDialog('en', 1);
      expect(items(dialog)[0]).toContain(en.notifications.unread);
      expect(items(dialog)[1]).not.toContain(en.notifications.unread);

      live.last().handlers.onReadAll('2026-10-08T07:00:00.000Z');

      expect(await bell('en')).toBeDefined();
      expect(items(dialog).some((text) => text.includes(en.notifications.unread))).toBe(false);
    });

    it('as the state at a connection, which replaces what the tab holds', async () => {
      const { live } = open();
      await bell('en', 1);

      live.last().handlers.onState({ unreadCount: 7, items: [LATER] });

      expect(await bell('en', 7)).toBeDefined();
      const dialog = await openDialog('en', 7);
      expect(items(dialog)).toHaveLength(1);
    });
  });

  describe('keep one live connection', () => {
    it('while the session is complete, and close it at sign-out', async () => {
      const { live } = open({ 'POST /api/auth/sign-out': nothing });
      await bell('en', 1);
      expect(live.connections).toHaveLength(1);
      expect(live.last().closed).toBe(false);

      fireEvent.click(screen.getByRole('button', { name: en.layout.account }));
      fireEvent.click(await screen.findByRole('menuitem', { name: en.layout.signOut }));

      await screen.findByRole('heading', { name: en.signIn.title });
      expect(live.last().closed).toBe(true);
      expect(live.connections).toHaveLength(1);
    });

    it('and none while a step of sign-in is owed', async () => {
      const { live } = open({
        'GET /api/auth/session': () => json(sessionOf({ mustChangePassword: true })),
      });

      await screen.findByRole('heading', { name: en.password.titleForced });

      expect(live.connections).toHaveLength(0);
    });

    it('and when the server ends it, ask the API about the session and go where it says', async () => {
      let ended = false;
      const { live, callsTo } = open({
        'GET /api/auth/session': () => (ended ? refusal('not_signed_in', 401) : json(sessionOf())),
      });
      await bell('en', 1);
      const before = callsTo('GET /api/auth/session').length;

      ended = true;
      live.last().handlers.onEnded('not_signed_in');

      await screen.findByRole('heading', { name: en.signIn.title });
      expect(callsTo('GET /api/auth/session').length).toBe(before + 1);
      expect(live.connections).toHaveLength(1);
    });

    it('and open no new one for the same session answer after the server ended it', async () => {
      const { live, callsTo } = open();
      await bell('en', 1);
      const before = callsTo('GET /api/auth/session').length;

      live.last().handlers.onEnded('cross_site_request');

      await waitFor(() => {
        expect(callsTo('GET /api/auth/session').length).toBe(before + 1);
      });
      expect(await bell('en', 1)).toBeDefined();
      expect(live.connections).toHaveLength(1);
    });
  });
});
