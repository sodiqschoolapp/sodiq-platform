import type { Role, StaffImportPreview } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e100-0000-7000-8000-${String(n).padStart(12, '0')}`;

const IMPORT = uid(1);
const HOLDER = uid(2);

// All names and passwords are invented. Task 9.4h, pull request #279: the
// preview of every row with its problems, the warning to confirm, and the
// slips of the accounts made, four to a page, held only by the page.
const NOT_CLEAN: StaffImportPreview = {
  importId: IMPORT,
  alreadyImportedOn: null,
  clean: false,
  rows: [
    {
      rowNumber: 4,
      lastName: 'Aliyev',
      firstName: 'Sardor',
      role: null,
      problems: [{ column: 'role', code: 'import_role_not_allowed' }],
      warning: null,
      samePerson: null,
      login: null,
    },
    {
      rowNumber: 5,
      lastName: 'Karimova',
      firstName: 'Dilnoza',
      role: 'teacher',
      problems: [
        {
          column: 'jshshir',
          code: 'already_exists',
          recordId: HOLDER,
          staffName: 'Nazarova Shoira',
          left: true,
        },
      ],
      warning: null,
      samePerson: null,
      login: null,
    },
    {
      rowNumber: 3,
      lastName: 'Rahimov',
      firstName: 'Botir',
      role: 'tutor',
      problems: [],
      warning: { records: [], elsewhere: false, rows: [6], confirmed: false },
      samePerson: { fullName: 'Rahimova Gulnora' },
      login: 'b.rahimov',
    },
  ],
};

const WARNED: StaffImportPreview = {
  ...NOT_CLEAN,
  rows: NOT_CLEAN.rows.filter((row) => row.rowNumber === 3),
};

const CLEAN: StaffImportPreview = {
  ...WARNED,
  clean: true,
  rows: WARNED.rows.map((row) =>
    row.warning === null ? row : { ...row, warning: { ...row.warning, confirmed: true } },
  ),
};

const SLIP = {
  firstName: 'Botir',
  lastName: 'Rahimov',
  login: 'b.rahimov',
  password: 'kQ7-invented-pw',
  validUntil: '2026-10-17T18:55:00.000Z',
};

let shell: ReturnType<typeof renderApp>;

function open(role: Role, handlers: Parameters<typeof fakeApi>[0] = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ assignments: [{ role, branchId: NORTH.id }] })),
    ...handlers,
  });
  shell = renderApp('/people/staff/import');
  return calls;
}

const cachesHold = (text: string): boolean =>
  JSON.stringify([
    shell.queryClient
      .getMutationCache()
      .getAll()
      .map((one) => one.state.data),
    shell.queryClient
      .getQueryCache()
      .getAll()
      .map((one) => one.state.data),
  ]).includes(text);

const rows = () => [...document.querySelectorAll('tbody tr')];

const choose = () => {
  fireEvent.change(screen.getByLabelText(en.people.import.upload), {
    target: {
      files: [
        new File(['PK'], 'staff.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ],
    },
  });
};

const rowOf = (name: string) => {
  const found = rows().find((row) => row.textContent.includes(name));
  if (found === undefined) throw new Error(`The row of ${name}.`);
  return found as HTMLElement;
};

describe('the staff import page', () => {
  it('lists the problems in words, waits for the warning, saves and shows the slips once', async () => {
    const calls = open('super_admin', {
      'PUT /api/people/staff/imports': () => json(NOT_CLEAN),
    });
    await screen.findByRole('heading', { name: en.people.staffImport.title });
    choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    // Each problem names its column with the template's heading.
    expect(rowOf('Aliyev').textContent).toContain('Role: ');
    expect(rowOf('Aliyev').textContent).toContain(
      en.people.staffImport.problems.import_role_not_allowed,
    );
    // A left holder: re-hired by hand on the record (review correction 1).
    expect(rowOf('Karimova').textContent).toContain(
      en.people.staffImport.holderLeft.replace('{{name}}', 'Nazarova Shoira'),
    );
    expect(rowOf('Rahimov').textContent).toContain('b.rahimov');
    expect(rowOf('Rahimov').textContent).toContain(
      en.people.staffImport.samePerson.replace('{{name}}', 'Rahimova Gulnora'),
    );
    const save = screen.getByRole('button', { name: /Save all 3 people/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((call) => call.route.includes('/confirm'))).toBe(false);
  });

  it('sends the confirmed warning, saves, prints four slips to a page and keeps them out of every cache', async () => {
    const calls = open('super_admin', {
      'PUT /api/people/staff/imports': () => json(WARNED),
      [`POST /api/people/staff/imports/${IMPORT}/preview`]: () => json(CLEAN),
      [`POST /api/people/staff/imports/${IMPORT}/confirm`]: () =>
        json({
          outcome: 'saved',
          created: 1,
          staff: [
            {
              id: uid(10),
              staffId: 'S-260007',
              lastName: 'Rahimov',
              firstName: 'Botir',
              login: 'b.rahimov',
            },
          ],
          slips: [SLIP],
          issuedOn: '2026-10-10',
        }),
    });
    await screen.findByRole('heading', { name: en.people.staffImport.title });
    choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    fireEvent.click(within(rowOf('Rahimov')).getByRole('checkbox'));
    const ready = await screen.findByRole('button', { name: /Save 1 person/ });
    await waitFor(() => {
      expect((ready as HTMLButtonElement).disabled).toBe(false);
    });
    expect(
      calls.find((call) => call.route === `POST /api/people/staff/imports/${IMPORT}/preview`)?.body,
    ).toEqual({ confirmedWarnings: [3] });
    fireEvent.click(ready);
    expect(await screen.findByText('1 staff record saved.')).toBeDefined();
    expect(
      calls.find((call) => call.route === `POST /api/people/staff/imports/${IMPORT}/confirm`)?.body,
    ).toEqual({ confirmedWarnings: [3] });
    // On the page, and in the sheet that prints four to an A4 page.
    expect(screen.getAllByText('kQ7-invented-pw').length).toBeGreaterThan(0);
    const sheet = document.querySelector('[data-slip-sheet][data-four]');
    expect(sheet?.querySelectorAll('[data-slip]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: en.people.staffImport.print })).toBeDefined();
    // The password is held by the page only: no query or mutation cache keeps it.
    await waitFor(() => {
      expect(cachesHold('kQ7-invented-pw')).toBe(false);
    });
  });

  it('is not for a role that does not create staff', async () => {
    open('academic_vice_principal');
    expect(await screen.findByText(en.problems.noAccessPart)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });
});
