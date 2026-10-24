import type { JournalUnlock } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented.
const REQUEST: JournalUnlock = {
  id: uid(1),
  target: 'lesson',
  lessonId: uid(2),
  journalId: uid(3),
  quarterId: null,
  date: '2026-10-19',
  unit: { kind: 'class', id: uid(4), name: '7 Kent' },
  subject: {
    id: uid(5),
    names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
    colour: 'blue',
  },
  person: 'Karimov Nodir',
  reason: 'I was ill that week',
  requestedAt: '2026-10-27T07:00:00.000Z',
  status: 'sent',
  days: null,
  openUntil: null,
  open: false,
  decidedBy: null,
  decidedAt: null,
  refuseReason: null,
  version: 1,
  canDecide: true,
  canWithdraw: false,
};

function open(
  role: 'head_teacher' | 'teacher' | 'academic_vice_principal',
  request: JournalUnlock,
) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          assignments: [{ role, branchId: NORTH.id }],
        }),
      ),
    'GET /api/journal/unlocks': () => json({ requests: [request] }),
    [`POST /api/journal/unlocks/${request.id}/decide`]: () =>
      json({ ...request, status: 'approved', canDecide: false }),
    [`POST /api/journal/unlocks/${request.id}/withdraw`]: () =>
      json({ ...request, status: 'withdrawn', canWithdraw: false }),
    'GET /api/journal/extensions': () => json({ extensions: [] }),
    'POST /api/journal/extensions': (body) =>
      json(
        {
          ...(body as object),
          id: uid(9),
          openUntil: '2026-10-28T19:00:00.000Z',
          createdBy: 'Ismoilova Shahlo',
          createdAt: '2026-10-27T07:00:00.000Z',
        },
        201,
      ),
  });
  renderApp('/journal/unlocks', 'en');
  return calls;
}

const posts = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route);

// docs/spec/07-journal.md, Editing rules and locks; docs/spec/edge-cases/journal.md: "approves
// and sets 1 to 7 days" (task 8.4).
describe('the Unlock requests page', () => {
  it('approves a waiting request with the days chosen', async () => {
    const calls = open('head_teacher', REQUEST);
    expect(await screen.findByRole('heading', { name: en.journal.unlocks.title })).toBeDefined();
    const row = await waitFor(() => {
      const found = [...document.querySelectorAll('tbody tr')].find((one) =>
        one.textContent?.includes('7 Kent'),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(within(row).getAllByRole('button')[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: en.journal.unlocks.decide }));
    const dialog = await screen.findByRole('form', { name: en.journal.locks.decideTitle });
    fireEvent.change(within(dialog).getByRole('combobox', { name: en.journal.locks.days }), {
      target: { value: '3' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.locks.approve }));
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/unlocks/${REQUEST.id}/decide`)).toHaveLength(1);
    });
    expect(posts(calls, `POST /api/journal/unlocks/${REQUEST.id}/decide`)[0]?.body).toEqual({
      decision: 'approve',
      days: 3,
      version: 1,
    });
  });

  it('refuses with no reason', async () => {
    const calls = open('head_teacher', REQUEST);
    const row = await waitFor(() => {
      const found = [...document.querySelectorAll('tbody tr')].find((one) =>
        one.textContent?.includes('7 Kent'),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(within(row).getAllByRole('button')[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: en.journal.unlocks.decide }));
    const dialog = await screen.findByRole('form', { name: en.journal.locks.decideTitle });
    fireEvent.change(within(dialog).getByRole('combobox', { name: en.journal.locks.decision }), {
      target: { value: 'refuse' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.locks.refuse }));
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/unlocks/${REQUEST.id}/decide`)[0]?.body).toEqual({
        decision: 'refuse',
        reason: null,
        version: 1,
      });
    });
  });

  it('withdraws the reader’s own waiting request', async () => {
    const calls = open('teacher', { ...REQUEST, canDecide: false, canWithdraw: true });
    const row = await waitFor(() => {
      const found = [...document.querySelectorAll('tbody tr')].find((one) =>
        one.textContent?.includes('7 Kent'),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(within(row).getAllByRole('button')[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: en.journal.unlocks.withdraw }));
    await waitFor(() => {
      expect(posts(calls, `POST /api/journal/unlocks/${REQUEST.id}/withdraw`)[0]?.body).toEqual({
        version: 1,
      });
    });
  });

  it('checks a new extension with the shared schema: a last day before the first is said and nothing is sent (code review 2, finding 2)', async () => {
    const calls = open('academic_vice_principal', REQUEST);
    const form = await screen.findByRole('form', { name: en.journal.unlocks.extensionsTitle });
    fireEvent.change(within(form).getByLabelText(en.journal.unlocks.fromDate), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(within(form).getByLabelText(en.journal.unlocks.toDate), {
      target: { value: '2026-10-19' },
    });
    fireEvent.change(within(form).getByLabelText(en.journal.unlocks.reason), {
      target: { value: 'The server was down' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.journal.unlocks.toBeforeFrom)).toBeDefined();
    expect(posts(calls, 'POST /api/journal/extensions')).toHaveLength(0);
    fireEvent.change(within(form).getByLabelText(en.journal.unlocks.toDate), {
      target: { value: '2026-10-21' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(posts(calls, 'POST /api/journal/extensions')).toHaveLength(1);
    });
    expect(posts(calls, 'POST /api/journal/extensions')[0]?.body).toEqual({
      fromDate: '2026-10-20',
      toDate: '2026-10-21',
      days: 1,
      reason: 'The server was down',
    });
    expect(await screen.findByText(en.journal.unlocks.extended)).toBeDefined();
  });
});
