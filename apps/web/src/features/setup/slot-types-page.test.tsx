import type { SlotType, TemplatePreview, TemplateTable } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const PATH = '/setup/slot-types';
const TODAY = '2026-10-10';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const LESSON: SlotType = {
  id: uid(1),
  name: 'Lesson 45',
  kind: 'lesson',
  lengthMinutes: 45,
  lengths: [
    { lengthMinutes: 45, validFrom: '2026-09-01', validUntil: '2026-11-01' },
    { lengthMinutes: 40, validFrom: '2026-11-01', validUntil: null },
  ],
  archivedAt: null,
};

const LUNCH: SlotType = {
  id: uid(2),
  name: 'Lunch',
  kind: 'break',
  lengthMinutes: 40,
  lengths: [{ lengthMinutes: 40, validFrom: '2026-09-01', validUntil: null }],
  archivedAt: null,
};

const table = (date: string, end: number): TemplateTable => ({
  date,
  weekdays: [1, 2, 3, 4, 5],
  cells: [1, 2, 3, 4, 5].flatMap((weekday) =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((grade) => ({
      weekday: weekday as 1 | 2 | 3 | 4 | 5,
      grade,
      template: { id: uid(9), name: 'Main', start: 480, end, lessonSlots: 2 },
    })),
  ),
});

const PREVIEW: TemplatePreview = {
  before: table('2026-10-11', 610),
  after: table('2026-10-11', 600),
  changed: [{ weekday: 1, grade: 1 }],
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
) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/setup/slot-types': () => json({ today: TODAY, slotTypes: [LESSON, LUNCH] }),
    ...extra,
  });
  renderApp(PATH, language);
  const texts = language === 'ru' ? ru : en;
  await screen.findByRole('heading', { name: texts.setup.slotTypes.title });
  await screen.findByRole('table', { name: texts.setup.slotTypes.caption });
  return calls;
}

const openSlotType = async (name: string) => {
  fireEvent.click(screen.getByText(name, { selector: 'button' }));
  return screen.findByRole('complementary', { name });
};

// docs/spec/03-school-setup.md, Slot types and day templates: "A slot type has
// a name, a kind (lesson or break) and a length in minutes"; "saving a
// template at any level shows that table with the changes marked, as the
// preview of the change". The owner's answers 9, 12 and 14 (task 1.5).
describe('the slot types page', () => {
  it('lists the slot types with kind, length today and a planned length', async () => {
    await openList();

    expect(rowsDrawn()).toEqual([
      ['Lesson 45', 'Lesson', '45 min', '40 min from November 1, 2026', 'Active'],
      ['Lunch', 'Break', '40 min', '', 'Active'],
    ]);
  });

  it('names the kinds in Russian when Russian is chosen', async () => {
    await openList('academic_vice_principal', {}, 'ru');

    expect(rowsDrawn().map((row) => row[1])).toEqual([
      ru.setup.slotTypes.kinds.lesson,
      ru.setup.slotTypes.kinds.break,
    ]);
  });

  it('adds a slot type from its name, kind and length', async () => {
    const calls = await openList('academic_vice_principal', {
      'POST /api/setup/slot-types': (body) =>
        json({ ...LUNCH, ...(body as object), id: uid(3) }, 201),
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.slotTypes.add }));
    const form = await screen.findByRole('form', { name: en.setup.slotTypes.newTitle });
    type(within(form).getByLabelText(en.setup.slotTypes.name), 'Long break');
    type(within(form).getByLabelText(en.setup.slotTypes.kind), 'break');
    type(within(form).getByLabelText(en.setup.slotTypes.length), '20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/setup/slot-types')?.body).toEqual({
        name: 'Long break',
        kind: 'break',
        lengthMinutes: 20,
      });
    });
  });

  it('says what to fix before anything is sent: a length outside 5 to 180', async () => {
    const calls = await openList();
    fireEvent.click(screen.getByRole('button', { name: en.setup.slotTypes.add }));
    const form = await screen.findByRole('form', { name: en.setup.slotTypes.newTitle });
    type(within(form).getByLabelText(en.setup.slotTypes.name), 'Too long');
    type(within(form).getByLabelText(en.setup.slotTypes.length), '181');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText('Enter a number that is 180 or less.')).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/setup/slot-types')).toBe(false);
  });

  // `03`: the preview of the change before it is saved.
  it('shows the table with the changed cells marked before a new length is saved, from tomorrow by default', async () => {
    const calls = await openList('academic_vice_principal', {
      'POST /api/setup/day-template-table/preview': () => json(PREVIEW),
      [`POST /api/setup/slot-types/${LUNCH.id}/lengths`]: () => json(LUNCH),
    });

    const panel = await openSlotType('Lunch');
    const form = within(panel).getByRole('form', { name: en.setup.slotTypes.changeLength });
    expect(within(form).getByLabelText<HTMLInputElement>(en.setup.slotTypes.from).value).toBe(
      '2026-10-11',
    );
    type(within(form).getByLabelText(en.setup.slotTypes.length), '30');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('dialog', { name: en.setup.templateTable.previewTitle });
    expect(
      calls.find((call) => call.route === 'POST /api/setup/day-template-table/preview')?.body,
    ).toEqual({
      kind: 'slot_length',
      slotTypeId: LUNCH.id,
      change: { lengthMinutes: 30, from: '2026-10-11' },
    });
    expect(dialog.querySelectorAll('[data-changed="true"]')).toHaveLength(1);
    expect(
      calls.some((call) => call.route === `POST /api/setup/slot-types/${LUNCH.id}/lengths`),
    ).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.templateTable.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/setup/slot-types/${LUNCH.id}/lengths`)?.body,
      ).toEqual({
        lengthMinutes: 30,
        from: '2026-10-11',
      });
    });
  });

  it('saves nothing when the preview is answered "Do not save", and says so', async () => {
    const calls = await openList('academic_vice_principal', {
      'POST /api/setup/day-template-table/preview': () => json(PREVIEW),
    });

    const panel = await openSlotType('Lunch');
    const form = within(panel).getByRole('form', { name: en.setup.slotTypes.changeLength });
    type(within(form).getByLabelText(en.setup.slotTypes.length), '30');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('dialog', { name: en.setup.templateTable.previewTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.templateTable.cancel }));

    expect(await within(panel).findByText(en.form.notSaved)).toBeDefined();
    expect(
      calls.some((call) => call.route === `POST /api/setup/slot-types/${LUNCH.id}/lengths`),
    ).toBe(false);
  });

  it('shows the refusal of the preview, and opens no dialog', async () => {
    await openList('academic_vice_principal', {
      'POST /api/setup/day-template-table/preview': () =>
        Response.json(
          { error: { code: 'day_past_midnight', message: 'ENGLISH', requestId: 'r' } },
          { status: 409 },
        ),
    });

    const panel = await openSlotType('Lesson 45');
    const form = within(panel).getByRole('form', { name: en.setup.slotTypes.changeLength });
    type(within(form).getByLabelText(en.setup.slotTypes.length), '180');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(panel).findByText(en.errors.day_past_midnight)).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('archives a slot type after asking, naming it', async () => {
    const calls = await openList('academic_vice_principal', {
      [`POST /api/setup/slot-types/${LUNCH.id}/archive`]: () =>
        json({ ...LUNCH, archivedAt: '2026-10-10T10:00:00.000Z' }),
    });
    const panel = await openSlotType('Lunch');
    fireEvent.click(within(panel).getByRole('button', { name: en.setup.slotTypes.archive }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.slotTypes.archive }));

    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/setup/slot-types/${LUNCH.id}/archive`),
      ).toBe(true);
    });
  });

  it('shows the Principal the lengths without a form or a button', async () => {
    await openList('principal');

    expect(screen.queryByRole('button', { name: en.setup.slotTypes.add })).toBeNull();
    const panel = await openSlotType('Lesson 45');
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.slotTypes.archive })).toBeNull();
    expect(within(panel).getAllByText('November 1, 2026', { selector: 'td' })).toHaveLength(2);
  });
});
