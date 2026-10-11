import type { AcademicYear, ErrorDetail } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const PATH = '/setup/years';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const undated = [1, 2, 3, 4].map((number) => ({ number, startDate: null, endDate: null }));

const CURRENT: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-02',
  endDate: '2027-05-25',
  status: 'current',
  quarters: [
    { number: 1, startDate: '2026-09-02', endDate: '2026-10-31' },
    { number: 2, startDate: '2026-11-10', endDate: '2026-12-27' },
    { number: 3, startDate: null, endDate: null },
    { number: 4, startDate: null, endDate: null },
  ],
};

const PLANNED: AcademicYear = {
  id: uid(2),
  name: '2027–2028',
  startDate: '2027-09-02',
  endDate: '2028-05-25',
  status: 'planned',
  quarters: undated,
};

const CLOSED: AcademicYear = {
  id: uid(3),
  name: '2025–2026',
  startDate: '2025-09-02',
  endDate: '2026-05-25',
  status: 'closed',
  quarters: undated,
};

/** A refusal that names fields, as `outside_year` does. */
const refusalWith = (code: string, details: ErrorDetail[]): Response =>
  Response.json(
    {
      error: {
        code,
        message: 'ENGLISH TEXT FOR THE DEVELOPER',
        requestId: 'test-request',
        details,
      },
    },
    { status: 409 },
  );

const sessionAs = (role: 'super_admin' | 'principal' | 'academic_vice_principal') =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH],
  });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
  );

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openList(
  role: 'super_admin' | 'principal' | 'academic_vice_principal' = 'super_admin',
  years: AcademicYear[] = [PLANNED, CURRENT, CLOSED],
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  const account = { ...sessionAs(role), language };
  const calls = fakeApi({
    'GET /api/auth/session': () => json(account),
    'GET /api/setup/academic-years': () => json({ years }),
    ...extra,
  });
  renderApp(PATH, language);
  const texts = language === 'ru' ? ru : en;
  await screen.findByRole('heading', { name: texts.setup.years.title });
  if (years.length > 0) {
    await screen.findByRole('table', { name: texts.setup.years.caption });
  }
  return calls;
}

const openYear = async (name: string) => {
  fireEvent.click(screen.getByText(name, { selector: 'button' }));
  return screen.findByRole('complementary', { name });
};

/** The confirmation dialog answered with its action. */
async function goOn(action: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
}

// docs/spec/03-school-setup.md: Academic year ("Start and end date. Status:
// planned, current, closed."; owner: Super Admin) and Quarters ("Four per year,
// each with start and end ... Months are derived from dates."; owner: Academic
// Vice Principal). `edge/academic-year`: "Start year"; an action whose
// prerequisite is missing is switched off and says what is missing. Owner's
// answers 1, 3 and 4 for task 1.3.
describe('the academic years page', () => {
  it('lists the years of the branch, newest first, with dates in the chosen language, status and dated quarters', async () => {
    await openList();

    expect(rowsDrawn()).toEqual([
      ['2027–2028', 'September 2, 2027', 'May 25, 2028', en.setup.years.planned, '0 of 4 dated'],
      ['2026–2027', 'September 2, 2026', 'May 25, 2027', en.setup.years.current, '2 of 4 dated'],
      ['2025–2026', 'September 2, 2025', 'May 25, 2026', en.setup.years.closed, '0 of 4 dated'],
    ]);
  });

  it('names the status and the dated quarters in Russian when Russian is chosen', async () => {
    await openList('super_admin', [CURRENT], {}, 'ru');

    expect(rowsDrawn()[0]?.slice(3)).toEqual([ru.setup.years.current, '2 из 4 с датами']);
  });

  it('adds a year from its two dates', async () => {
    const calls = await openList('super_admin', [CURRENT], {
      'POST /api/setup/academic-years': (body) => json({ ...PLANNED, ...(body as object) }, 201),
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.years.add }));
    const form = await screen.findByRole('form', { name: en.setup.years.newTitle });
    type(within(form).getByLabelText(en.setup.years.startDate), '2027-09-02');
    type(within(form).getByLabelText(en.setup.years.endDate), '2028-05-25');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/setup/academic-years')?.body).toEqual({
        startDate: '2027-09-02',
        endDate: '2028-05-25',
      });
    });
  });

  // Decision 1 of pull request #44.
  it('says what to fix before anything is sent: a year that does not end in the next calendar year', async () => {
    const calls = await openList('super_admin', [CURRENT]);

    fireEvent.click(screen.getByRole('button', { name: en.setup.years.add }));
    const form = await screen.findByRole('form', { name: en.setup.years.newTitle });
    type(within(form).getByLabelText(en.setup.years.startDate), '2027-09-02');
    type(within(form).getByLabelText(en.setup.years.endDate), '2027-12-25');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText(en.setup.years.endYear)).toBeDefined();
    expect(calls.some((call) => call.route === 'POST /api/setup/academic-years')).toBe(false);
  });

  it('starts a planned year after asking, naming the year', async () => {
    const first = {
      ...PLANNED,
      id: uid(4),
      name: '2026–2027',
      startDate: '2026-09-02',
      endDate: '2027-05-25',
    };
    const calls = await openList('super_admin', [first], {
      [`POST /api/setup/academic-years/${first.id}/start`]: () =>
        json({ ...first, status: 'current' }),
    });

    const panel = await openYear('2026–2027');
    fireEvent.click(within(panel).getByRole('button', { name: en.setup.years.start }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(en.setup.years.startTitle.replace('{{name}}', '2026–2027')),
    ).toBeDefined();
    await goOn(en.setup.years.start);

    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/setup/academic-years/${first.id}/start`),
      ).toBe(true);
    });
  });

  // edge/academic-year: "'Start year' ... available only after 'Close the
  // year' was carried out for the previous year"; "An action whose
  // prerequisite is missing is switched off and says what is missing."
  it('switches "Start year" off while another year is current, saying why', async () => {
    await openList();

    const panel = await openYear('2027–2028');

    expect(
      within(panel).getByRole<HTMLButtonElement>('button', { name: en.setup.years.start }).disabled,
    ).toBe(true);
    expect(within(panel).getByText(en.setup.years.startBlockedCurrent)).toBeDefined();
  });

  it('switches "Start year" off while an earlier year is not closed, saying why', async () => {
    await openList('super_admin', [PLANNED, { ...CURRENT, status: 'planned' }]);

    const panel = await openYear('2027–2028');

    expect(
      within(panel).getByRole<HTMLButtonElement>('button', { name: en.setup.years.start }).disabled,
    ).toBe(true);
    expect(within(panel).getByText(en.setup.years.startBlockedEarlier)).toBeDefined();
  });

  it('lets the Academic Vice Principal date the quarters, with the months of each dated quarter shown', async () => {
    const calls = await openList('academic_vice_principal', [CURRENT], {
      [`PUT /api/setup/academic-years/${CURRENT.id}/quarters`]: () => json(CURRENT),
    });

    const panel = await openYear('2026–2027');
    expect(within(panel).queryByRole('form', { name: '2026–2027' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.years.start })).toBeNull();
    const form = within(panel).getByRole('form', { name: en.setup.years.quartersTitle });
    expect(within(form).getByText('September – October')).toBeDefined();
    type(within(form).getByLabelText('Quarter 3: start'), '2027-01-12');
    type(within(form).getByLabelText('Quarter 3: end'), '2027-03-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PUT /api/setup/academic-years/${CURRENT.id}/quarters`)
          ?.body,
      ).toEqual({
        quarters: [
          { startDate: '2026-09-02', endDate: '2026-10-31' },
          { startDate: '2026-11-10', endDate: '2026-12-27' },
          { startDate: '2027-01-12', endDate: '2027-03-20' },
          { startDate: null, endDate: null },
        ],
      });
    });
  });

  it('says what to fix in the quarters before anything is sent, and shows a quarter outside the year beside its field', async () => {
    const calls = await openList('super_admin', [CURRENT], {
      [`PUT /api/setup/academic-years/${CURRENT.id}/quarters`]: () =>
        refusalWith('outside_year', [
          { path: 'quarters.3.endDate', code: 'outside_year', message: 'outside_year' },
        ]),
    });
    const panel = await openYear('2026–2027');
    const form = within(panel).getByRole('form', { name: en.setup.years.quartersTitle });

    type(within(form).getByLabelText('Quarter 3: start'), '2026-12-01');
    type(within(form).getByLabelText('Quarter 3: end'), '2027-03-20');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.setup.years.order)).toBeDefined();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);

    type(within(form).getByLabelText('Quarter 3: start'), '');
    type(within(form).getByLabelText('Quarter 3: end'), '');
    type(within(form).getByLabelText('Quarter 4: start'), '2027-03-30');
    type(within(form).getByLabelText('Quarter 4: end'), '2027-06-01');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect(await within(form).findByText(en.setup.years.outsideYear)).toBeDefined();
    expect(within(form).getByText(en.errors.outside_year)).toBeDefined();
  });

  it('shows the Principal the years and quarters read only, without "Add year"', async () => {
    await openList('principal', [CURRENT]);

    expect(screen.queryByRole('button', { name: en.setup.years.add })).toBeNull();
    const panel = await openYear('2026–2027');
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).getByText('November 10, 2026')).toBeDefined();
    expect(within(panel).getAllByText(en.setup.years.notDated)).toHaveLength(4);
  });

  it('shows a closed year read only, also to the Super Admin', async () => {
    await openList('super_admin', [CLOSED]);

    const panel = await openYear('2025–2026');

    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.setup.years.start })).toBeNull();
  });

  it('says what the page is for when the branch has no year, with the first action', async () => {
    await openList('super_admin', []);

    expect(await screen.findByText(en.setup.years.empty)).toBeDefined();
    expect(screen.getAllByRole('button', { name: en.setup.years.add }).length).toBeGreaterThan(0);
  });
});
