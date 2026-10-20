import type { Assignment, DayTemplateSummary, TemplatePreview, TemplateTable } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { actionsAreLast, panelActionNames, savedInPanel } from '@/testing/panel';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { NO_LESSONS } from '@/testing/no-lessons';

const PATH = '/setup/day-template-settings';
const TODAY = '2026-10-10';
const TOMORROW = '2026-10-11';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const template = (n: number, name: string): DayTemplateSummary => ({
  id: uid(n),
  name,
  archivedAt: null,
  start: 480,
  end: 610,
  lessonSlots: 2,
  inUse: false,
});

const MAIN = template(1, 'Main');
const FRIDAY = template(2, 'Friday');

const DEFAULT: Assignment = {
  id: uid(10),
  level: 'default',
  weekday: null,
  gradeFrom: null,
  gradeTo: null,
  dayTemplateId: MAIN.id,
  validFrom: TOMORROW,
  validUntil: null,
};

const FRIDAYS: Assignment = {
  id: uid(11),
  level: 'weekday',
  weekday: 5,
  gradeFrom: null,
  gradeTo: null,
  dayTemplateId: FRIDAY.id,
  validFrom: TOMORROW,
  validUntil: '2026-12-01',
};

/** The table where Friday has its own template. */
const tableWith = (fridayName: string | null): TemplateTable => ({
  date: TOMORROW,
  weekdays: [1, 2, 3, 4, 5],
  cells: [1, 2, 3, 4, 5].flatMap((weekday) =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((grade) => ({
      weekday: weekday as 1 | 2 | 3 | 4 | 5,
      grade,
      template:
        weekday === 5 && fridayName !== null
          ? { id: FRIDAY.id, name: fridayName, start: 480, end: 570, lessonSlots: 2 }
          : { id: MAIN.id, name: 'Main', start: 480, end: 610, lessonSlots: 2 },
    })),
  ),
});

const PREVIEW: TemplatePreview = {
  before: tableWith(null),
  after: tableWith('Friday'),
  changed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((grade) => ({ weekday: 5, grade })),
  lessons: NO_LESSONS,
  slotsInUse: [],
};

const sessionAs = (
  role: 'super_admin' | 'principal' | 'academic_vice_principal',
  language = 'en',
) => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH],
  }),
  language,
});

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openPage(
  role: 'super_admin' | 'principal' | 'academic_vice_principal' = 'academic_vice_principal',
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/setup/day-template-assignments': () =>
      json({ today: TODAY, assignments: [DEFAULT, FRIDAYS] }),
    'GET /api/setup/day-templates': () => json({ today: TODAY, dayTemplates: [MAIN, FRIDAY] }),
    'GET /api/setup/day-template-table': () => json(tableWith('Friday')),
    ...extra,
  });
  renderApp(PATH, language);
  const texts = language === 'ru' ? ru : en;
  await screen.findByRole('heading', { name: texts.setup.templateSettings.title });
  await screen.findByRole('table', { name: texts.setup.templateTable.title });
  return calls;
}

/** The cell of the table of templates for a weekday (1 = Monday) and a grade. */
const cellOf = (tableElement: HTMLElement, weekday: number, grade: number): string =>
  tableElement.querySelectorAll('tbody tr')[grade - 1]?.querySelectorAll('td')[weekday - 1]
    ?.textContent ?? '';

// docs/spec/03-school-setup.md, Slot types and day templates: "School setup
// shows the template that results for every weekday and grade in one table;
// saving a template at any level shows that table with the changes marked, as
// the preview of the change." The owner's answers 11 and 13.
describe('the page of where day templates apply', () => {
  it('shows the template of every working weekday and grade, tomorrow by default', async () => {
    const calls = await openPage();

    const tableElement = screen.getByRole('table', { name: en.setup.templateTable.title });
    expect(tableElement.querySelectorAll('tbody tr')).toHaveLength(11);
    expect([...tableElement.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      en.setup.templateTable.grade,
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
    ]);
    expect(cellOf(tableElement, 1, 1)).toBe('Main08:00–10:10');
    expect(cellOf(tableElement, 5, 11)).toBe('Friday08:00–09:30');
    expect(calls.some((call) => call.route === 'GET /api/setup/day-template-table')).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(en.setup.templateTable.date).value).toBe(
      TOMORROW,
    );
  });

  // .claude/rules/web.md: a part that waits on a query never shows the loading outline for good.
  it('shows the table of tomorrow again when the date field is cleared', async () => {
    const calls = await openPage();
    const field = screen.getByLabelText<HTMLInputElement>(en.setup.templateTable.date);
    type(field, '2026-11-02');
    type(field, '');

    const tableElement = await screen.findByRole('table', { name: en.setup.templateTable.title });
    expect(cellOf(tableElement, 1, 1)).toBe('Main08:00–10:10');
    expect(
      calls.filter((call) => call.route === 'GET /api/setup/day-template-table').length,
    ).toBeGreaterThan(1);
  });

  it('names the weekdays and the levels in Russian when Russian is chosen', async () => {
    await openPage('academic_vice_principal', {}, 'ru');

    const tableElement = screen.getByRole('table', { name: ru.setup.templateTable.title });
    expect(tableElement.querySelectorAll('thead th')[1]?.textContent).toBe('Понедельник');
    // The level cell of each row: the filter label and the Weekday column
    // header have the same Russian words, so only the rows tell.
    const list = await screen.findByRole('table', { name: ru.setup.templateSettings.listTitle });
    expect(
      [...list.querySelectorAll('tbody tr')].map((row) => row.querySelector('th, td')?.textContent),
    ).toEqual([ru.setup.templateSettings.levels.default, ru.setup.templateSettings.levels.weekday]);
  });

  // `12`: every screen has loading, empty and error states; `.claude/rules/web.md`:
  // a part that waits on a query tells loading from failure, a disabled query too.
  it('says the settings failed in the table that waits on their date, and draws it after a retry', async () => {
    let calls = 0;
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/setup/day-template-assignments': () => {
        calls += 1;
        return calls === 1
          ? refusal('internal_error', 500)
          : json({ today: TODAY, assignments: [DEFAULT, FRIDAYS] });
      },
      'GET /api/setup/day-templates': () => json({ today: TODAY, dayTemplates: [MAIN, FRIDAY] }),
      'GET /api/setup/day-template-table': () => json(tableWith('Friday')),
    });
    renderApp(PATH);

    const section = await screen.findByRole('region', { name: en.setup.templateTable.title });
    expect(await within(section).findByRole('alert')).toBeDefined();
    fireEvent.click(within(section).getByRole('button', { name: en.problems.retry }));
    const tableElement = await within(section).findByRole('table', {
      name: en.setup.templateTable.title,
    });
    expect(cellOf(tableElement, 1, 1)).toBe('Main08:00–10:10');
  });

  it('says the templates failed instead of a form that is gone and a list without their names', async () => {
    let calls = 0;
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/setup/day-template-assignments': () =>
        json({ today: TODAY, assignments: [DEFAULT, FRIDAYS] }),
      'GET /api/setup/day-templates': () => {
        calls += 1;
        return calls === 1
          ? refusal('internal_error', 500)
          : json({ today: TODAY, dayTemplates: [MAIN, FRIDAY] });
      },
      'GET /api/setup/day-template-table': () => json(tableWith('Friday')),
    });
    renderApp(PATH);

    const set = await screen.findByRole('region', { name: en.setup.templateSettings.setTitle });
    expect(await within(set).findByRole('alert')).toBeDefined();
    expect(screen.queryByRole('table', { name: en.setup.templateSettings.listTitle })).toBeNull();
    fireEvent.click(within(set).getByRole('button', { name: en.problems.retry }));

    expect(
      await screen.findByRole('form', { name: en.setup.templateSettings.setTitle }),
    ).toBeDefined();
    const list = await screen.findByRole('table', { name: en.setup.templateSettings.listTitle });
    expect(list.textContent).toContain('Friday');
  });

  it('sets a template for a weekday after the preview marks the changed cells', async () => {
    const calls = await openPage('academic_vice_principal', {
      'POST /api/setup/day-template-table/preview': () => json(PREVIEW),
      'POST /api/setup/day-template-assignments': () => json(FRIDAYS, 201),
    });

    const form = screen.getByRole('form', { name: en.setup.templateSettings.setTitle });
    type(within(form).getByLabelText(en.setup.templateSettings.level), 'weekday');
    type(within(form).getByLabelText(en.setup.templateSettings.weekday), '5');
    type(within(form).getByLabelText(en.setup.templateSettings.template), FRIDAY.id);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('dialog', { name: en.setup.templateTable.previewTitle });
    const record = {
      level: 'weekday',
      weekday: 5,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: FRIDAY.id,
      from: TOMORROW,
    };
    expect(
      calls.find((call) => call.route === 'POST /api/setup/day-template-table/preview')?.body,
    ).toEqual({
      kind: 'assignment_set',
      change: record,
    });
    const changed = dialog.querySelectorAll('[data-changed="true"]');
    expect(changed).toHaveLength(11);
    expect(within(dialog).getByText('11 cells change.')).toBeDefined();
    // A changed cell is the info tint with the edit icon and a hidden word,
    // explained by a legend; never an orange outline (pull request #80,
    // decision 5).
    for (const cell of changed) {
      expect(cell.className).toContain('bg-info-bg');
      expect(cell.className).not.toMatch(/primary/);
      expect(cell.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(cell.querySelector('.sr-only')?.textContent).toBe(en.setup.templateTable.changed);
    }
    const legend = within(dialog).getByText(en.setup.templateTable.changedLegend);
    expect(legend.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const unchanged = dialog.querySelector('td:not([data-changed])');
    expect(unchanged?.querySelector('svg')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.templateTable.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === 'POST /api/setup/day-template-assignments')?.body,
      ).toEqual(record);
    });
  });

  it('asks for the grades at a grade level and says what to fix before anything is sent', async () => {
    const calls = await openPage();

    const form = screen.getByRole('form', { name: en.setup.templateSettings.setTitle });
    type(within(form).getByLabelText(en.setup.templateSettings.level), 'grades');
    type(within(form).getByLabelText(en.setup.templateSettings.gradeFrom), '9');
    type(within(form).getByLabelText(en.setup.templateSettings.gradeTo), '12');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText('Enter a number that is 11 or less.')).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/setup/day-template-table/preview')).toBe(
      false,
    );
  });

  it('ends a weekday setting from a date after the preview, and never offers to end the default', async () => {
    const calls = await openPage('academic_vice_principal', {
      'POST /api/setup/day-template-table/preview': () =>
        json({ ...PREVIEW, before: PREVIEW.after, after: PREVIEW.before }),
      [`POST /api/setup/day-template-assignments/${FRIDAYS.id}/end`]: () => json(FRIDAYS),
    });

    const rowName = `${en.setup.templateSettings.levels.weekday}: Friday`;
    fireEvent.click(
      screen.getByText(en.setup.templateSettings.levels.weekday, { selector: 'button' }),
    );
    const panel = await screen.findByRole('complementary', { name: rowName });
    // Task 2.7c-2b-1: read first; the end is the panel's one action, at the bottom.
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(panelActionNames(panel)).toEqual([en.setup.templateSettings.endTitle]);
    expect(actionsAreLast(panel)).toBe(true);
    fireEvent.click(
      within(panel).getByRole('button', { name: en.setup.templateSettings.endTitle }),
    );
    const form = await within(panel).findByRole('form', {
      name: en.setup.templateSettings.endTitle,
    });
    type(within(form).getByLabelText(en.setup.templateSettings.endFrom), '2026-11-02');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.templateTable.previewTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.templateTable.save }));

    await waitFor(() => {
      expect(
        calls.find(
          (call) => call.route === `POST /api/setup/day-template-assignments/${FRIDAYS.id}/end`,
        )?.body,
      ).toEqual({
        from: '2026-11-02',
      });
    });
    await savedInPanel(panel);

    fireEvent.click(
      screen.getByText(en.setup.templateSettings.levels.default, { selector: 'button' }),
    );
    const defaultPanel = await screen.findByRole('complementary', {
      name: `${en.setup.templateSettings.levels.default}: Main`,
    });
    expect(within(defaultPanel).queryByRole('form')).toBeNull();
    expect(within(defaultPanel).getByText(en.setup.templateSettings.defaultStays)).toBeDefined();
    expect(panelActionNames(defaultPanel)).toEqual([]);
  });

  it('keeps the end form open with its date when the preview is answered "Do not save"', async () => {
    const calls = await openPage('academic_vice_principal', {
      'POST /api/setup/day-template-table/preview': () =>
        json({ ...PREVIEW, before: PREVIEW.after, after: PREVIEW.before }),
    });
    fireEvent.click(
      screen.getByText(en.setup.templateSettings.levels.weekday, { selector: 'button' }),
    );
    const panel = await screen.findByRole('complementary', {
      name: `${en.setup.templateSettings.levels.weekday}: Friday`,
    });
    fireEvent.click(
      within(panel).getByRole('button', { name: en.setup.templateSettings.endTitle }),
    );
    const form = await within(panel).findByRole('form', {
      name: en.setup.templateSettings.endTitle,
    });
    type(within(form).getByLabelText(en.setup.templateSettings.endFrom), '2026-11-02');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.templateTable.previewTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.templateTable.cancel }));

    expect(await within(form).findByText(en.form.notSaved)).toBeDefined();
    expect(
      within(form).getByLabelText<HTMLInputElement>(en.setup.templateSettings.endFrom).value,
    ).toBe('2026-11-02');
    expect(calls.some((call) => call.route.endsWith('/end'))).toBe(false);
  });

  it('shows the Principal the table and the settings without a form', async () => {
    await openPage('principal');

    expect(screen.queryByRole('form', { name: en.setup.templateSettings.setTitle })).toBeNull();
    fireEvent.click(
      screen.getByText(en.setup.templateSettings.levels.weekday, { selector: 'button' }),
    );
    const panel = await screen.findByRole('complementary', {
      name: `${en.setup.templateSettings.levels.weekday}: Friday`,
    });
    expect(within(panel).queryByRole('form')).toBeNull();
  });
});
