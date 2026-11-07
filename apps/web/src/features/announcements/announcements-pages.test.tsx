import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  Announcement,
  AnnouncementList,
  AnnouncementMonth,
  PortalChildren,
  Role,
} from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// Task 11.7: announcements and events, the staff pages and the portal page. All names are
// invented.
/** The value of the option of a select that shows a text. */
const optionValue = (select: HTMLElement, text: string): string =>
  [...select.querySelectorAll('option')].find((one) => one.textContent === text)?.value ?? '';

const staff = (role: Role) =>
  sessionOf({ assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }] });

const NEWS = '0190a000-0000-7000-8000-0000000000a1';
const EVENT = '0190a000-0000-7000-8000-0000000000a2';
const ANVAR = '0190a000-0000-7000-8000-00000000000a';

const MONTH: AnnouncementMonth = {
  month: '2026-10',
  today: '2026-10-13',
  announcements: [
    {
      id: EVENT,
      kind: 'event',
      title: 'Open doors',
      body: 'Parents are welcome.',
      event: {
        firstDate: '2026-10-20',
        lastDate: '2026-10-21',
        startsAt: '09:00',
        endsAt: '12:30',
        place: 'Main hall',
      },
      schoolWide: false,
      publishedAt: '2026-10-13T05:00:00.000Z',
      editedAt: null,
    },
    {
      id: NEWS,
      kind: 'news',
      title: 'Sports day',
      body: 'All classes meet in the yard.',
      event: null,
      schoolWide: true,
      publishedAt: '2026-10-12T05:00:00.000Z',
      editedAt: null,
    },
  ],
};

const ROW = (over: Partial<Announcement> = {}): Announcement => ({
  ...(MONTH.announcements[1] as Announcement),
  audience: { kind: 'branch' },
  forStaff: true,
  forParents: true,
  version: 1,
  archived: false,
  canChange: true,
  deliveries: { due: 0, delivered: 12, notDelivered: 1 },
  ...over,
});

const LIST = (over: Partial<AnnouncementList> = {}): AnnouncementList => ({
  announcements: [ROW()],
  mayWriteSchool: false,
  ...over,
});

describe('the staff page of announcements', () => {
  it('lists what is addressed to the person, with an event’s dates, times and place', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(staff('teacher')),
      'GET /api/announcements-feed': () => json(MONTH),
    });
    renderApp('/announcements');
    await screen.findByRole('heading', { name: en.announcements.title, level: 1 });
    const event = await screen.findByRole('heading', { name: 'Open doors' });
    const card = event.closest('article');
    expect(card?.querySelector('[data-when]')?.textContent).toBe(
      '20 October – 21 October, 09:00–12:30 · Main hall',
    );
    expect(screen.getByText(new RegExp(en.announcements.schoolWide))).toBeDefined();
    // A Teacher writes nothing: no link to the authors' list.
    expect(screen.queryByRole('link', { name: en.announcements.manage.link })).toBeNull();
  });

  it('shows the events on a calendar of the month, today marked', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(staff('principal')),
      'GET /api/announcements-feed': () => json(MONTH),
    });
    renderApp('/announcements?view=calendar');
    const grid = await screen.findByRole('grid');
    const day = grid.querySelector('[data-date="2026-10-21"]');
    expect(day?.textContent).toContain('Open doors');
    expect(grid.querySelector('[data-date="2026-10-13"]')?.getAttribute('aria-current')).toBe(
      'date',
    );
    // News is in the list, not on the calendar.
    expect(grid.textContent).not.toContain('Sports day');
  });

  it('asks for the month chosen', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(staff('teacher')),
      'GET /api/announcements-feed': () => json(MONTH),
    });
    renderApp('/announcements');
    await screen.findByRole('heading', { name: 'Open doors' });
    fireEvent.click(screen.getByRole('button', { name: en.announcements.nextMonth }));
    await waitFor(() => {
      expect(calls.some((call) => call.query === '?month=2026-11')).toBe(true);
    });
  });
});

describe('the authors’ list', () => {
  it.each([
    ['academic_vice_principal', LIST(), false],
    ['super_admin', LIST({ mayWriteSchool: true }), true],
  ] as const)(
    'offers the whole school to the Super Admin only (%s)',
    async (role, list, offered) => {
      {
        fakeApi({
          'GET /api/auth/session': () => json(staff(role)),
          'GET /api/announcements': () => json(list),
          'GET /api/classes': () => json({ classes: [] }),
        });
        renderApp('/announcements/manage');
        fireEvent.click(await screen.findByRole('button', { name: en.announcements.manage.add }));
        const audience = await screen.findByLabelText(en.announcements.form.audience);
        const options = [...audience.querySelectorAll('option')].map((one) => one.textContent);
        expect(options.includes(en.announcements.audience.school), role).toBe(offered);
      }
    },
  );

  it('sends a new event for grades with a request key, and shows the counts of messages', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(staff('academic_vice_principal')),
      'GET /api/announcements': () => json(LIST()),
      'GET /api/classes': () => json({ classes: [] }),
      'POST /api/announcements': () => json(ROW({ id: EVENT }), 201),
    });
    renderApp('/announcements/manage');
    const row = await screen.findByRole('row', { name: /Sports day/ });
    expect(within(row).getByText('Delivered: 12 · waiting: 0 · not delivered: 1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: en.announcements.manage.add }));
    const kind = await screen.findByLabelText(en.announcements.form.kind);
    fireEvent.change(kind, {
      target: {
        value: optionValue(kind, en.announcements.kind.event),
      },
    });
    fireEvent.change(screen.getByLabelText(en.announcements.form.title), {
      target: { value: 'Open doors' },
    });
    fireEvent.change(screen.getByLabelText(en.announcements.form.body), {
      target: { value: 'Parents are welcome.' },
    });
    fireEvent.change(screen.getByLabelText(en.announcements.form.firstDate), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(screen.getByLabelText(en.announcements.form.lastDate), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(screen.getByLabelText(en.announcements.form.audience), {
      target: {
        value: optionValue(
          screen.getByLabelText(en.announcements.form.audience),
          en.announcements.audience.grades,
        ),
      },
    });
    fireEvent.click(screen.getByLabelText('Grade 7'));
    fireEvent.click(screen.getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/announcements')).toBe(true);
    });
    const sent = calls.find((call) => call.route === 'POST /api/announcements');
    expect(sent?.body).toEqual({
      kind: 'event',
      title: 'Open doors',
      body: 'Parents are welcome.',
      event: {
        firstDate: '2026-10-20',
        lastDate: '2026-10-20',
        startsAt: null,
        endsAt: null,
        place: null,
      },
      audience: { kind: 'grades', grades: [7] },
      forStaff: true,
      forParents: true,
    });
  });

  it('does not offer to change a whole-school announcement to a Vice Principal', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(staff('spiritual_vice_principal')),
      'GET /api/announcements': () =>
        json(LIST({ announcements: [ROW({ audience: { kind: 'school' }, canChange: false })] })),
    });
    renderApp(`/announcements/manage?open=${NEWS}`);
    await screen.findByText(en.announcements.manage.schoolOnly);
    expect(screen.queryByRole('button', { name: en.form.edit })).toBeNull();
    expect(screen.queryByRole('button', { name: en.announcements.manage.archive })).toBeNull();
  });
});

describe('the portal page of announcements', () => {
  const CHILDREN: PortalChildren = {
    children: [{ id: ANVAR, firstName: 'Anvar', lastName: 'Karimov', className: '7 Oxford' }],
  };
  const PARENT = sessionOf({
    login: 'd.karimova',
    kind: 'parent',
    fullName: 'Dilfuza Karimova',
    assignments: [],
    branches: [],
    language: 'ru',
  });

  it('shows the child’s announcements in Russian, with the tab of the frame', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT),
      'GET /api/portal/children': () => json(CHILDREN),
      [`GET /api/portal/children/${ANVAR}/announcements`]: () => json(MONTH),
    });
    renderApp(`/portal/${ANVAR}/announcements`);
    await screen.findByRole('heading', { name: 'Open doors' });
    expect(
      screen
        .getByRole('link', { name: ru.portal.announcements.title })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByText(new RegExp(ru.announcements.schoolWide))).toBeDefined();
  });

  it('opens the announcements of the first child from the bot’s button', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(PARENT),
      'GET /api/portal/children': () => json(CHILDREN),
      [`GET /api/portal/children/${ANVAR}/announcements`]: () => json(MONTH),
    });
    renderApp('/portal?to=announcements');
    await screen.findByRole('heading', { name: 'Open doors' });
  });
});
