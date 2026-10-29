import type { Branch, BranchListItem } from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const PATH = '/setup/branches';

// All names are invented.
const EAST = { id: '0198a000-0000-7000-8000-000000000003', name: 'East' };

const LISTED: BranchListItem[] = [
  {
    id: NORTH.id,
    name: 'North',
    address: 'Chilonzor, 12',
    workingWeekdays: [1, 2, 3, 4, 5],
    buildingCount: 2,
    roomCount: 31,
    monitoring: false,
  },
  {
    id: SOUTH.id,
    name: 'South',
    address: null,
    workingWeekdays: [1, 2, 3, 4, 5, 6],
    buildingCount: 0,
    roomCount: 0,
    monitoring: false,
  },
];

const branchOf = (id: string, name: string): Branch => ({
  id,
  name,
  address: null,
  phone: null,
  email: null,
  workingWeekdays: [1, 2, 3, 4, 5],
  timeZone: 'Asia/Tashkent',
  goLiveDate: null,
});

const superAdmin = (branches = [NORTH, SOUTH]) =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText<HTMLInputElement>(label);

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

const switcher = () =>
  screen.getByRole<HTMLSelectElement>('combobox', { name: en.switcher.branch });

// docs/spec/03-school-setup.md, Branch: "The Super Admin sees every branch in
// one list under School setup: name, address, working weekdays, number of
// buildings and of rooms. Opening a branch switches the current branch to it.
// A new branch is added from this list, in the side panel. The list needs no
// new permission"; issue #39, item 1; task 2.7c-3.
describe('the Branches list', () => {
  it('shows the Super Admin every branch with its five columns', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branches': () => json({ branches: LISTED }),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.setup.branches.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(
      [...document.querySelectorAll('thead th')].map((cell) => cell.textContent ?? ''),
    ).toEqual(
      expect.arrayContaining([
        en.setup.branches.name,
        en.setup.branches.address,
        en.setup.branches.weekdays,
        en.setup.branches.buildings,
        en.setup.branches.rooms,
      ]),
    );
    expect(rowsDrawn()).toEqual([
      ['North', 'Chilonzor, 12', 'Monday, Tuesday, Wednesday, Thursday, Friday', '2', '31'],
      ['South', '', 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday', '0', '0'],
    ]);
  });

  // Task 10.2b (answer 10): the hidden Monitoring branch is marked in the Super Admin's list.
  it('marks the hidden Monitoring branch and no other', async () => {
    const monitoring: BranchListItem = {
      id: EAST.id,
      name: 'Monitoring',
      address: null,
      workingWeekdays: [1, 2, 3, 4, 5, 6, 7],
      buildingCount: 1,
      roomCount: 1,
      monitoring: true,
    };
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branches': () => json({ branches: [...LISTED, monitoring] }),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    const names = rowsDrawn().map((row) => row[0]);
    expect(names).toEqual(['North', 'South', `Monitoring (${en.setup.branches.monitoring})`]);
  });

  it('switches the current branch to the branch opened and shows its Branch page', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branches': () => json({ branches: LISTED }),
      'GET /api/setup/branch': () => json(branchOf(SOUTH.id, 'South')),
    });
    const { router } = renderApp(PATH);
    await screen.findByRole('heading', { name: en.setup.branches.title });
    expect(switcher().value).toBe(NORTH.id);

    fireEvent.click(await screen.findByRole('button', { name: 'South' }));

    await screen.findByRole('heading', { name: en.setup.branch.title });
    expect(router.state.location.pathname).toBe('/setup/branch');
    expect(switcher().value).toBe(SOUTH.id);
    await screen.findByRole('form', { name: 'South' });
  });

  // Task 1.1, done when: "the Super Admin can create ... them"; moved here
  // from the Branch page with the same assertions (task 2.7c-3, decision 1).
  it('creates a branch from an empty form in the side panel, then shows it in the switcher and switches this tab to it', async () => {
    let branches = [NORTH, SOUTH];
    const calls = fakeApi({
      'GET /api/auth/session': () => json(superAdmin(branches)),
      'GET /api/setup/branches': () => json({ branches: LISTED }),
      'GET /api/setup/branch': () => json(branchOf(EAST.id, 'East')),
      'POST /api/setup/branches': (body) => {
        branches = [...branches, EAST];
        return json({ id: EAST.id, ...(body as object), timeZone: 'Asia/Tashkent' }, 201);
      },
    });
    const { router } = renderApp(PATH);
    await screen.findByRole('heading', { name: en.setup.branches.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.branch.newBranch }));
    const panel = await screen.findByRole('complementary', {
      name: en.setup.branch.newBranchTitle,
    });
    const added = within(panel).getByRole('form', { name: en.setup.branch.newBranchTitle });
    // Its Save is the only primary of the panel.
    expect(
      within(panel)
        .getAllByRole('button')
        .filter((button) => button.className.includes('bg-primary ')),
    ).toHaveLength(1);
    expect(field(added, en.setup.branch.name).value).toBe('');
    expect(within(added).getByLabelText<HTMLInputElement>('Friday').checked).toBe(true);
    expect(within(added).getByLabelText<HTMLInputElement>('Saturday').checked).toBe(false);

    type(field(added, en.setup.branch.name), 'East');
    fireEvent.click(within(added).getByRole('button', { name: en.form.save }));

    await screen.findByRole('heading', { name: en.setup.branch.title });
    expect(router.state.location.pathname).toBe('/setup/branch');
    expect(
      screen.queryByRole('complementary', { name: en.setup.branch.newBranchTitle }),
    ).toBeNull();
    const post = calls.find((call) => call.route === 'POST /api/setup/branches');
    expect(post?.body).toEqual({
      name: 'East',
      address: null,
      phone: null,
      email: null,
      workingWeekdays: [1, 2, 3, 4, 5],
    });
    await waitFor(() => {
      expect([...switcher().options].map((option) => option.textContent)).toEqual([
        'North',
        'South',
        'East',
      ]);
    });
    expect(switcher().value).toBe(EAST.id);
  });

  it('closes the new-branch form with Cancel without a call, and asks first when something is typed', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branches': () => json({ branches: LISTED }),
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.setup.branches.title });

    fireEvent.click(await screen.findByRole('button', { name: en.setup.branch.newBranch }));
    await screen.findByRole('form', { name: en.setup.branch.newBranchTitle });
    fireEvent.click(screen.getByRole('button', { name: en.setup.branch.cancel }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: en.setup.branch.newBranchTitle }),
      ).toBeNull();
    });

    fireEvent.click(await screen.findByRole('button', { name: en.setup.branch.newBranch }));
    const added = await screen.findByRole('form', { name: en.setup.branch.newBranchTitle });
    type(field(added, en.setup.branch.name), 'Ea');
    fireEvent.click(screen.getByRole('button', { name: en.setup.branch.cancel }));
    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.getByRole('form', { name: en.setup.branch.newBranchTitle })).toBeDefined();

    // The close button of the side panel asks the same, and closes it on "Leave".
    fireEvent.click(screen.getByRole('button', { name: en.list.closePanel }));
    const again = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    fireEvent.click(within(again).getByRole('button', { name: en.unsent.leave }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: en.setup.branch.newBranchTitle }),
      ).toBeNull();
    });
    expect(calls.some((call) => call.route === 'POST /api/setup/branches')).toBe(false);
  });

  it('offers "New branch" on the empty list, before the first branch exists', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin([])),
      'GET /api/setup/branches': () => json({ branches: [] }),
    });
    renderApp(PATH);
    const title = await screen.findByText(en.setup.branches.emptyTitle);
    // The empty state's own action, besides the one in the page header.
    const empty = title.closest('div.grid') as HTMLElement;
    expect(within(empty).getByRole('button', { name: en.setup.branch.newBranch })).toBeDefined();
  });

  it('shows the failure of the load with a way to try again', async () => {
    let failures = 1;
    fakeApi({
      'GET /api/auth/session': () => json(superAdmin()),
      'GET /api/setup/branches': () => {
        if (failures > 0) {
          failures -= 1;
          return refusal('internal_error', 500);
        }
        return json({ branches: LISTED });
      },
    });
    renderApp(PATH);
    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.internal_error);
    fireEvent.click(screen.getByRole('button', { name: en.problems.retry }));
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
  });

  it('is not for the Principal or the Academic Vice Principal, who view their own branch', async () => {
    for (const role of ['principal', 'academic_vice_principal'] as const) {
      const calls = fakeApi({
        'GET /api/auth/session': () =>
          json(sessionOf({ assignments: [{ role, branchId: NORTH.id }], branches: [NORTH] })),
      });
      renderApp(PATH);
      await screen.findByRole('heading', { name: en.problems.noAccessTitle });
      expect(calls.some((call) => call.route === 'GET /api/setup/branches')).toBe(false);
      cleanup();
    }
  });
});
