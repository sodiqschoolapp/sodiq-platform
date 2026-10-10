import type { Division, ErrorDetail } from '@sodiq/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import { divisionsKey, invalidateDivisions } from './setup-api';

const PATH = '/setup/divisions';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ARCHIVED_AT = '2026-10-09T04:00:00.000Z';

const names = (en: string, ru = `${en} (ru)`, uz = `${en} (uz)`) => ({ uz, ru, en });

const ACADEMIC: Division = {
  id: uid(1),
  names: { uz: 'Oʻquv boʻlimi', ru: 'Учебный отдел', en: 'Academic' },
  builtIn: true,
  archivedAt: null,
  departments: [
    { id: uid(11), names: names('STEAM', 'STEAM', 'STEAM'), archivedAt: null },
    { id: uid(12), names: names('Tutors', 'Тьюторы', 'Tyutorlar'), archivedAt: null },
  ],
};

const OPERATIONS: Division = {
  id: uid(2),
  names: { uz: 'Xoʻjalik boʻlimi', ru: 'Хозяйственный отдел', en: 'Operations' },
  builtIn: false,
  archivedAt: null,
  departments: [
    { id: uid(21), names: names('Catering'), archivedAt: null },
    { id: uid(22), names: names('Transport'), archivedAt: ARCHIVED_AT },
  ],
};

const EVENTS: Division = {
  id: uid(3),
  names: names('Events'),
  builtIn: false,
  archivedAt: ARCHIVED_AT,
  departments: [],
};

/** A refusal that names the field it is about, as `already_exists` does for a taken name. */
const refusalWith = (details: ErrorDetail[]): Response =>
  Response.json(
    {
      error: {
        code: 'already_exists',
        message: 'ENGLISH TEXT FOR THE DEVELOPER',
        requestId: 'test-request',
        details,
      },
    },
    { status: 409 },
  );

const superAdmin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const rowButton = (name: string) => screen.getByText(name, { selector: 'button' });

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

/** Types the three names of a record form. */
function typeNames(form: HTMLElement, typed: { uz: string; ru: string; en: string }): void {
  type(within(form).getByLabelText(en.setup.divisions.nameUz), typed.uz);
  type(within(form).getByLabelText(en.setup.divisions.nameRu), typed.ru);
  type(within(form).getByLabelText(en.setup.divisions.nameEn), typed.en);
}

async function openList(
  session = superAdmin(),
  divisions = [ACADEMIC, OPERATIONS, EVENTS],
  extra: Record<string, () => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  let list = divisions;
  // The account is in the language of the test, so the app does not switch language after the first answer.
  const account = { ...session, language };
  const calls = fakeApi({
    'GET /api/auth/session': () => json(account),
    'GET /api/setup/divisions': () => json({ divisions: list }),
    'POST /api/setup/divisions': (body) => {
      const created: Division = {
        id: uid(4),
        ...(body as { names: Division['names'] }),
        builtIn: false,
        archivedAt: null,
        departments: [],
      };
      list = [...list, created];
      return json(created, 201);
    },
    [`PUT /api/setup/divisions/${OPERATIONS.id}`]: (body) =>
      json({ ...OPERATIONS, ...(body as object) }),
    [`POST /api/setup/divisions/${ACADEMIC.id}/archive`]: () => refusal('built_in', 409),
    [`POST /api/setup/divisions/${OPERATIONS.id}/archive`]: () =>
      json({ ...OPERATIONS, archivedAt: ARCHIVED_AT }),
    [`POST /api/setup/divisions/${EVENTS.id}/restore`]: () => json({ ...EVENTS, archivedAt: null }),
    [`POST /api/setup/divisions/${OPERATIONS.id}/departments`]: (body) =>
      json({ id: uid(23), ...(body as { names: Division['names'] }), archivedAt: null }, 201),
    [`PUT /api/setup/departments/${uid(21)}`]: (body) =>
      json({ id: uid(21), ...(body as { names: Division['names'] }), archivedAt: null }),
    [`POST /api/setup/departments/${uid(21)}/archive`]: () =>
      json({ id: uid(21), names: names('Catering'), archivedAt: ARCHIVED_AT }),
    [`POST /api/setup/departments/${uid(22)}/restore`]: () =>
      json({ id: uid(22), names: names('Transport'), archivedAt: null }),
    ...extra,
  });
  const shell = renderApp(PATH, language);
  const texts = language === 'ru' ? (await import('@/i18n/locales/ru')).ru : en;
  await screen.findByRole('heading', { name: texts.setup.divisions.title });
  if (divisions.length > 0) {
    await screen.findByRole('table', { name: texts.setup.divisions.caption });
  }
  return { ...shell, calls };
}

/** The confirmation dialog answered with its action. */
async function goOn(action: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
}

// docs/spec/03-school-setup.md, Divisions: "One list for the whole school";
// "Academic is built in. It cannot be renamed or archived"; "Other divisions
// are data. The Super Admin adds, renames and archives them"; "Each division
// and department has a name in three languages." `12`, Lists: one list
// pattern. Departments archived with their division as decided by the owner
// (pull request #40, answer 4).
describe('the divisions page', () => {
  it('lists the divisions in the chosen language with their active departments and status', async () => {
    await openList();

    expect(rowsDrawn().map((row) => row.slice(1))).toEqual([
      ['Academic', '2', en.setup.divisions.active],
      ['Operations', '1', en.setup.divisions.active],
      ['Events', '0', en.setup.divisions.archived],
    ]);
  });

  it('names the divisions in Russian when Russian is chosen', async () => {
    await openList(superAdmin(), [ACADEMIC, OPERATIONS], {}, 'ru');

    expect(rowsDrawn().map((row) => row[1])).toEqual(['Учебный отдел', 'Хозяйственный отдел']);
  });

  // `03`: "Academic is built in. It cannot be renamed or archived."
  it('shows Academic without a rename form or an archive button, saying it is built in, with its departments editable', async () => {
    await openList();

    fireEvent.click(rowButton('Academic'));

    const panel = await screen.findByRole('complementary', { name: 'Academic' });
    expect(within(panel).queryByRole('form', { name: 'Academic' })).toBeNull();
    expect(within(panel).getByText('Oʻquv boʻlimi')).toBeDefined();
    expect(within(panel).getByText('Учебный отдел')).toBeDefined();
    expect(within(panel).getByText(en.setup.divisions.builtIn)).toBeDefined();
    expect(
      within(panel).queryByRole('button', { name: en.setup.divisions.archiveDivision }),
    ).toBeNull();
    expect(
      within(panel).getByRole('button', {
        name: en.setup.divisions.renameNamed.replace('{{name}}', 'STEAM'),
      }),
    ).toBeDefined();
    expect(
      within(panel).getByRole('form', { name: en.setup.divisions.newDepartment }),
    ).toBeDefined();
  });

  it('opens a division in the side panel with its three names and departments, and renames it', async () => {
    const { calls } = await openList();

    fireEvent.click(rowButton('Operations'));

    const panel = await screen.findByRole('complementary', { name: 'Operations' });
    const departments = within(panel).getAllByRole('row').slice(1);
    expect(departments.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Catering'),
      expect.stringContaining('Transport'),
    ]);
    expect(departments[1]?.textContent).toContain(en.setup.divisions.archived);
    const form = within(panel).getByRole('form', { name: 'Operations' });
    expect(within(form).getByLabelText(en.setup.divisions.nameRu)).toHaveProperty(
      'value',
      'Хозяйственный отдел',
    );
    type(within(form).getByLabelText(en.setup.divisions.nameEn), 'Operations and support');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await within(form).findByText(en.form.saved);
    expect(
      calls.find((call) => call.route === `PUT /api/setup/divisions/${OPERATIONS.id}`)?.body,
    ).toEqual({
      names: { ...OPERATIONS.names, en: 'Operations and support' },
    });
  });

  it('shows a taken name beside its field', async () => {
    await openList(superAdmin(), [ACADEMIC, OPERATIONS, EVENTS], {
      [`PUT /api/setup/divisions/${OPERATIONS.id}`]: () =>
        refusalWith([{ path: 'names.ru', code: 'already_exists', message: 'taken' }]),
    });
    fireEvent.click(rowButton('Operations'));
    const panel = await screen.findByRole('complementary', { name: 'Operations' });
    const form = within(panel).getByRole('form', { name: 'Operations' });

    type(within(form).getByLabelText(en.setup.divisions.nameRu), 'Учебный отдел');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect((await within(form).findByRole('alert')).textContent).toBe(en.errors.already_exists);
    const russian = within(form).getByLabelText(en.setup.divisions.nameRu);
    expect(russian.getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByText(en.setup.divisions.nameTaken)).toBeDefined();
    expect(
      within(form).getByLabelText(en.setup.divisions.nameEn).getAttribute('aria-invalid'),
    ).toBe('false');
  });

  it('adds a department to the open division and renames a department', async () => {
    const { calls } = await openList();
    fireEvent.click(rowButton('Operations'));
    const panel = await screen.findByRole('complementary', { name: 'Operations' });

    const added = within(panel).getByRole('form', { name: en.setup.divisions.newDepartment });
    typeNames(added, names('Cleaning'));
    fireEvent.click(within(added).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find(
          (call) => call.route === `POST /api/setup/divisions/${OPERATIONS.id}/departments`,
        )?.body,
      ).toEqual({ names: names('Cleaning') });
    });

    fireEvent.click(
      within(panel).getByRole('button', {
        name: en.setup.divisions.renameNamed.replace('{{name}}', 'Catering'),
      }),
    );
    const rename = within(panel).getByRole('form', { name: 'Catering' });
    type(within(rename).getByLabelText(en.setup.divisions.nameEn), 'Kitchen');
    fireEvent.click(within(rename).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/setup/departments/${uid(21)}`)?.body,
      ).toEqual({ names: { ...names('Catering'), en: 'Kitchen' } });
    });
  });

  it('archives and restores a department after asking, and archives the division after asking', async () => {
    const { calls } = await openList();
    fireEvent.click(rowButton('Operations'));
    const panel = await screen.findByRole('complementary', { name: 'Operations' });

    fireEvent.click(
      within(panel).getByRole('button', {
        name: en.setup.divisions.archiveNamed.replace('{{name}}', 'Catering'),
      }),
    );
    await goOn(en.setup.divisions.archive);
    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/setup/departments/${uid(21)}/archive`),
      ).toBe(true);
    });

    fireEvent.click(
      within(panel).getByRole('button', {
        name: en.setup.divisions.restoreNamed.replace('{{name}}', 'Transport'),
      }),
    );
    await goOn(en.setup.divisions.restore);
    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/setup/departments/${uid(22)}/restore`),
      ).toBe(true);
    });

    fireEvent.click(
      within(panel).getByRole('button', { name: en.setup.divisions.archiveDivision }),
    );
    await goOn(en.setup.divisions.archive);
    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/setup/divisions/${OPERATIONS.id}/archive`),
      ).toBe(true);
    });
  });

  it('shows an archived division without its rename form, with a way to restore it and no way to change its departments', async () => {
    await openList();

    fireEvent.click(rowButton('Events'));

    const panel = await screen.findByRole('complementary', { name: 'Events' });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(
      within(panel).getByRole('button', { name: en.setup.divisions.restoreDivision }),
    ).toBeDefined();
    expect(within(panel).getByText(en.setup.divisions.noDepartments)).toBeDefined();
  });

  it('adds a division from the header, lists it last, and refreshes the list', async () => {
    const { calls } = await openList();

    fireEvent.click(screen.getByRole('button', { name: en.setup.divisions.add }));
    const form = screen.getByRole('form', { name: en.setup.divisions.newTitle });
    typeNames(form, { uz: 'Sport', ru: 'Спорт', en: 'Sports' });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: en.setup.divisions.newTitle })).toBeNull();
    });
    expect(calls.find((call) => call.route === 'POST /api/setup/divisions')?.body).toEqual({
      names: { uz: 'Sport', ru: 'Спорт', en: 'Sports' },
    });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual([
        'Academic',
        'Operations',
        'Events',
        'Sports',
      ]);
    });
    expect(calls.filter((call) => call.route === 'GET /api/setup/divisions')).toHaveLength(2);
  });

  it('archives several divisions at once after asking, naming Academic as built in, and goes on with the rest', async () => {
    const { calls } = await openList();

    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', 'Academic')));
    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', 'Operations')));
    fireEvent.click(screen.getByRole('button', { name: en.setup.divisions.archive }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(en.setup.divisions.archiveTitle_other.replace('{{n}}', '2')),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.divisions.archive }));

    const expected = `${en.setup.divisions.archived_done_one.replace('{{n}}', '1')} ${en.setup.divisions.refusedNames.replace('{{names}}', 'Academic')}`;
    await waitFor(() => {
      const statuses = within(screen.getByRole('main')).getAllByRole('status');
      expect(statuses.map((status) => status.textContent)).toContain(expected);
    });
    expect(calls.filter((call) => call.route.endsWith('/archive'))).toHaveLength(2);
  });

  it('restores several divisions at once, naming the one whose name an active division has now', async () => {
    const old = (n: number, name: string): Division => ({
      id: uid(n),
      names: names(name),
      builtIn: false,
      archivedAt: ARCHIVED_AT,
      departments: [],
    });
    const archived = [old(5, 'Old A'), old(6, 'Old B')];
    const { calls } = await openList(superAdmin(), [ACADEMIC, ...archived], {
      [`POST /api/setup/divisions/${uid(5)}/restore`]: () =>
        json({ ...archived[0], archivedAt: null }),
      [`POST /api/setup/divisions/${uid(6)}/restore`]: () =>
        refusalWith([{ path: 'names.en', code: 'already_exists', message: 'taken' }]),
    });

    for (const name of ['Old A', 'Old B']) {
      fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', name)));
    }
    fireEvent.click(screen.getByRole('button', { name: en.setup.divisions.restore }));
    await goOn(en.setup.divisions.restore);

    const expected = `${en.setup.divisions.restored_one.replace('{{n}}', '1')} ${en.setup.divisions.takenNames.replace('{{names}}', 'Old B')}`;
    await waitFor(() => {
      const statuses = within(screen.getByRole('main')).getAllByRole('status');
      expect(statuses.map((status) => status.textContent)).toContain(expected);
    });
    expect(calls.filter((call) => call.route.endsWith('/restore'))).toHaveLength(2);
  });

  it('filters by status', async () => {
    await openList();

    fireEvent.change(screen.getByRole('combobox', { name: en.setup.divisions.status }), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['Events']);
    });
  });

  it('shows the Principal the list and the departments without any way to change them', async () => {
    await openList(principal());

    expect(screen.queryByRole('button', { name: en.setup.divisions.add })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(rowButton('Operations'));
    const panel = await screen.findByRole('complementary', { name: 'Operations' });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en.setup.divisions.archiveDivision }),
    ).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.divisions.rename })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.divisions.archive })).toBeNull();
    expect(within(panel).getAllByRole('row')).toHaveLength(3);
  });
});

// The list is the same in every branch: a change refreshes every branch's list.
describe('the division lists of every branch', () => {
  it('are marked stale together', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(divisionsKey(NORTH.id), { divisions: [] });
    queryClient.setQueryData(divisionsKey(SOUTH.id), { divisions: [] });
    queryClient.setQueryData(['setup', 'rooms', NORTH.id], { rooms: [] });

    await invalidateDivisions(queryClient);

    expect(queryClient.getQueryState(divisionsKey(NORTH.id))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(divisionsKey(SOUTH.id))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['setup', 'rooms', NORTH.id])?.isInvalidated).toBe(false);
  });
});
