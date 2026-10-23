import type { Reset, ResetEntries, Role } from '@sodiq/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 6.1c, pull request #209: the entries made
// within 48 hours of a password reset (edge cases, Accounts and sign-in).
const BY_ADMIN: Reset = {
  id: uid(1),
  kind: 'administrator',
  at: '2026-10-12T04:00:00.000Z',
  person: { accountId: uid(2), login: 'n.rahimova', name: 'Rahimova Nodira' },
  by: { accountId: uid(3), login: 'd.saidova', name: 'Saidova Dilnoza' },
  emailChangedBy: null,
  entries: [
    {
      id: uid(4),
      changedAt: '2026-10-12T05:00:00.000Z',
      lesson: {
        date: '2026-10-12',
        startsAt: '2026-10-12T03:00:00.000Z',
        subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        taughtTo: '7 Oxford',
        cancelled: false,
      },
      attendance: true,
      workKind: null,
      before: 1,
      after: 0,
      changedHow: 'entry',
      student: { id: uid(5), uid: '2607001', firstName: 'Gulnoza', lastName: 'Ismoilova' },
    },
  ],
  // Task 8.1: a total set in the 48 hours.
  workEntries: [
    {
      id: uid(8),
      workId: uid(9),
      workKind: 'classwork',
      changedAt: '2026-10-12T05:10:00.000Z',
      lesson: {
        date: '2026-10-12',
        startsAt: '2026-10-12T03:00:00.000Z',
        subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        taughtTo: '7 Oxford',
        cancelled: false,
      },
      totalBefore: null,
      totalAfter: 30,
      notHeldBefore: false,
      notHeldAfter: false,
      changedHow: 'entry',
      changedBy: { accountId: uid(2), login: 'n.rahimova', name: 'Rahimova Nodira' },
    },
  ],
  ratingEntries: [],
  commentEntries: [],
};

const BY_EMAIL: Reset = {
  id: uid(6),
  kind: 'email',
  at: '2026-10-11T04:00:00.000Z',
  person: { accountId: uid(7), login: 'k.qodirov', name: 'Qodirov Kamol' },
  by: { accountId: uid(7), login: 'k.qodirov', name: 'Qodirov Kamol' },
  emailChangedBy: {
    accountId: uid(3),
    login: 'd.saidova',
    name: 'Saidova Dilnoza',
    at: '2026-10-11T03:00:00.000Z',
  },
  entries: [],
  workEntries: [],
  ratingEntries: [],
  commentEntries: [],
};

const ROUTE = 'GET /api/people/accounts/reset-entries';

function open(
  role: Role,
  answer: ResetEntries | 'fail',
  language: 'en' | 'ru' | 'uz' = 'en',
  path = '/people/reset-entries',
) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          language,
          assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
        }),
      ),
    [ROUTE]: () => (answer === 'fail' ? refusal('internal_error', 500) : json(answer)),
  });
  renderApp(path, language);
  return calls;
}

const answer = (resets: Reset[]): ResetEntries => ({
  from: '2026-09-13',
  to: '2026-10-12',
  resets,
});

const card = (name: string) => screen.getByRole('region', { name });

describe('the entries after a reset', () => {
  it('shows each reset with its kind and by whom, and its entries in a table', async () => {
    open('academic_vice_principal', answer([BY_ADMIN, BY_EMAIL]));
    await screen.findByRole('heading', { name: en.people.resetEntries.title });
    await screen.findByRole('region', { name: 'Rahimova Nodira' });
    const admin = card('Rahimova Nodira');
    expect(admin.textContent).toContain(en.people.resetEntries.kinds.administrator);
    expect(admin.textContent).toContain('Saidova Dilnoza');
    const row = admin.querySelector('tbody tr');
    expect(row?.textContent).toContain('Ismoilova Gulnoza');
    expect(row?.textContent).toContain('Mathematics');
    expect(row?.textContent).toContain(`1 (${en.journal.marks.present})`);
    expect(row?.textContent).toContain(`0 (${en.journal.marks.absent})`);
    expect(admin.querySelector('[data-email-changed]')).toBeNull();
    // Task 8.1: the total set in the 48 hours, in its own table.
    expect(admin.querySelector('[data-work-entries] tbody tr')?.textContent).toContain(
      `${en.journal.works.historyTotal.replace('{{work}}', en.journal.grid.parts.classwork)}: — → 30`,
    );
    // The email reset after an edit of the email by somebody else is marked, with no entries.
    const email = card('Qodirov Kamol');
    expect(email.textContent).toContain(en.people.resetEntries.kinds.email);
    expect(email.querySelector('[data-email-changed]')?.textContent).toContain('Saidova Dilnoza');
    expect(within(email).getByText(en.people.resetEntries.noEntries)).toBeDefined();
    expect(email.querySelector('table')).toBeNull();
  });

  it('sends the dates of the address', async () => {
    const calls = open(
      'principal',
      answer([]),
      'en',
      '/people/reset-entries?from=2026-10-01&to=2026-10-05',
    );
    await screen.findByText(en.people.resetEntries.empty);
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === ROUTE && call.query === '?from=2026-10-01&to=2026-10-05',
        ),
      ).toBe(true);
    });
  });

  it('says in one line that no password was reset', async () => {
    open('super_admin', answer([]));
    expect(await screen.findByText(en.people.resetEntries.empty)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(en.people.resetEntries.from).value).toBe(
      '2026-09-13',
    );
  });

  it('shows a failed report with a retry', async () => {
    open('super_admin', 'fail');
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
  });

  it('is in Russian', async () => {
    open('principal', answer([BY_ADMIN]), 'ru');
    expect(
      await screen.findByRole('heading', { name: ru.people.resetEntries.title }),
    ).toBeDefined();
    expect((await screen.findByRole('region', { name: 'Rahimova Nodira' })).textContent).toContain(
      ru.people.resetEntries.kinds.administrator,
    );
  });

  it('is in Uzbek', async () => {
    open('principal', answer([BY_ADMIN]), 'uz');
    expect(
      await screen.findByRole('heading', { name: uz.people.resetEntries.title }),
    ).toBeDefined();
  });
});
