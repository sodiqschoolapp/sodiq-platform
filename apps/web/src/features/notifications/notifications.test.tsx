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

  // docs/design-system.md, What we never do 4 and 12: a count is a plain
  // number, and an unread item has its word, never a dot (pull request #60).
  it('show the count as a plain number and mark an unread item by its word, without a dot or a badge', async () => {
    open();

    const button = await bell('en', 1);
    const count = button.querySelector('[data-unread-count]');
    expect(count?.textContent).toBe('1');
    expect(count?.className).not.toMatch(/rounded-full|bg-primary/);

    const dialog = await openDialog('en', 1);
    const unreadItem = within(dialog).getAllByRole('listitem')[0];
    expect(unreadItem?.textContent).toContain(en.notifications.unread);
    expect(unreadItem?.querySelector('.rounded-full')).toBeNull();
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

  // Task 5.5c-3a: "One notice per person per event, with the week before and
  // after" (edge/timetable, After publishing); a one-day cancel is shown as
  // such (review correction 3), a line that differs says so in words.
  describe('a notice of a timetable change', () => {
    const lesson = {
      date: '2026-10-19',
      start: '08:00',
      end: '08:45',
      unit: '7 Oxford',
      subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
      room: 'Room 101',
      cancelled: false,
      changed: false,
    };
    const PUBLISHED: Notification = {
      ...MONDAY,
      kind: 'timetable.published',
      data: {
        number: '3',
        weekStart: '2026-10-19',
        before: [
          { ...lesson, changed: true },
          { ...lesson, date: '2026-10-20', cancelled: true },
        ],
        after: [
          { ...lesson, date: '2026-10-20', cancelled: true },
          { ...lesson, date: '2026-10-21', room: null, changed: true },
        ],
      },
    };
    const WITHDRAWN: Notification = {
      ...ROOM,
      kind: 'timetable.withdrawn',
      data: {
        number: '4',
        weekStart: '2026-11-09',
        before: [{ ...lesson, changed: true }],
        after: [],
      },
    };
    const lines = (dialog: HTMLElement, side: 'week-before' | 'week-after') =>
      within(dialog)
        .getAllByTestId(side)
        .map((list) => [...list.querySelectorAll('li')].map((one) => one.textContent));

    // Task 5.6c-3a (decision 7): an exam a publish or a withdraw cancelled
    // rides in the event's own notice, with the week or alone.
    it('names the exams a publish or a withdraw cancelled, with the week or without one', async () => {
      const withExam: Notification = {
        ...PUBLISHED,
        data: {
          ...PUBLISHED.data,
          examsCancelled: [{ title: 'Quarter exam', date: '2026-10-19' }],
        },
      };
      const examOnly: Notification = {
        ...WITHDRAWN,
        data: { number: '4', examsCancelled: [{ title: 'Spring exam', date: '2026-11-10' }] },
      };
      open({ [LIST]: () => json({ unreadCount: 2, items: [withExam, examOnly] }) });
      const dialog = await openDialog('en', 2);
      const parts = [...dialog.querySelectorAll<HTMLElement>('[data-exams-cancelled]')];
      expect(parts.map((one) => one.textContent)).toEqual([
        en.notifications.exam.cancelledBy
          .replace('{{title}}', 'Quarter exam')
          .replace('{{date}}', '19 October 2026'),
        en.notifications.exam.cancelledBy
          .replace('{{title}}', 'Spring exam')
          .replace('{{date}}', '10 November 2026'),
      ]);
      // The withdrawn notice without a week draws none.
      expect(within(dialog).getAllByTestId('week-before')).toHaveLength(1);
    });

    it('shows the text and the week before and after, the changed and cancelled lines marked', async () => {
      open({ [LIST]: () => json({ unreadCount: 1, items: [PUBLISHED, WITHDRAWN] }) });
      const dialog = await openDialog('en', 1);
      expect(
        within(dialog).getByText(
          en.notifications.kinds.timetable.published.replace('{{number}}', '3'),
        ),
      ).toBeDefined();
      expect(within(dialog).getByText('Week of 19 October 2026')).toBeDefined();
      const [before, withdrawnBefore] = lines(dialog, 'week-before');
      expect(before).toEqual([
        'Monday, 19 October · 08:00–08:45 · 7 Oxford · Mathematics · Room 101 · changed',
        'Tuesday, 20 October · 08:00–08:45 · 7 Oxford · Mathematics · Room 101 · cancelled',
      ]);
      expect(lines(dialog, 'week-after')).toEqual([
        [
          'Tuesday, 20 October · 08:00–08:45 · 7 Oxford · Mathematics · Room 101 · cancelled',
          'Wednesday, 21 October · 08:00–08:45 · 7 Oxford · Mathematics · no room · changed',
        ],
      ]);
      // A withdraw that leaves the teacher no lesson that week.
      expect(withdrawnBefore).toEqual([
        'Monday, 19 October · 08:00–08:45 · 7 Oxford · Mathematics · Room 101 · changed',
      ]);
      expect(within(dialog).getByText(en.notifications.week.none)).toBeDefined();
      expect(
        within(dialog).getByText(
          en.notifications.kinds.timetable.withdrawn.replace('{{number}}', '4'),
        ),
      ).toBeDefined();
    });

    it('speaks the language of the tab', async () => {
      open({ [LIST]: () => json({ unreadCount: 1, items: [PUBLISHED] }) }, 'ru');
      const dialog = await openDialog('ru', 1);
      expect(
        within(dialog).getByText(
          ru.notifications.kinds.timetable.published.replace('{{number}}', '3'),
        ),
      ).toBeDefined();
      expect(lines(dialog, 'week-after')[0]?.[1]).toBe(
        'Среда, 21 октября · 08:00–08:45 · 7 Oxford · Математика · без кабинета · изменён',
      );
    });

    // Task 5.5c-3b, decision 3: a Tutor change carries the week and no number.
    it('shows the week before and after of a Tutor change', async () => {
      const TUTOR: Notification = {
        ...ROOM,
        kind: 'timetable.tutor_changed',
        data: {
          weekStart: '2026-10-19',
          before: [{ ...lesson, date: '2026-10-22', changed: true }],
          after: [],
        },
      };
      open({ [LIST]: () => json({ unreadCount: 1, items: [TUTOR] }) });
      const dialog = await openDialog('en', 1);
      expect(
        within(dialog).getByText(en.notifications.kinds.timetable.tutor_changed),
      ).toBeDefined();
      expect(lines(dialog, 'week-before')).toEqual([
        ['Thursday, 22 October · 08:00–08:45 · 7 Oxford · Mathematics · Room 101 · changed'],
      ]);
      expect(within(dialog).getByText(en.notifications.week.none)).toBeDefined();
    });

    // Task 5.6a-2, decision 11: a one-day move into another week shows both weeks.
    it('shows the second week of a one-day move into another week', async () => {
      const MOVED: Notification = {
        ...ROOM,
        kind: 'timetable.day_changed',
        data: {
          weekStart: '2026-10-19',
          before: [{ ...lesson, changed: true }],
          after: [],
          also: {
            weekStart: '2026-10-26',
            before: [],
            after: [{ ...lesson, date: '2026-10-27', changed: true }],
          },
        },
      };
      open({ [LIST]: () => json({ unreadCount: 1, items: [MOVED] }) });
      const dialog = await openDialog('en', 1);
      expect(within(dialog).getByText('Week of 19 October 2026')).toBeDefined();
      expect(within(dialog).getByText('Week of 26 October 2026')).toBeDefined();
      expect(lines(dialog, 'week-before')).toEqual([
        ['Monday, 19 October · 08:00–08:45 · 7 Oxford · Mathematics · Room 101 · changed'],
      ]);
      expect(
        within(dialog)
          .getAllByTestId('also-after')
          .map((list) => [...list.querySelectorAll('li')].map((one) => one.textContent)),
      ).toEqual([
        ['Tuesday, 27 October · 08:00–08:45 · 7 Oxford · Mathematics · Room 101 · changed'],
      ]);
    });

    // Task 5.6c-2 (plan test 18; From line of 5.6c-2): an exam's notice shows
    // the action and the person's invigilation, in the language of the tab.
    it('shows the action of an exam and the invigilation under its text', async () => {
      const EXAM: Notification = {
        ...ROOM,
        kind: 'timetable.exam_changed',
        data: {
          action: 'changed',
          title: 'Quarter exam',
          date: '2026-10-19',
          invigilation: { start: '08:00', end: '09:30', room: 'Hall' },
        },
      };
      const NONE: Notification = {
        ...EXAM,
        id: '0199c000-0000-7000-8000-000000000009',
        data: {
          action: 'cancelled',
          title: 'Quarter exam',
          date: '2026-10-19',
          invigilation: null,
        },
      };
      open({ [LIST]: () => json({ unreadCount: 1, items: [EXAM, NONE] }) }, 'ru');
      const dialog = await openDialog('ru', 1);
      const changed = dialog.querySelector('[data-exam-notice="changed"]');
      expect([...(changed?.querySelectorAll('p') ?? [])].map((one) => one.textContent)).toEqual([
        ru.notifications.exam.changed,
        'Вы наблюдаете 08:00–09:30 в кабинете Hall.',
      ]);
      const cancelled = dialog.querySelector('[data-exam-notice="cancelled"]');
      expect([...(cancelled?.querySelectorAll('p') ?? [])].map((one) => one.textContent)).toEqual([
        ru.notifications.exam.cancelled,
      ]);
    });

    it('shows no week for data it cannot read', async () => {
      open({
        [LIST]: () =>
          json({
            unreadCount: 1,
            items: [{ ...PUBLISHED, data: { number: '3', weekStart: 'x' } }],
          }),
      });
      const dialog = await openDialog('en', 1);
      expect(within(dialog).queryAllByTestId('week-before')).toEqual([]);
    });
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

      // The sign-out button at the foot of the menu (docs/design-system.md, Layout shell).
      fireEvent.click(screen.getByRole('button', { name: en.layout.signOut }));

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
