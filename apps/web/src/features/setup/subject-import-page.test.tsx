import type { Role, SubjectImportPreview } from '@sodiq/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e200-0000-7000-8000-${String(n).padStart(12, '0')}`;

const IMPORT = uid(1);

// All names are invented. The owner's change of 7 November 2026 (pull request
// #316; `05`, "Excel import of subjects"): the preview of every row with its
// problems in words, and the confirm that saves all rows or none.
const NOT_CLEAN: SubjectImportPreview = {
  importId: IMPORT,
  alreadyImportedOn: null,
  quarterCount: 7,
  clean: false,
  rows: [
    {
      rowNumber: 4,
      names: { uz: 'Robototexnika', ru: 'Робототехника', en: 'Robotics' },
      problems: [
        { column: 'nameEn', code: 'already_exists' },
        { column: 'quarterRatingExam', code: 'rating_exam_weight_unwanted' },
      ],
    },
    {
      rowNumber: 5,
      names: { uz: 'Mantiq', ru: 'Логика', en: 'Logic' },
      problems: [{ column: 'nameEn', code: 'duplicate_in_file', rows: [6] }],
    },
    {
      rowNumber: 3,
      names: { uz: 'Astronomiya', ru: 'Астрономия', en: 'Astronomy' },
      problems: [],
    },
  ],
};

const CLEAN: SubjectImportPreview = {
  ...NOT_CLEAN,
  clean: true,
  rows: NOT_CLEAN.rows.filter((row) => row.rowNumber === 3),
};

function open(role: Role, handlers: Parameters<typeof fakeApi>[0] = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ assignments: [{ role, branchId: NORTH.id }] })),
    ...handlers,
  });
  renderApp('/setup/subjects/import');
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

const choose = () => {
  fireEvent.change(screen.getByLabelText(en.people.import.upload), {
    target: {
      files: [
        new File(['PK'], 'subjects.xlsx', {
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

describe('the subject import page', () => {
  it('lists the problems in words, each with its column, and keeps Save off', async () => {
    const calls = open('academic_vice_principal', {
      'PUT /api/setup/subjects/imports': () => json(NOT_CLEAN),
    });
    await screen.findByRole('heading', { name: en.setup.subjectImport.title });
    choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    const items = (name: string) =>
      [...rowOf(name).querySelectorAll('li')].map((item) => item.textContent);
    expect(items('Robotics')).toEqual([
      `Name in English: ${en.errors.already_exists}`,
      `Quarterly: rating exam: ${en.setup.subjectImport.problems.rating_exam_weight_unwanted}`,
    ]);
    expect(items('Logic')).toEqual([
      `Name in English: ${en.setup.subjectImport.problems.duplicate_in_file.replace('{{rows}}', '6')}`,
    ]);
    expect(rowOf('Astronomy').textContent).toContain(en.people.import.rowClean);
    expect(screen.getByText(/goes to 7 open quarters/)).toBeDefined();
    const save = screen.getByRole('button', { name: /Save all 3 subjects/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(en.setup.subjectImport.notClean)).toBeDefined();
    expect(calls.some((call) => call.route.includes('/confirm'))).toBe(false);
  });

  it('confirms a clean preview and says how many subjects were saved', async () => {
    const calls = open('super_admin', {
      'PUT /api/setup/subjects/imports': () => json(CLEAN),
      [`POST /api/setup/subjects/imports/${IMPORT}/confirm`]: () =>
        json({
          outcome: 'saved',
          created: 1,
          subjects: [{ id: uid(10), names: CLEAN.rows[0]?.names }],
        }),
    });
    await screen.findByRole('heading', { name: en.setup.subjectImport.title });
    choose();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    const save = screen.getByRole('button', { name: /Save 1 subject/ });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText('1 subject saved.')).toBeDefined();
    expect(
      calls.find((call) => call.route === `POST /api/setup/subjects/imports/${IMPORT}/confirm`)
        ?.body,
    ).toEqual({});
    expect(screen.getByRole('link', { name: en.setup.subjectImport.toList })).toBeDefined();
  });

  it('shows the preview again when the confirm finds a row no longer clean', async () => {
    open('super_admin', {
      'PUT /api/setup/subjects/imports': () => json(CLEAN),
      [`POST /api/setup/subjects/imports/${IMPORT}/confirm`]: () =>
        json({ outcome: 'not_clean', preview: NOT_CLEAN }),
    });
    await screen.findByRole('heading', { name: en.setup.subjectImport.title });
    choose();
    fireEvent.click(await screen.findByRole('button', { name: /Save 1 subject/ }));
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(rowOf('Robotics').textContent).toContain(en.errors.already_exists);
  });

  it('is not for a role that does not create subjects', async () => {
    open('principal');
    expect(await screen.findByText(en.problems.noAccessPart)).toBeDefined();
    expect(screen.queryByLabelText(en.people.import.upload)).toBeNull();
  });
});
