import type { PatternImportPreview, Role, TimetableVersion } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

// All names are invented. Task 5.14 (`06`, Importing the load and the timetable): the preview of
// every row with its problems in words, the engine's warnings listed, and the confirm that, after
// the person agrees to remove the draft's lessons, replaces them with the file's.
const NOT_CLEAN: PatternImportPreview = {
  importId: IMPORT,
  versionId: VERSION.id,
  alreadyImportedOn: null,
  removes: [uid(20), uid(21)],
  lessons: 1,
  clean: false,
  warnings: [],
  rows: [
    {
      rowNumber: 4,
      cells: { weekday: 'Tuesday', lessonNumber: '3', unit: '7-E-1', subject: 'English' },
      problems: [{ column: 'unit', code: 'pattern_import_block_part', units: ['7-E-3'] }],
    },
    {
      rowNumber: 5,
      cells: { weekday: 'Monday', lessonNumber: '1', unit: '7 Princeton', subject: 'Algebra' },
      problems: [{ column: null, code: 'teacher_double', rows: [3] }],
    },
    {
      rowNumber: 3,
      cells: { weekday: 'Monday', lessonNumber: '1', unit: '7 Oxford', subject: 'Algebra' },
      problems: [],
    },
  ],
};

const CLEAN: PatternImportPreview = {
  ...NOT_CLEAN,
  clean: true,
  warnings: [{ rule: 'subject_twice', weekday: 1, rows: [3] }],
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
  renderApp(`/timetable/pattern/import?version=${version.id}`);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

const choose = async () => {
  fireEvent.change(await screen.findByLabelText(en.people.import.upload), {
    target: {
      files: [
        new File(['PK'], 'timetable.xlsx', {
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

const CONFIRM = `POST /api/timetable/versions/${VERSION.id}/pattern/imports/${IMPORT}/confirm`;

describe('the timetable import page', () => {
  it('lists the problems in words, the rule of the engine with its rows, and keeps Place off', async () => {
    const calls = open('academic_vice_principal', {
      [`PUT /api/timetable/versions/${VERSION.id}/pattern/imports`]: () => json(NOT_CLEAN),
    });
    await screen.findByRole('heading', { name: en.timetable.patternImport.title });
    await choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    const items = (text: string) =>
      [...rowOf(text).querySelectorAll('li')].map((item) => item.textContent);
    expect(items('7-E-1')).toEqual([
      `Class or group: ${en.timetable.patternImport.problems.pattern_import_block_part.replace('{{units}}', '7-E-3')}`,
    ]);
    expect(items('7 Princeton')).toEqual([
      en.timetable.patternImport.ruleWith
        .replace('{{rule}}', en.timetable.rule.teacher_double)
        .replace('{{rows}}', '3'),
    ]);
    expect(rowOf('7 Oxford').textContent).toContain(en.people.import.rowClean);
    expect(
      screen.getByText(/The draft holds 2 placed lessons; confirming removes them\./),
    ).toBeDefined();
    const place = screen.getByRole('button', { name: /Place 1 lesson/ });
    expect((place as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(en.timetable.patternImport.notClean)).toBeDefined();
    expect(calls.some((call) => call.route.includes('/confirm'))).toBe(false);
  });

  it('asks before removing the draft lessons, names them, and sends the lessons it showed', async () => {
    const calls = open('super_admin', {
      [`PUT /api/timetable/versions/${VERSION.id}/pattern/imports`]: () => json(CLEAN),
      [CONFIRM]: () => json({ outcome: 'saved', removed: 2, placed: 1 }),
    });
    await screen.findByRole('heading', { name: en.timetable.patternImport.title });
    await choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(
      screen.getByText(
        en.timetable.patternImport.warningRows
          .replace('{{rule}}', en.timetable.rule.subject_twice)
          .replace('{{rows}}', '3'),
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Place 1 lesson/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove 2 placed lessons of this draft?')).toBeDefined();
    // Declined: nothing is sent.
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(calls.some((call) => call.route === CONFIRM)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Place 1 lesson/ }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: en.timetable.patternImport.replaceAction,
      }),
    );
    expect(await screen.findByText(/1 lesson placed\./)).toBeDefined();
    expect(calls.find((call) => call.route === CONFIRM)?.body).toEqual({
      removes: [uid(20), uid(21)],
    });
    expect(screen.getByRole('link', { name: en.timetable.patternImport.toGrid })).toBeDefined();
  });

  it('confirms with no question when the draft holds no lesson', async () => {
    const calls = open('super_admin', {
      [`PUT /api/timetable/versions/${VERSION.id}/pattern/imports`]: () =>
        json({ ...CLEAN, removes: [] }),
      [CONFIRM]: () => json({ outcome: 'saved', removed: 0, placed: 1 }),
    });
    await screen.findByRole('heading', { name: en.timetable.patternImport.title });
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: /Place 1 lesson/ }));
    expect(await screen.findByText(/1 lesson placed\./)).toBeDefined();
    expect(calls.find((call) => call.route === CONFIRM)?.body).toEqual({ removes: [] });
  });

  it('says a published version takes no import', async () => {
    open('super_admin', {}, { ...VERSION, status: 'published' });
    expect(await screen.findByText(en.timetable.patternImport.noDraft)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });

  it('is not for a role that does not edit the timetable', async () => {
    open('principal');
    expect(await screen.findByText(en.problems.noAccessPart)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });
});
