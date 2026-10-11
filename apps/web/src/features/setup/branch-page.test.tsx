import type { Branch } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const PATH = '/setup/branch';

const BRANCH: Branch = {
  id: NORTH.id,
  name: 'North',
  address: 'Chilonzor, 12',
  phone: null,
  email: null,
  workingWeekdays: [1, 2, 3, 4, 5],
  timeZone: 'Asia/Tashkent',
  goLiveDate: null,
};

const EAST = { id: '0198a000-0000-7000-8000-000000000003', name: 'East' };

const superAdmin = (branches = [NORTH, SOUTH]) =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const form = () => screen.getByRole('form', { name: 'North' });

const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText<HTMLInputElement>(label);

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

// docs/spec/03-school-setup.md, Branch: "Name, address, working weekdays,
// contacts." Owner: Super Admin. `02`: the Principal views and changes
// nothing. `12`, Language: weekdays follow the chosen language.
describe('the branch page', () => {
  it('shows the Super Admin the record of the branch in use as a form, the weekdays as switches Monday first', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branch': () => json(BRANCH),
    });
    renderApp(PATH);
    await screen.findByRole('form', { name: 'North' });

    expect(field(form(), en.setup.branch.name).value).toBe('North');
    expect(field(form(), en.setup.branch.address).value).toBe('Chilonzor, 12');
    expect(field(form(), en.setup.branch.phone).value).toBe('');
    const days = within(form()).getByRole('group', { name: en.setup.branch.workingWeekdays });
    const boxes = within(days).getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes.map((box) => box.value)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(within(days).getByLabelText<HTMLInputElement>('Monday').checked).toBe(true);
    expect(within(days).getByLabelText<HTMLInputElement>('Friday').checked).toBe(true);
    expect(within(days).getByLabelText<HTMLInputElement>('Saturday').checked).toBe(false);
    expect(within(days).getByLabelText<HTMLInputElement>('Sunday').checked).toBe(false);
    expect(screen.getByRole('button', { name: en.setup.branch.newBranch })).toBeDefined();
  });

  it('saves the typed record with the ticked weekdays, says "Saved" and reads the session again for the switcher', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branch': () => json(BRANCH),
      'PUT /api/setup/branch': (body) =>
        json({ ...BRANCH, ...(body as object), workingWeekdays: [1, 2, 3, 4, 5, 6] }),
    });
    renderApp(PATH);
    await screen.findByRole('form', { name: 'North' });
    const sessionsBefore = calls.filter((call) => call.route === 'GET /api/auth/session').length;

    type(field(form(), en.setup.branch.address), 'Chilonzor, 13');
    fireEvent.click(within(form()).getByLabelText('Saturday'));
    fireEvent.click(within(form()).getByRole('button', { name: en.form.save }));

    await within(form()).findByText(en.form.saved);
    const put = calls.find((call) => call.route === 'PUT /api/setup/branch');
    expect(put?.body).toEqual({
      name: 'North',
      address: 'Chilonzor, 13',
      phone: null,
      email: null,
      workingWeekdays: [1, 2, 3, 4, 5, 6],
    });
    expect(calls.filter((call) => call.route === 'GET /api/auth/session').length).toBe(
      sessionsBefore + 1,
    );
  });

  it('says what to fix before anything is sent: no weekday, a text that is not an email', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branch': () => json(BRANCH),
    });
    renderApp(PATH);
    await screen.findByRole('form', { name: 'North' });

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      fireEvent.click(within(form()).getByLabelText(day));
    }
    type(field(form(), en.setup.branch.email), 'north');
    fireEvent.click(within(form()).getByRole('button', { name: en.form.save }));

    const days = within(form()).getByRole('group', { name: en.setup.branch.workingWeekdays });
    expect(within(days).getByText(en.form.required)).toBeDefined();
    expect(field(form(), en.setup.branch.email).getAttribute('aria-invalid')).toBe('true');
    expect(calls.some((call) => call.route === 'PUT /api/setup/branch')).toBe(false);
  });

  it('shows a refused save as its text and keeps what was typed', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branch': () => json(BRANCH),
      'PUT /api/setup/branch': () => refusal('already_exists', 409),
    });
    renderApp(PATH);
    await screen.findByRole('form', { name: 'North' });

    type(field(form(), en.setup.branch.name), 'South');
    fireEvent.click(within(form()).getByRole('button', { name: en.form.save }));

    expect((await within(form()).findByRole('alert')).textContent).toBe(en.errors.already_exists);
    expect(field(form(), en.setup.branch.name).value).toBe('South');
  });

  it('shows the Principal the record read only, with the weekdays by name, and no way to add a branch', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(principal()),
      'GET /api/setup/branch': () => json({ ...BRANCH, phone: '+998 71 000 00 00' }),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.setup.branch.title });

    expect(await screen.findByText('Monday, Tuesday, Wednesday, Thursday, Friday')).toBeDefined();
    expect(screen.getByText('+998 71 000 00 00')).toBeDefined();
    expect(screen.getByText(en.setup.branch.notGiven)).toBeDefined();
    expect(screen.getByText('Asia/Tashkent')).toBeDefined();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button', { name: en.form.save })).toBeNull();
    expect(screen.queryByRole('button', { name: en.setup.branch.newBranch })).toBeNull();
  });

  it('names the weekdays in the chosen language', async () => {
    fakeApi({
      'GET /api/auth/session': () => json({ ...principal(), language: 'ru' }),
      'GET /api/setup/branch': () => json(BRANCH),
    });
    renderApp(PATH, 'ru');
    await screen.findByRole('heading', { name: ru.setup.branch.title });

    expect(await screen.findByText('Понедельник, Вторник, Среда, Четверг, Пятница')).toBeDefined();
  });

  // Task 1.1, done when: "the Super Admin can create ... them".
  it('creates a branch from an empty form, then shows it in the switcher and switches this tab to it', async () => {
    let branches = [NORTH, SOUTH];
    const calls = fakeApi({
      'GET /api/auth/session': () => json(superAdmin(branches)),
      'GET /api/setup/branch': () => json(BRANCH),
      'POST /api/setup/branches': (body) => {
        branches = [...branches, EAST];
        return json({ id: EAST.id, ...(body as object), timeZone: 'Asia/Tashkent' }, 201);
      },
    });
    renderApp(PATH);
    await screen.findByRole('form', { name: 'North' });

    fireEvent.click(screen.getByRole('button', { name: en.setup.branch.newBranch }));
    const section = screen.getByRole('region', { name: en.setup.branch.newBranchTitle });
    const added = within(section).getByRole('form', { name: en.setup.branch.newBranchTitle });
    expect(field(added, en.setup.branch.name).value).toBe('');
    expect(within(added).getByLabelText<HTMLInputElement>('Friday').checked).toBe(true);
    expect(within(added).getByLabelText<HTMLInputElement>('Saturday').checked).toBe(false);

    type(field(added, en.setup.branch.name), 'East');
    fireEvent.click(within(added).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: en.setup.branch.newBranchTitle })).toBeNull();
    });
    const post = calls.find((call) => call.route === 'POST /api/setup/branches');
    expect(post?.body).toEqual({
      name: 'East',
      address: null,
      phone: null,
      email: null,
      workingWeekdays: [1, 2, 3, 4, 5],
    });
    const switcher = screen.getByRole<HTMLSelectElement>('combobox', { name: en.switcher.branch });
    expect([...switcher.options].map((option) => option.textContent)).toEqual([
      'North',
      'South',
      'East',
    ]);
    expect(switcher.value).toBe(EAST.id);
  });

  it('asks before the new-branch form is closed with something typed', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branch': () => json(BRANCH),
    });
    renderApp(PATH);
    await screen.findByRole('form', { name: 'North' });
    fireEvent.click(screen.getByRole('button', { name: en.setup.branch.newBranch }));
    const added = screen.getByRole('form', { name: en.setup.branch.newBranchTitle });
    type(field(added, en.setup.branch.name), 'Ea');

    fireEvent.click(screen.getByRole('button', { name: en.setup.branch.cancel }));

    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.getByRole('form', { name: en.setup.branch.newBranchTitle })).toBeDefined();
  });

  it('shows the failure of the load with a way to try again', async () => {
    let failures = 1;
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branch': () => {
        if (failures > 0) {
          failures -= 1;
          return refusal('internal_error', 500);
        }
        return json(BRANCH);
      },
    });
    renderApp(PATH);

    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.internal_error);
    fireEvent.click(screen.getByRole('button', { name: en.problems.retry }));

    await screen.findByRole('form', { name: 'North' });
  });

  // edge/academic-year, "The school goes live in the middle of the year": "The
  // Super Admin sets a start date for each branch"; owner's answer 7: inside a
  // planned or current year. Task 1.3.
  describe('the go-live date', () => {
    const YEAR = {
      id: '0199a000-0000-7000-8000-000000000301',
      name: '2026–2027',
      startDate: '2026-09-02',
      endDate: '2027-05-25',
      status: 'planned',
      quarters: [1, 2, 3, 4].map((number) => ({ number, startDate: null, endDate: null })),
    };
    const goLive = () => screen.getByRole('form', { name: en.setup.branch.goLiveTitle });

    it('is set by the Super Admin inside a year of the branch', async () => {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(superAdmin()),
        'GET /api/setup/branch': () => json(BRANCH),
        'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
        'PUT /api/setup/branch/go-live': (body) => json({ ...BRANCH, ...(body as object) }),
      });
      renderApp(PATH);
      await screen.findByRole('form', { name: en.setup.branch.goLiveTitle });

      type(field(goLive(), en.setup.branch.goLiveDate), '2026-11-10');
      fireEvent.click(within(goLive()).getByRole('button', { name: en.form.save }));

      await waitFor(() => {
        expect(calls.find((call) => call.route === 'PUT /api/setup/branch/go-live')?.body).toEqual({
          goLiveDate: '2026-11-10',
        });
      });
    });

    it('shows its refusal as its text', async () => {
      fakeApi({
        'GET /api/auth/session': () => json(superAdmin()),
        'GET /api/setup/branch': () => json(BRANCH),
        'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
        'PUT /api/setup/branch/go-live': () => refusal('go_live_outside_year', 409),
      });
      renderApp(PATH);
      await screen.findByRole('form', { name: en.setup.branch.goLiveTitle });

      type(field(goLive(), en.setup.branch.goLiveDate), '2027-07-01');
      fireEvent.click(within(goLive()).getByRole('button', { name: en.form.save }));

      expect(await within(goLive()).findByText(en.errors.go_live_outside_year)).toBeDefined();
    });

    // edge/academic-year: "An action whose prerequisite is missing is switched off and says what is missing."
    it('is switched off, saying what is missing, while the branch has no planned or current year', async () => {
      fakeApi({
        'GET /api/auth/session': () => json(superAdmin()),
        'GET /api/setup/branch': () => json(BRANCH),
        'GET /api/setup/academic-years': () => json({ years: [{ ...YEAR, status: 'closed' }] }),
      });
      renderApp(PATH);

      expect(await screen.findByText(en.setup.branch.goLiveNoYear)).toBeDefined();
      expect(screen.queryByRole('form', { name: en.setup.branch.goLiveTitle })).toBeNull();
      expect(screen.getByText(en.setup.branch.goLiveNotSet)).toBeDefined();
    });

    it('is read by the Principal as a date in the chosen language', async () => {
      fakeApi({
        'GET /api/auth/session': () => json(principal()),
        'GET /api/setup/branch': () => json({ ...BRANCH, goLiveDate: '2026-11-10' }),
      });
      renderApp(PATH);

      expect(await screen.findByText('November 10, 2026')).toBeDefined();
      expect(screen.queryByRole('form', { name: en.setup.branch.goLiveTitle })).toBeNull();
    });
  });
});
