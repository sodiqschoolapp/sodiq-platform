import type { ForcedDelete } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.8b, pull request #195: the lessons the Super
// Admin deleted for good, and their restore within 30 days (06, Protection:
// "The attendance and marks are kept for 30 days and can be restored.").
const record = (n: number, fields: Partial<ForcedDelete> = {}): ForcedDelete => ({
  id: uid(900 + n),
  recordType: 'lesson',
  lesson: {
    id: uid(300 + n),
    date: '2026-10-12',
    startsAt: '2026-10-12T03:00:00.000Z',
    endsAt: '2026-10-12T03:45:00.000Z',
    start: 480,
    end: 525,
    unit: { kind: 'class', id: uid(101), name: `7 Oxford ${String(n)}` },
    subject: { id: uid(200), names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } },
    teacher: { id: uid(600), name: 'Karimova Aziza' },
    room: { id: uid(400), name: 'Room 12' },
    cancelCause: null,
  },
  reason: 'Entered for the wrong class',
  deletedBy: { id: uid(700), name: 'Yusupova Nodira' },
  deletedAt: '2026-10-10T18:55:00.000Z',
  restoreUntil: '2026-11-09T18:55:00.000Z',
  restoredAt: null,
  restoredBy: null,
  restorable: true,
  ...fields,
});

const session = (language: 'en' | 'ru' = 'en') =>
  sessionOf({
    assignments: [{ role: 'super_admin', branchId: null }],
    branches: [NORTH],
    language,
  });

const cellsOf = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

/** Opens the record of the row named in the side panel. */
async function openRow(name: string) {
  await waitFor(() => {
    expect(cellsOf().some((row) => row.some((cell) => cell.includes(name)))).toBe(true);
  });
  const row = [...document.querySelectorAll('tbody tr')].find((one) =>
    one.textContent.includes(name),
  );
  const button = row?.querySelector('button');
  if (!(button instanceof HTMLElement)) throw new Error(`No row ${name}`);
  fireEvent.click(button);
  return screen.findByRole('complementary', { name: `${name}, Mathematics` });
}

describe('the deleted lessons', () => {
  it('lists the store of the branch with the state of each record', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/forced-deletes': () =>
        json({
          entries: [
            record(1),
            record(2, { restorable: false }),
            record(3, {
              restorable: false,
              restoredAt: '2026-10-11T10:00:00.000Z',
              restoredBy: { id: uid(700), name: 'Yusupova Nodira' },
            }),
          ],
        }),
    });
    renderApp('/forced-deletes', 'en');
    await screen.findByRole('heading', { name: en.forcedDeletes.title });
    await waitFor(() => {
      expect(cellsOf().filter((row) => row.join('') !== '')).toHaveLength(3);
    });
    const states = cellsOf().map((row) => row[row.length - 1]);
    expect(states).toEqual(
      expect.arrayContaining([
        en.forcedDeletes.state_restorable,
        en.forcedDeletes.state_expired,
        en.forcedDeletes.state_restored,
      ]),
    );
  });

  it('names an account without a name "No name" where it deleted and restored, never a blank', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/forced-deletes': () =>
        json({
          entries: [
            record(1, {
              deletedBy: { id: uid(700), name: '' },
              restorable: false,
              restoredAt: '2026-10-11T10:00:00.000Z',
              restoredBy: { id: uid(700), name: '' },
            }),
          ],
        }),
    });
    renderApp('/forced-deletes', 'en');
    const panel = await openRow('7 Oxford 1');
    const [row] = cellsOf();
    expect(row?.some((cell) => cell.startsWith(en.audit.unnamed))).toBe(true);
    const restored = [...panel.querySelectorAll('dt')].find(
      (one) => one.textContent === en.forcedDeletes.restored,
    );
    expect(restored?.nextElementSibling?.textContent).toContain(en.audit.unnamed);
  });

  it('restores a record while it can, and shows a refusal with its rules', async () => {
    let refuse = false;
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/forced-deletes': () =>
        json({ entries: [record(1), record(2, { restorable: false })] }),
      [`POST /api/forced-deletes/${uid(901)}/restore`]: () =>
        refuse
          ? json(
              {
                error: {
                  code: 'forced_delete_restore_blocked',
                  message: 'Refused.',
                  requestId: 'r1',
                  details: [{ path: 'lessons', code: 'teacher_busy', message: 'Busy.' }],
                },
              },
              409,
            )
          : json(
              record(1, {
                restorable: false,
                restoredAt: '2026-10-10T19:00:00.000Z',
                restoredBy: { id: uid(700), name: 'Yusupova Nodira' },
              }),
            ),
    });
    refuse = true;
    renderApp('/forced-deletes', 'en');
    const panel = await openRow('7 Oxford 1');
    fireEvent.click(await within(panel).findByRole('button', { name: en.forcedDeletes.restore }));
    expect(await within(panel).findByText(en.errors.forced_delete_restore_blocked)).not.toBeNull();
    refuse = false;
    fireEvent.click(within(panel).getByRole('button', { name: en.forcedDeletes.restore }));
    expect(await within(panel).findByText(en.forcedDeletes.restoredMessage)).not.toBeNull();
    const sent = calls.filter((call) => call.route.endsWith('/restore'));
    expect(sent).toHaveLength(2);
  });

  it('offers no restore on a record past its 30 days', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/forced-deletes': () => json({ entries: [record(2, { restorable: false })] }),
    });
    renderApp('/forced-deletes', 'en');
    const panel = await openRow('7 Oxford 2');
    await within(panel).findByText('Entered for the wrong class');
    expect(within(panel).queryByRole('button', { name: en.forcedDeletes.restore })).toBeNull();
  });

  it('says so when nothing was deleted, in Russian', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session('ru')),
      'GET /api/forced-deletes': () => json({ entries: [] }),
    });
    renderApp('/forced-deletes', 'ru');
    await screen.findByRole('heading', { name: ru.forcedDeletes.title });
    expect(await screen.findByText(ru.forcedDeletes.emptyTitle)).not.toBeNull();
  });

  it('is not open to the Principal', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role: 'principal', branchId: NORTH.id }],
            branches: [NORTH],
          }),
        ),
    });
    renderApp('/forced-deletes', 'en');
    expect(await screen.findByRole('heading', { name: en.problems.noAccessTitle })).not.toBeNull();
  });
});
