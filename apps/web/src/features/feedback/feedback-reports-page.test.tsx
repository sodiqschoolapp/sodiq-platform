import type { FeedbackReportEntry } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// Pull request #361 (owner, 19 November 2026): the Super Admin's Feedback reports page and its
// handled mark. All names are invented.

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const report = (n: number, fields: Partial<FeedbackReportEntry> = {}): FeedbackReportEntry => ({
  id: uid(100 + n),
  sender: { id: uid(200 + n), name: `Yusupova Aziza ${String(n)}` },
  roles: ['teacher'],
  page: '/journal',
  text: `The grid jumps ${String(n)}.`,
  appVersion: 12,
  createdAt: `2026-11-1${String(n)}T05:00:00.000Z`,
  handledAt: null,
  handledBy: null,
  ...fields,
});

const ADMIN = { id: uid(900), name: 'Karimova Dilnoza' };

const session = (role: 'super_admin' | 'principal' = 'super_admin') =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH],
  });

const cellsOf = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent),
  );

/** Opens the row whose cells hold `text`, and answers its side panel. */
async function openRow(text: string) {
  await waitFor(() => {
    expect(cellsOf().some((row) => row.some((cell) => cell.includes(text)))).toBe(true);
  });
  const row = [...document.querySelectorAll('tbody tr')].find((one) =>
    one.textContent.includes(text),
  );
  const button = row?.querySelector('button');
  if (!(button instanceof HTMLElement)) throw new Error(`No row ${text}`);
  fireEvent.click(button);
  return screen.findByRole('complementary');
}

describe('the feedback reports', () => {
  it('lists every report with its sender, roles, page and state, and "No name" never a blank', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/feedback-reports': () =>
        json({
          entries: [
            report(2, { sender: { id: uid(300), name: '' }, roles: [] }),
            report(1, {
              roles: ['teacher', 'tutor'],
              handledAt: '2026-11-18T06:00:00.000Z',
              handledBy: ADMIN,
            }),
          ],
          handledTruncated: false,
        }),
    });
    renderApp('/feedback-reports', 'en');
    await screen.findByRole('heading', { name: en.feedbackReports.title });
    await waitFor(() => {
      expect(cellsOf()).toHaveLength(2);
    });
    const [first, second] = cellsOf();
    expect(first).toEqual(
      expect.arrayContaining([
        en.audit.unnamed,
        en.feedbackReports.noRole,
        '/journal',
        en.feedbackReports.state_new,
      ]),
    );
    expect(second).toEqual(
      expect.arrayContaining([
        'Yusupova Aziza 1',
        `${en.roles.teacher}, ${en.roles.tutor}`,
        en.feedbackReports.state_handled,
      ]),
    );
    expect(screen.queryByText(/newest 1000 handled/)).toBeNull();
  });

  it('filters by state from the address', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/feedback-reports': () =>
        json({
          entries: [
            report(2),
            report(1, { handledAt: '2026-11-18T06:00:00.000Z', handledBy: ADMIN }),
          ],
          handledTruncated: true,
        }),
    });
    renderApp(`/feedback-reports?f=${encodeURIComponent(JSON.stringify({ state: 'new' }))}`, 'en');
    await waitFor(() => {
      expect(cellsOf()).toHaveLength(1);
    });
    expect(cellsOf()[0]).toContain('The grid jumps 2.');
    // Beyond the newest handled ones, the page says so.
    expect(
      screen.getByText(en.feedbackReports.handledTruncated_other.replace('{{count}}', '1000')),
    ).toBeDefined();
  });

  it('marks a report handled from its panel, then new again, and shows who handled it', async () => {
    let stored = report(1);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/feedback-reports': () => json({ entries: [stored], handledTruncated: false }),
      [`POST /api/feedback-reports/${uid(101)}/handled`]: () => {
        stored = { ...stored, handledAt: '2026-11-19T05:00:00.000Z', handledBy: ADMIN };
        return json(stored);
      },
      [`DELETE /api/feedback-reports/${uid(101)}/handled`]: () => {
        stored = { ...stored, handledAt: null, handledBy: null };
        return json(stored);
      },
    });
    renderApp('/feedback-reports', 'en');
    const panel = await openRow('The grid jumps 1.');
    expect(within(panel).getByText('The grid jumps 1.')).toBeDefined();

    fireEvent.click(await screen.findByRole('button', { name: en.feedbackReports.markHandled }));
    await screen.findByRole('button', { name: en.feedbackReports.markNew });
    expect(calls.map((call) => call.route)).toContain(
      `POST /api/feedback-reports/${uid(101)}/handled`,
    );
    const state = [...document.querySelectorAll('aside dt')].find(
      (one) => one.textContent === en.feedbackReports.state,
    );
    await waitFor(() => {
      expect(state?.nextElementSibling?.textContent).toContain('Karimova Dilnoza');
    });

    fireEvent.click(screen.getByRole('button', { name: en.feedbackReports.markNew }));
    await screen.findByRole('button', { name: en.feedbackReports.markHandled });
    expect(calls.map((call) => call.route)).toContain(
      `DELETE /api/feedback-reports/${uid(101)}/handled`,
    );
  });

  it('shows a refused mark beside the action, in words for the person', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/feedback-reports': () => json({ entries: [report(1)], handledTruncated: false }),
      [`POST /api/feedback-reports/${uid(101)}/handled`]: () =>
        json({ error: { code: 'not_found', message: 'Not found.', requestId: 'r1' } }, 404),
    });
    renderApp('/feedback-reports', 'en');
    await openRow('The grid jumps 1.');
    fireEvent.click(await screen.findByRole('button', { name: en.feedbackReports.markHandled }));
    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.not_found);
  });

  it('is no page for a role without the area', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(session('principal')) });
    renderApp('/feedback-reports', 'en');
    await screen.findByRole('heading', { name: en.problems.noAccessTitle });
    expect(screen.queryByRole('heading', { name: en.feedbackReports.title })).toBeNull();
  });
});
