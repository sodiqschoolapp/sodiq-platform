import type { PastMarkPreview, PastMarkUploadList, Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e200-0000-7000-8000-${String(n).padStart(12, '0')}`;

const IMPORT = uid(1);
const UPLOAD = uid(2);
const ADMIN = { accountId: uid(3), login: 'aziza.k', name: 'Karimova Aziza' };

// All names are invented. Task 11.26 (`10`, Past marks from before go-live: The upload and
// Withdrawal): the preview of every row with its problems in words, a page at a time, the confirm
// that saves all rows or none, the list of uploads and the withdrawal with a reason.
const preview = (
  rows: PastMarkPreview['rows'],
  extra: Partial<PastMarkPreview> = {},
): PastMarkPreview => ({
  importId: IMPORT,
  fileName: 'September.xlsx',
  alreadyImportedOn: null,
  counts: {
    rows: rows.length,
    withProblems: rows.filter((one) => one.problems.length > 0).length,
    clean: rows.filter((one) => one.problems.length === 0).length,
  },
  page: 1,
  pageCount: 1,
  rows,
  clean: rows.every((one) => one.problems.length === 0),
  ...extra,
});

const ROW_BAD = {
  rowNumber: 4,
  uid: '2600101',
  name: 'Oʻrinboyeva Oʻgiloy',
  date: '2026-09-07',
  subject: 'History',
  problems: [
    { column: 'classworkScore' as const, code: 'amount_comma' as const },
    { column: 'attendance' as const, code: 'attendance_repeated_in_file' as const, rows: [5] },
  ],
};
const ROW_GOOD = {
  rowNumber: 3,
  uid: '2600102',
  name: 'Karimova Nilufar',
  date: '2026-09-07',
  subject: 'History',
  problems: [],
};

const LIST: PastMarkUploadList = {
  uploads: [
    {
      id: UPLOAD,
      fileName: 'September.xlsx',
      rowCount: 120,
      confirmedBy: ADMIN,
      confirmedAt: '2026-10-10T09:00:00.000Z',
      withdrawn: null,
    },
  ],
};

function open(path: string, role: Role, handlers: Parameters<typeof fakeApi>[0] = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ assignments: [{ role, branchId: NORTH.id }] })),
    'GET /api/setup/past-marks/imports': () => json(LIST),
    ...handlers,
  });
  renderApp(path);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

const choose = () => {
  fireEvent.change(screen.getByLabelText(en.people.import.upload), {
    target: {
      files: [
        new File(['PK'], 'September.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ],
    },
  });
};

describe('the import of past marks', () => {
  it('lists every problem in words with its column, and keeps Save off', async () => {
    const calls = open('/setup/past-marks/import', 'academic_vice_principal', {
      'PUT /api/setup/past-marks/imports': () => json(preview([ROW_BAD, ROW_GOOD])),
    });
    await screen.findByRole('heading', { name: en.setup.pastMarks.importTitle });
    choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    const bad = rows().find((row) => row.textContent.includes('2600101'));
    expect([...(bad?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      `Classwork: score: ${en.setup.pastMarks.problems.amount_comma}`,
      `Attendance: ${en.setup.pastMarks.problems.attendance_repeated_in_file.replace('{{rows}}', '5')}`,
    ]);
    const save = screen.getByRole('button', { name: /Save all 2 rows/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(en.setup.pastMarks.notClean)).toBeDefined();
    expect(calls.some((call) => call.route.includes('/confirm'))).toBe(false);
    // The file's name travels with the upload.
    expect(
      calls.find((call) => call.route === 'PUT /api/setup/past-marks/imports')?.query,
    ).toContain('name=September.xlsx');
  });

  it('asks the next page of the preview from the server', async () => {
    const calls = open('/setup/past-marks/import', 'super_admin', {
      'PUT /api/setup/past-marks/imports': () => json(preview([ROW_BAD], { pageCount: 2 })),
      [`POST /api/setup/past-marks/imports/${IMPORT}/preview`]: () =>
        json(preview([ROW_GOOD], { page: 2, pageCount: 2 })),
    });
    await screen.findByRole('heading', { name: en.setup.pastMarks.importTitle });
    choose();
    fireEvent.click(await screen.findByRole('button', { name: en.setup.pastMarks.next }));
    await waitFor(() => {
      expect(rows()[0]?.textContent).toContain('2600102');
    });
    expect(
      calls.find((call) => call.route === `POST /api/setup/past-marks/imports/${IMPORT}/preview`)
        ?.body,
    ).toEqual({ page: 2 });
    expect(screen.getByText('Page 2 of 2')).toBeDefined();
  });

  it('confirms a clean preview and says how many rows were saved', async () => {
    open('/setup/past-marks/import', 'super_admin', {
      'PUT /api/setup/past-marks/imports': () => json(preview([ROW_GOOD])),
      [`POST /api/setup/past-marks/imports/${IMPORT}/confirm`]: () =>
        json({ outcome: 'saved', rows: 1, attendance: 1, works: 0 }),
    });
    await screen.findByRole('heading', { name: en.setup.pastMarks.importTitle });
    choose();
    fireEvent.click(await screen.findByRole('button', { name: /Save 1 row/ }));
    expect(await screen.findByText('1 row saved.')).toBeDefined();
    expect(screen.getByRole('link', { name: en.setup.pastMarks.toList })).toBeDefined();
  });

  it('is not for the Principal', async () => {
    open('/setup/past-marks/import', 'principal');
    expect(await screen.findByText(en.problems.noAccessTitle)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });
});

describe('the uploads of past marks', () => {
  it('lists the uploads and withdraws one with a reason', async () => {
    const calls = open(`/setup/past-marks?open=${UPLOAD}`, 'academic_vice_principal', {
      [`POST /api/setup/past-marks/imports/${UPLOAD}/withdraw`]: () =>
        json({
          uploads: [
            {
              ...LIST.uploads[0],
              withdrawn: { by: ADMIN, at: '2026-10-11T09:00:00.000Z', reason: 'Wrong class' },
            },
          ],
        }),
    });
    await screen.findByRole('heading', { name: en.setup.pastMarks.title });
    fireEvent.click(await screen.findByRole('button', { name: en.setup.pastMarks.withdraw }));
    const dialog = await screen.findByRole('dialog');
    // Empty: refused in the form, nothing sent.
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.pastMarks.withdraw }));
    expect(await within(dialog).findByText(en.setup.pastMarks.reasonNeeded)).toBeDefined();
    expect(calls.some((call) => call.route.includes('/withdraw'))).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(en.setup.pastMarks.reason), {
      target: { value: 'Wrong class' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.pastMarks.withdraw }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      calls.find((call) => call.route === `POST /api/setup/past-marks/imports/${UPLOAD}/withdraw`)
        ?.body,
    ).toEqual({ reason: 'Wrong class' });
    await waitFor(() => {
      expect(rows()[0]?.textContent).toContain(en.setup.pastMarks.withdrawn);
    });
  });

  it('shows the empty state and the Import link', async () => {
    open('/setup/past-marks', 'super_admin', {
      'GET /api/setup/past-marks/imports': () => json({ uploads: [] }),
    });
    expect(await screen.findByText(en.setup.pastMarks.emptyTitle)).toBeDefined();
    expect(screen.getByRole('link', { name: en.setup.pastMarks.import })).toBeDefined();
  });
});
