import type { Role, StudentImportPreview } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const IMPORT = uid(1);
const HOLDER = uid(2);

// All names are invented. Task 9.4g, pull request #278: the preview of every
// row with its problems, the questions it asks, and the confirm that waits
// until every row is clean.
const NOT_CLEAN: StudentImportPreview = {
  importId: IMPORT,
  alreadyImportedOn: null,
  clean: false,
  rows: [
    {
      rowNumber: 4,
      uid: 'IMP-2',
      lastName: 'Aliyev',
      firstName: 'Sardor',
      className: '7 Oxford',
      problems: [{ column: 'relative1Phone', code: 'phone_held' }],
      warning: null,
      held: [
        {
          position: 1,
          holder: { id: HOLDER, fullName: 'Shoira Nazarova', students: 1 },
          linked: false,
        },
      ],
      linked: [],
    },
    {
      rowNumber: 5,
      uid: 'IMP-3',
      lastName: 'Karimova',
      firstName: 'Dilnoza',
      className: null,
      problems: [{ column: 'className', code: 'class_unknown' }],
      warning: null,
      held: [],
      linked: [],
    },
    {
      rowNumber: 3,
      uid: 'IMP-1',
      lastName: 'Rahimov',
      firstName: 'Botir',
      className: '7 Oxford',
      problems: [],
      warning: null,
      held: [],
      linked: [],
    },
  ],
};

const LINKED: StudentImportPreview = {
  ...NOT_CLEAN,
  clean: true,
  rows: NOT_CLEAN.rows
    .filter((row) => row.rowNumber !== 5)
    .map((row) =>
      row.rowNumber === 4
        ? { ...row, problems: [], held: row.held.map((one) => ({ ...one, linked: true })) }
        : row,
    ),
};

function open(role: Role, handlers: Parameters<typeof fakeApi>[0] = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ assignments: [{ role, branchId: NORTH.id }] })),
    ...handlers,
  });
  renderApp('/people/students/import');
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

const choose = () => {
  fireEvent.change(screen.getByLabelText(en.people.import.upload), {
    target: {
      files: [
        new File(['PK'], 'students.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ],
    },
  });
};

describe('the student import page', () => {
  it('uploads a file, shows each row with its problems in words, waits for a decision, and saves all rows', async () => {
    const calls = open('academic_vice_principal', {
      'PUT /api/people/students/imports': () => json(NOT_CLEAN),
      [`POST /api/people/students/imports/${IMPORT}/preview`]: () => json(LINKED),
      [`POST /api/people/students/imports/${IMPORT}/confirm`]: () =>
        json({ outcome: 'saved', created: 2, studentIds: [uid(10), uid(11)] }),
    });
    await screen.findByRole('heading', { name: en.people.import.title });
    choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    const upload = calls.find((call) => call.route === 'PUT /api/people/students/imports');
    expect(upload?.body).toEqual({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 2,
    });
    const rowOf = (uid: string) => {
      const found = rows().find((row) => row.textContent.includes(uid));
      if (found === undefined) throw new Error(`The row of ${uid}.`);
      return found as HTMLElement;
    };
    // Each problem names its column with the template's heading.
    expect(rowOf('IMP-3').textContent).toContain('Class name:');
    expect(rowOf('IMP-3').textContent).toContain(en.people.import.problems.class_unknown);
    expect(rowOf('IMP-2').textContent).toContain(en.people.import.problems.phone_held);
    const save = screen.getByRole('button', { name: /Save all 3 students/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // "Link to the existing person, whose stored name is kept".
    fireEvent.click(
      within(rowOf('IMP-2')).getByRole('checkbox', {
        name: /Relative 1: link to Shoira Nazarova/,
      }),
    );
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(
      calls.find((call) => call.route === `POST /api/people/students/imports/${IMPORT}/preview`)
        ?.body,
    ).toEqual({
      confirmedWarnings: [],
      relativeLinks: [{ rowNumber: 4, position: 1, relativeId: HOLDER }],
    });
    const ready = await screen.findByRole('button', { name: /Save all 2 students/ });
    await waitFor(() => {
      expect((ready as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(ready);
    expect(await screen.findByText('2 students saved.')).toBeDefined();
    expect(
      calls.find((call) => call.route === `POST /api/people/students/imports/${IMPORT}/confirm`)
        ?.body,
    ).toEqual({
      confirmedWarnings: [],
      relativeLinks: [{ rowNumber: 4, position: 1, relativeId: HOLDER }],
    });
  });

  it('shows a confirm the server refused as not clean with its new preview, nothing saved', async () => {
    open('academic_vice_principal', {
      'PUT /api/people/students/imports': () => json(LINKED),
      [`POST /api/people/students/imports/${IMPORT}/confirm`]: () =>
        json({ outcome: 'not_clean', preview: NOT_CLEAN }),
    });
    await screen.findByRole('heading', { name: en.people.import.title });
    choose();
    const save = await screen.findByRole('button', { name: /Save all 2 students/ });
    await waitFor(() => {
      expect((save as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(screen.queryByText(/students saved/)).toBeNull();
    expect(screen.getByText(en.people.import.notClean)).toBeDefined();
  });

  it('says why a file was refused', async () => {
    open('super_admin', {
      'PUT /api/people/students/imports': () => refusal('import_not_template', 422),
    });
    await screen.findByRole('heading', { name: en.people.import.title });
    choose();
    expect(await screen.findByText(en.errors.import_not_template)).toBeDefined();
  });

  it('is not for a role that does not create students', async () => {
    open('principal');
    expect(await screen.findByText(en.problems.noAccessPart)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });
});
