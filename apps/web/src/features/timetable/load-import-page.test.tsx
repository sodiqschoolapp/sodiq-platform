import type { LoadImportPreview, Role, TimetableVersion } from '@sodiq/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e300-0000-7000-8000-${String(n).padStart(12, '0')}`;

const IMPORT = uid(1);

const VERSION: TimetableVersion = {
  id: uid(500),
  academicYearId: uid(400),
  yearName: '2026–2027',
  yearStatus: 'current',
  number: 2,
  status: 'draft',
  startsOn: '2026-10-19',
  fromVersion: null,
  rows: 0,
  leftRows: 0,
  leftBlocks: 0,
  outOfDate: false,
  editLock: null,
};

// All names are invented. Task 5.13 (`06`, Importing the load and the timetable): the preview of
// every row with its problems in words, the warnings listed, and the confirm that adds every row
// or none.
const NOT_CLEAN: LoadImportPreview = {
  importId: IMPORT,
  versionId: VERSION.id,
  alreadyImportedOn: null,
  rowsInDraft: 2,
  clean: false,
  rows: [
    {
      rowNumber: 4,
      cells: { unit: '7O-PE-1', subject: 'Movement', teacher: 'Rahimov Aziz (S-000201)' },
      problems: [{ column: 'unit', code: 'load_import_block_part', groups: ['7O-PE-2'] }],
      warnings: [],
    },
    {
      rowNumber: 5,
      cells: { unit: '7 Oxford', subject: 'Algebra', teacher: 'Nobody (S-999999)' },
      problems: [
        { column: 'teacher', code: 'load_import_unknown' },
        { column: 'teacher', code: 'load_teacher_language' },
      ],
      warnings: [],
    },
    {
      rowNumber: 3,
      cells: { unit: '7-E-1', subject: 'English', teacher: 'Usmonova Lola (S-000301)' },
      problems: [],
      warnings: [{ code: 'load_group_gaps', count: 2 }],
    },
  ],
};

const CLEAN: LoadImportPreview = {
  ...NOT_CLEAN,
  clean: true,
  rows: NOT_CLEAN.rows.filter((row) => row.rowNumber === 3),
};

function open(
  role: Role,
  handlers: Parameters<typeof fakeApi>[0] = {},
  version: TimetableVersion = VERSION,
) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ assignments: [{ role, branchId: NORTH.id }] })),
    'GET /api/timetable/versions': () => json({ versions: [version], today: '2026-10-10' }),
    ...handlers,
  });
  renderApp(`/timetable/load/import?version=${version.id}`);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

const choose = async () => {
  fireEvent.change(await screen.findByLabelText(en.people.import.upload), {
    target: {
      files: [
        new File(['PK'], 'load.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ],
    },
  });
};

const rowOf = (text: string) => {
  const found = rows().find((row) => row.textContent.includes(text));
  if (found === undefined) throw new Error(`The row of ${text}.`);
  return found as HTMLElement;
};

describe('the load import page', () => {
  it('lists the problems in words, each with its column, the warnings, and keeps Add off', async () => {
    const calls = open('academic_vice_principal', {
      [`PUT /api/timetable/versions/${VERSION.id}/load/imports`]: () => json(NOT_CLEAN),
    });
    await screen.findByRole('heading', { name: en.timetable.loadImport.title });
    await choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    const items = (text: string) =>
      [...rowOf(text).querySelectorAll('li')].map((item) => item.textContent);
    expect(items('7O-PE-1')).toEqual([
      `Class or group: ${en.timetable.loadImport.problems.load_import_block_part.replace('{{groups}}', '7O-PE-2')}`,
    ]);
    expect(items('Nobody')).toEqual([
      `Teacher or vacancy: ${en.timetable.loadImport.problems.load_import_unknown}`,
      `Teacher or vacancy: ${en.errors.load_teacher_language}`,
    ]);
    expect(rowOf('7-E-1').textContent).toContain(en.people.import.rowClean);
    expect(rowOf('7-E-1').textContent).toContain(
      en.timetable.loadImport.unplaced_other.replace('{{count}}', '2'),
    );
    expect(screen.getByText(/The draft holds 2 rows; they stay\./)).toBeDefined();
    const add = screen.getByRole('button', { name: /Add all 3 rows/ });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(en.timetable.loadImport.notClean)).toBeDefined();
    expect(calls.some((call) => call.route.includes('/confirm'))).toBe(false);
  });

  it('confirms a clean preview and says how many rows were added', async () => {
    const calls = open('super_admin', {
      [`PUT /api/timetable/versions/${VERSION.id}/load/imports`]: () => json(CLEAN),
      [`POST /api/timetable/versions/${VERSION.id}/load/imports/${IMPORT}/confirm`]: () =>
        json({ outcome: 'saved', created: 1, rowIds: [uid(10)] }),
    });
    await screen.findByRole('heading', { name: en.timetable.loadImport.title });
    await choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    const add = screen.getByRole('button', { name: /Add 1 row/ });
    expect((add as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(add);
    expect(await screen.findByText('1 row added to the load.')).toBeDefined();
    expect(
      calls.find(
        (call) =>
          call.route ===
          `POST /api/timetable/versions/${VERSION.id}/load/imports/${IMPORT}/confirm`,
      )?.body,
    ).toEqual({});
    expect(screen.getByRole('link', { name: en.timetable.loadImport.toLoad })).toBeDefined();
  });

  it('shows the preview again when the confirm finds a row no longer clean', async () => {
    open('super_admin', {
      [`PUT /api/timetable/versions/${VERSION.id}/load/imports`]: () => json(CLEAN),
      [`POST /api/timetable/versions/${VERSION.id}/load/imports/${IMPORT}/confirm`]: () =>
        json({ outcome: 'not_clean', preview: NOT_CLEAN }),
    });
    await screen.findByRole('heading', { name: en.timetable.loadImport.title });
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: /Add 1 row/ }));
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(rowOf('Nobody').textContent).toContain(en.errors.load_teacher_language);
  });

  it('says a published version takes no import', async () => {
    open('super_admin', {}, { ...VERSION, status: 'published' });
    expect(await screen.findByText(en.timetable.loadImport.noDraft)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });

  it('is not for a role that does not edit the timetable', async () => {
    open('principal');
    expect(await screen.findByText(en.problems.noAccessPart)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });
});
