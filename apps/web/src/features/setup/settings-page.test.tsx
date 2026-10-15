import { GRADE_BANDS } from '@sodiq/calc';
import type { AttendanceValuesList, BranchSettings, Role, TravelTimeList } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
    language,
  });

const SETTINGS: BranchSettings = {
  editDays: 7,
  lowResult: 50,
  resultDrop: 15,
  attendancePercent: 80,
  absencesInRow: 3,
};

const QUARTER_ID = '0199b000-0000-7000-8000-000000000011';

const VALUES: AttendanceValuesList = {
  years: [
    {
      id: '0199b000-0000-7000-8000-000000000010',
      name: '2026–2027',
      status: 'current',
      quarters: [1, 2, 3, 4].map((number) => ({
        id: number === 1 ? QUARTER_ID : `0199b000-0000-7000-8000-00000000001${String(number + 1)}`,
        number,
        startDate: null,
        endDate: null,
        lateValue: 50,
        skippedValue: 0,
      })),
    },
  ],
};

const settingsApi = (role: Role, extra: Record<string, (body: unknown) => Response> = {}) =>
  fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role)),
    'GET /api/setup/settings': () => json(SETTINGS),
    'GET /api/setup/attendance-values': () => json(VALUES),
    ...extra,
  });

const section = async (name: string) => within(await screen.findByRole('region', { name }));

// Task 1.6; the owner's answers 19 to 24.
describe('the settings page', () => {
  it('lets the Academic Vice Principal change the edit days', async () => {
    const calls = settingsApi('academic_vice_principal', {
      'PUT /api/setup/settings/edit-days': () => json({ ...SETTINGS, editDays: 10 }),
    });
    renderApp('/setup/settings');
    const field = await (
      await section(en.setup.settings.editDaysTitle)
    ).findByLabelText(en.setup.settings.editDays);
    expect((field as HTMLInputElement).value).toBe('7');
    fireEvent.change(field, { target: { value: '10' } });
    fireEvent.click(
      (await section(en.setup.settings.editDaysTitle)).getByRole('button', { name: en.form.save }),
    );

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === 'PUT /api/setup/settings/edit-days')?.body,
      ).toEqual({
        editDays: 10,
      });
    });
  });

  it('sends the four thresholds and a quarter’s late and skipped values', async () => {
    const calls = settingsApi('super_admin', {
      'PUT /api/setup/settings/early-warning': (body) => json({ ...SETTINGS, ...(body as object) }),
      [`PUT /api/setup/quarters/${QUARTER_ID}/attendance-values`]: (body) =>
        json({ ...VALUES.years[0]?.quarters[0], ...(body as object) }),
    });
    renderApp('/setup/settings');
    const warning = await section(en.setup.settings.earlyWarningTitle);
    const low = await warning.findByLabelText(en.setup.settings.thresholds.lowResult);
    fireEvent.change(low, { target: { value: '45' } });
    fireEvent.click(warning.getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === 'PUT /api/setup/settings/early-warning')?.body,
      ).toEqual({
        lowResult: 45,
        resultDrop: 15,
        attendancePercent: 80,
        absencesInRow: 3,
      });
    });

    const quarter = within(
      await screen.findByRole('form', {
        name: en.setup.settings.quarterOfYear
          .replace('{{year}}', '2026–2027')
          .replace('{{number}}', '1'),
      }),
    );
    const late = quarter.getByLabelText(en.setup.settings.lateValue);
    fireEvent.change(late, { target: { value: '75' } });
    fireEvent.click(quarter.getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find(
          (call) => call.route === `PUT /api/setup/quarters/${QUARTER_ID}/attendance-values`,
        )?.body,
      ).toEqual({ lateValue: 75, skippedValue: 0 });
    });
  });

  // Answer 24: the Principal views.
  it('shows the values read only to the Principal', async () => {
    settingsApi('principal');
    renderApp('/setup/settings');
    await screen.findByRole('heading', { name: en.setup.settings.editDaysTitle });
    expect(screen.queryByRole('button', { name: en.form.save })).toBeNull();
    expect(screen.queryByLabelText(en.setup.settings.editDays)).toBeNull();
    await waitFor(() => {
      const rows = [...document.querySelectorAll('tbody tr')].map((row) => row.textContent);
      expect(rows).toContain(`${en.setup.settings.quarter.replace('{{number}}', '1')}500`);
    });
  });

  it('shows the languages of instruction', async () => {
    settingsApi('principal');
    renderApp('/setup/settings');
    const languages = await screen.findByRole('region', { name: en.setup.settings.languagesTitle });
    expect(
      within(languages)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Uzbek', 'Russian']);
  });

  // Build plan 4.2 (from 1.6, decision 5): the page draws the bands of packages/calc, the same
  // in every language (task 4.2, decision 7).
  it.each([
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ] as const)('draws the grade bands of packages/calc in %s', async (language, locale) => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role: 'principal', branchId: NORTH.id }],
            branches: [NORTH],
            language,
          }),
        ),
      'GET /api/setup/settings': () => json(SETTINGS),
      'GET /api/setup/attendance-values': () => json(VALUES),
    });
    renderApp('/setup/settings', language);
    const table = await screen.findByRole('table', { name: locale.setup.settings.gradeBandsTitle });
    expect(
      [...table.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent),
      ),
    ).toEqual(GRADE_BANDS.map(({ from, to, grade }) => [`${from}–${to}`, String(grade)]));
  });

  it.each([
    ['ru', ru],
    ['uz', uz],
  ] as const)('reads the grade bands from the page in %s', async (language, locale) => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role: 'principal', branchId: NORTH.id }],
            branches: [NORTH],
            language,
          }),
        ),
      'GET /api/setup/settings': () => json(SETTINGS),
      'GET /api/setup/attendance-values': () => json(VALUES),
    });
    renderApp('/setup/settings', language);
    const table = await screen.findByRole('table', { name: locale.setup.settings.gradeBandsTitle });
    expect(
      [...table.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['0–49', '2'],
      ['50–66', '3'],
      ['67–83', '4'],
      ['84–100', '5'],
    ]);
  });

  it('draws the grade bands as a table', async () => {
    settingsApi('principal');
    renderApp('/setup/settings');
    const table = await screen.findByRole('table', { name: en.setup.settings.gradeBandsTitle });
    expect(
      [...table.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['0–49', '2'],
      ['50–66', '3'],
      ['67–83', '4'],
      ['84–100', '5'],
    ]);
  });

  it('speaks Russian', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal', 'ru')),
      'GET /api/setup/settings': () => json(SETTINGS),
      'GET /api/setup/attendance-values': () => json({ years: [] }),
    });
    renderApp('/setup/settings', 'ru');
    expect(await screen.findByRole('heading', { name: ru.setup.settings.title })).toBeDefined();
    expect(await screen.findByText(ru.setup.settings.attendanceNoYear)).toBeDefined();
  });

  it('shows a failure with a retry', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('principal')) });
    renderApp('/setup/settings');
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
  });
});

const PAIRS: TravelTimeList = {
  pairs: [{ branchId: SOUTH.id, branchName: SOUTH.name, minutes: null }],
};

// Answer 21; decision 4: a pair not set says so.
describe('the travel time page', () => {
  it('lets the Super Admin set the minutes to another branch', async () => {
    let stored: TravelTimeList = PAIRS;
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('super_admin')),
      'GET /api/setup/travel-times': () => json(stored),
      'PUT /api/setup/travel-times': () => {
        stored = { pairs: [{ branchId: SOUTH.id, branchName: SOUTH.name, minutes: 40 }] };
        return json(stored);
      },
    });
    renderApp('/setup/travel-times');
    const pair = within(await screen.findByRole('region', { name: SOUTH.name }));
    expect(pair.getByText(en.setup.travelTimes.notSet)).toBeDefined();
    fireEvent.change(pair.getByLabelText(en.setup.travelTimes.minutes), {
      target: { value: '40' },
    });
    fireEvent.click(pair.getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'PUT /api/setup/travel-times')?.body).toEqual({
        otherBranchId: SOUTH.id,
        minutes: 40,
      });
    });
    expect(await screen.findByText('40 minutes')).toBeDefined();
    // Issue #39, hand test of 13 October 2026, finding 18: the form is not drawn
    // again by its own save, so its sign stays.
    expect(pair.getByRole('status').textContent).toBe(en.form.saved);
  });

  it.each(['principal', 'academic_vice_principal'] as const)(
    'is read only for the %s',
    async (role) => {
      fakeApi({
        'GET /api/auth/session': () => json(sessionAs(role)),
        'GET /api/setup/travel-times': () => json(PAIRS),
      });
      renderApp('/setup/travel-times');
      await screen.findByRole('heading', { name: en.setup.travelTimes.title });
      const row = await waitFor(() => {
        const found = document.querySelector('tbody tr');
        expect(found).not.toBeNull();
        return found;
      });
      expect([...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent)).toEqual([
        SOUTH.name,
        en.setup.travelTimes.notSet,
      ]);
      expect(screen.queryByRole('button', { name: en.form.save })).toBeNull();
    },
  );
});
