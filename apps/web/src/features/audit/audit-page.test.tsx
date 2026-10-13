import { type AuditEntryAnswer, type AuditPage, type Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const uid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/audit';

// All names and values are invented. Task 2.6a, pull request #75: the Audit
// log page (edge/people-roles-accounts, Personal data and the audit log).
const EDIT: AuditEntryAnswer = {
  id: uid(1),
  occurredAt: '2026-10-10T06:30:00.000Z',
  branchId: NORTH.id,
  action: 'student.edit',
  actor: { id: uid(21), name: 'Saidova Dilnoza' },
  assignment: { id: uid(31), role: 'academic_vice_principal' },
  person: null,
  record: { type: 'student', id: uid(41), name: 'Qodirova Madina' },
  oldValue: { firstName: 'Madina', address: null },
  newValue: { firstName: 'Madinabonu', address: null },
  details: null,
  reason: null,
  hidden: ['oldValue.address', 'newValue.address'],
};

const SHOWN: AuditEntryAnswer = {
  ...EDIT,
  oldValue: { firstName: 'Madina', address: 'Yunusobod 7' },
  newValue: { firstName: 'Madinabonu', address: 'Chilonzor 3' },
  hidden: [],
};

const EXPORT: AuditEntryAnswer = {
  id: uid(2),
  occurredAt: '2026-10-09T05:00:00.000Z',
  branchId: null,
  action: 'staff.export',
  actor: null,
  assignment: null,
  person: null,
  record: null,
  oldValue: null,
  newValue: null,
  details: { list: 'staff', rows: 12, search: null },
  reason: null,
  hidden: ['details.search'],
};

const OLDER: AuditEntryAnswer = {
  ...EXPORT,
  id: uid(3),
  occurredAt: '2026-10-01T05:00:00.000Z',
  action: 'auth.sign_in',
  actor: { id: uid(22), name: 'Karimova Aziza' },
  hidden: [],
  details: null,
};

const page = (entries: AuditEntryAnswer[], next: string | null = null): AuditPage => ({
  entries,
  next,
  from: '2026-09-11',
  to: '2026-10-10',
});

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

function openLog(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  let asked = 0;
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/audit/entries': () =>
      (asked += 1) === 1
        ? json(page([EDIT, EXPORT], `2026-10-09T05:00:00.000Z_${uid(2)}`))
        : json(page([OLDER])),
    ...extra,
  });
}

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const asks = (calls: { route: string; query?: string }[]) =>
  calls.filter((call) => call.route === 'GET /api/audit/entries').map((call) => call.query);

describe('the audit log page', () => {
  it('lists the entries of the branch with their names, and loads the next page', async () => {
    const calls = openLog('principal');
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.audit.title, level: 1 });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const [edit, exported] = rowsDrawn();
    expect(edit?.slice(1)).toEqual([
      en.audit.actions.student.edit,
      'Saidova Dilnoza',
      '',
      `${en.audit.recordTypes.student}: Qodirova Madina`,
    ]);
    expect(exported?.slice(1, 3)).toEqual([en.audit.actions.staff.export, en.audit.system]);
    // The Principal reads one log: no scope and no branch column.
    expect(screen.queryByLabelText(en.audit.scope)).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(en.audit.from).value).toBe('2026-09-11');
    expect(screen.getByLabelText<HTMLInputElement>(en.audit.to).value).toBe('2026-10-10');

    fireEvent.click(screen.getByRole('button', { name: en.list.loadMore }));
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    expect(screen.queryByRole('button', { name: en.list.loadMore })).toBeNull();
    expect(asks(calls)).toEqual([undefined, `?before=2026-10-09T05%3A00%3A00.000Z_${uid(2)}`]);
  });

  it('sends the dates and the kind to the server through the address', async () => {
    const calls = openLog('academic_vice_principal');
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.change(screen.getByLabelText(en.audit.group), { target: { value: 'exports' } });
    await waitFor(() => {
      expect(asks(calls).at(-1)).toBe('?group=exports');
    });
    fireEvent.change(screen.getByLabelText(en.audit.from), { target: { value: '2026-10-01' } });
    await waitFor(() => {
      expect(asks(calls).at(-1)).toBe('?from=2026-10-01&group=exports');
    });
  });

  it('gives the Super Admin the choice of log and the branch of each entry', async () => {
    const calls = openLog('super_admin');
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()[0]?.at(-1)).toBe(NORTH.name);
    expect(rowsDrawn()[1]?.at(-1)).toBe(en.audit.schoolWide);
    fireEvent.change(screen.getByLabelText(en.audit.scope), { target: { value: 'all' } });
    await waitFor(() => {
      expect(asks(calls).at(-1)).toBe('?scope=all');
    });
  });

  it('searches by a person of the branch', async () => {
    const calls = openLog('academic_vice_principal', {
      'GET /api/people/relatives': () =>
        json({
          relatives: [
            {
              id: uid(51),
              fullName: 'Dilfuza Rahimova',
              phone: null,
              students: [],
              elsewhere: 0,
              phoneInvalidSince: null,
            },
          ],
          searchesPhone: true,
          canEdit: true,
        }),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.change(screen.getByLabelText(en.audit.personKind), { target: { value: 'relative' } });
    const person = await screen.findByLabelText<HTMLSelectElement>(en.audit.person);
    await within(person).findByRole('option', { name: 'Dilfuza Rahimova' });
    fireEvent.change(person, { target: { value: uid(51) } });
    await waitFor(() => {
      expect(asks(calls).at(-1)).toBe(`?person=relative%3A${uid(51)}`);
    });
  });

  it('opens an entry with the labels of the form, hides what the reader may not see, and shows it on asking', async () => {
    const calls = openLog('principal', {
      [`POST /api/audit/entries/${uid(1)}/show`]: () => json(SHOWN),
    });
    renderApp(`${PATH}?open=${uid(1)}`);
    const panel = await screen.findByRole('complementary');
    const rows = await within(panel).findAllByRole('row');
    const cells = (row: HTMLElement | undefined) =>
      [...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent);
    expect(cells(rows[1])).toEqual([en.people.students.firstName, 'Madina', 'Madinabonu']);
    expect(cells(rows[2])).toEqual([en.people.students.address, en.audit.hidden, en.audit.hidden]);
    expect(within(panel).getByText(en.roles.academic_vice_principal)).toBeDefined();

    fireEvent.click(within(panel).getByRole('button', { name: en.audit.show }));
    await waitFor(() => {
      expect(cells(within(panel).getAllByRole('row')[2])).toEqual([
        en.people.students.address,
        'Yunusobod 7',
        'Chilonzor 3',
      ]);
    });
    expect(calls.some((call) => call.route === `POST /api/audit/entries/${uid(1)}/show`)).toBe(
      true,
    );
    expect(within(panel).queryByRole('button', { name: en.audit.show })).toBeNull();
  });

  it('speaks the language of the account, labels included', async () => {
    openLog('principal', {}, 'ru');
    renderApp(`${PATH}?open=${uid(1)}`);
    await screen.findByRole('heading', { name: ru.audit.title, level: 1 });
    const panel = await screen.findByRole('complementary');
    const rows = await within(panel).findAllByRole('row');
    expect(rows[1]?.querySelector('td')?.textContent).toBe(ru.people.students.firstName);
    expect(rowsDrawn()[0]?.[1]).toBe(ru.audit.actions.student.edit);
  });

  it('keeps the search of a History link and lets it be cleared', async () => {
    const calls = openLog('principal');
    renderApp(`${PATH}?recordType=student&recordId=${uid(41)}`);
    await waitFor(() => {
      expect(asks(calls)[0]).toBe(`?recordType=student&recordId=${uid(41)}`);
    });
    expect(
      screen.getByText(en.audit.onlyRecordOf.replace('{{name}}', en.audit.recordTypes.student)),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: en.audit.clear }));
    await waitFor(() => {
      expect(asks(calls).at(-1)).toBeUndefined();
    });
  });
});
