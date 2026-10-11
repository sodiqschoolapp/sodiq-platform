import type { DayTemplate, DayTemplateSummary, SlotType, TemplatePreview } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const PATH = '/setup/day-templates';
const TODAY = '2026-10-10';
const TOMORROW = '2026-10-11';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const slotType = (n: number, name: string, kind: 'lesson' | 'break', length: number): SlotType => ({
  id: uid(n),
  name,
  kind,
  lengthMinutes: length,
  lengths: [{ lengthMinutes: length, validFrom: '2026-09-01', validUntil: null }],
  archivedAt: null,
});

const LESSON = slotType(1, 'Lesson 45', 'lesson', 45);
const LUNCH = slotType(2, 'Lunch', 'break', 40);

const MAIN: DayTemplateSummary = {
  id: uid(10),
  name: 'Main',
  archivedAt: null,
  start: 480,
  end: 610,
  lessonSlots: 2,
  inUse: true,
};

const MAIN_DETAIL: DayTemplate = {
  id: MAIN.id,
  name: 'Main',
  archivedAt: null,
  date: TOMORROW,
  slots: [
    {
      position: 1,
      slotTypeId: LESSON.id,
      name: 'Lesson 45',
      kind: 'lesson',
      lengthMinutes: 45,
      start: 480,
      end: 525,
      lessonNumber: 1,
    },
    {
      position: 2,
      slotTypeId: LUNCH.id,
      name: 'Lunch',
      kind: 'break',
      lengthMinutes: 40,
      start: 525,
      end: 565,
      lessonNumber: null,
    },
    {
      position: 3,
      slotTypeId: LESSON.id,
      name: 'Lesson 45',
      kind: 'lesson',
      lengthMinutes: 45,
      start: 565,
      end: 610,
      lessonNumber: 2,
    },
  ],
  versions: [
    {
      id: uid(20),
      startMinutes: 480,
      slotTypeIds: [LESSON.id, LUNCH.id, LESSON.id],
      validFrom: '2026-09-01',
      validUntil: null,
    },
  ],
};

const EMPTY_PREVIEW: TemplatePreview = {
  before: { date: TOMORROW, weekdays: [1, 2, 3, 4, 5], cells: [] },
  after: { date: TOMORROW, weekdays: [1, 2, 3, 4, 5], cells: [] },
  changed: [],
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

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
  );

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openList(
  role: 'super_admin' | 'principal' | 'academic_vice_principal' = 'academic_vice_principal',
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
  slotTypes: SlotType[] = [LESSON, LUNCH],
) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/setup/day-templates': () => json({ today: TODAY, dayTemplates: [MAIN] }),
    'GET /api/setup/slot-types': () => json({ today: TODAY, slotTypes }),
    [`GET /api/setup/day-templates/${MAIN.id}`]: () => json(MAIN_DETAIL),
    ...extra,
  });
  renderApp(PATH, language);
  const texts = language === 'ru' ? ru : en;
  await screen.findByRole('heading', { name: texts.setup.dayTemplates.title });
  await screen.findByRole('table', { name: texts.setup.dayTemplates.caption });
  return calls;
}

/** The slots of the slot editor as drawn: their names with their times. */
const slotsOf = (form: HTMLElement): string[] =>
  [...form.querySelectorAll('ol li')].map((item) =>
    (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

// docs/spec/03-school-setup.md, Slot types and day templates: "A day template
// is a start time and an ordered list of slots chosen from these types. The
// Academic Vice Principal adds, removes and reorders slots; every start and
// end time is calculated from the order and the lengths. Times are never typed
// by hand." The owner's answer 10: "reordering by up and down buttons".
describe('the day templates page', () => {
  it('lists the templates with their day today, their lesson slots and whether they are set', async () => {
    await openList();

    expect(rowsDrawn()).toEqual([
      ['Main', '08:00–10:10', '2', en.setup.dayTemplates.inUse, en.setup.dayTemplates.active],
    ]);
  });

  it('names the use in Russian when Russian is chosen', async () => {
    await openList('academic_vice_principal', {}, 'ru');

    expect(rowsDrawn()[0]?.[3]).toBe(ru.setup.dayTemplates.inUse);
  });

  it('builds a new template: the times follow the start, the order and the lengths, and move when a slot is moved', async () => {
    const calls = await openList('academic_vice_principal', {
      'POST /api/setup/day-templates': () => json(MAIN_DETAIL, 201),
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.dayTemplates.add }));
    const form = await screen.findByRole('form', { name: en.setup.dayTemplates.newTitle });
    type(within(form).getByLabelText(en.setup.dayTemplates.name), 'Senior');
    type(within(form).getByLabelText(en.setup.dayTemplates.startTime), '08:30');
    const choice = within(form).getByLabelText(
      en.form.addChoice.replace('{{label}}', en.setup.dayTemplates.slots),
    );
    const add = within(form).getByRole('button', { name: en.form.add });
    fireEvent.click(add); // Lesson 45, the first offered
    type(choice, LUNCH.id);
    fireEvent.click(add);
    type(choice, LESSON.id);
    fireEvent.click(add);

    expect(slotsOf(form)).toEqual([
      '1Lesson 45 · Lesson08:30–09:15',
      '2Lunch · Break09:15–09:55',
      '3Lesson 45 · Lesson09:55–10:40',
    ]);

    // Lunch one slot later: every time is calculated again.
    fireEvent.click(
      within(form).getByRole('button', {
        name: en.form.moveDown.replace('{{name}}', 'Lunch · Break').replace('{{place}}', '2'),
      }),
    );
    expect(slotsOf(form)).toEqual([
      '1Lesson 45 · Lesson08:30–09:15',
      '2Lesson 45 · Lesson09:15–10:00',
      '3Lunch · Break10:00–10:40',
    ]);

    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/setup/day-templates')?.body).toEqual({
        name: 'Senior',
        startTime: '08:30',
        slotTypeIds: [LESSON.id, LESSON.id, LUNCH.id],
      });
    });
  });

  it('names an archived slot type still in a template, and never offers it for adding', async () => {
    const archived = {
      ...slotType(3, 'Lesson 40', 'lesson', 40),
      archivedAt: '2026-10-01T10:00:00.000Z',
    };
    await openList(
      'academic_vice_principal',
      {
        [`GET /api/setup/day-templates/${MAIN.id}`]: () =>
          json({
            ...MAIN_DETAIL,
            versions: [
              { ...MAIN_DETAIL.versions[0], slotTypeIds: [archived.id, LUNCH.id, LESSON.id] },
            ],
          }),
      },
      'en',
      [LESSON, LUNCH, archived],
    );

    fireEvent.click(screen.getByText('Main', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Main' });
    const form = await within(panel).findByRole('form', {
      name: en.setup.dayTemplates.changeSlots,
    });
    expect(slotsOf(form)[0]).toContain('Lesson 40 · Lesson');
    const choice = within(form).getByLabelText(
      en.form.addChoice.replace('{{label}}', en.setup.dayTemplates.slots),
    );
    expect([...choice.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Lesson 45 · Lesson',
      'Lunch · Break',
    ]);
  });

  it('switches "Add day template" off until a lesson slot type exists, saying why', async () => {
    await openList('academic_vice_principal', {}, 'en', [LUNCH]);

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: en.setup.dayTemplates.add }).disabled,
    ).toBe(true);
    expect(screen.getByText(en.setup.dayTemplates.needLessonType)).toBeDefined();
  });

  it('shows the day of a template tomorrow and saves new slots from a date after the preview', async () => {
    const calls = await openList('academic_vice_principal', {
      'POST /api/setup/day-template-table/preview': () => json(EMPTY_PREVIEW),
      [`POST /api/setup/day-templates/${MAIN.id}/versions`]: () => json(MAIN_DETAIL),
    });

    fireEvent.click(screen.getByText('Main', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Main' });
    // The day of tomorrow, and the same times in the form that starts from it.
    expect(await within(panel).findAllByText('08:00–08:45')).toHaveLength(2);
    const form = within(panel).getByRole('form', { name: en.setup.dayTemplates.changeSlots });
    expect(within(form).getByLabelText<HTMLInputElement>(en.setup.dayTemplates.from).value).toBe(
      TOMORROW,
    );
    fireEvent.click(
      within(form).getByRole('button', {
        name: en.form.remove.replace('{{name}}', 'Lunch · Break').replace('{{place}}', '2'),
      }),
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('dialog', { name: en.setup.templateTable.previewTitle });
    expect(within(dialog).getByText(en.setup.templateTable.noChange)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.templateTable.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/setup/day-templates/${MAIN.id}/versions`)
          ?.body,
      ).toEqual({
        from: TOMORROW,
        startTime: '08:00',
        slotTypeIds: [LESSON.id, LESSON.id],
      });
    });
  });

  it('shows the Principal the day and the versions without a form', async () => {
    await openList('principal');

    expect(screen.queryByRole('button', { name: en.setup.dayTemplates.add })).toBeNull();
    fireEvent.click(screen.getByText('Main', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Main' });
    expect(await within(panel).findByText('08:00–08:45')).toBeDefined();
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.dayTemplates.archive })).toBeNull();
  });
});
