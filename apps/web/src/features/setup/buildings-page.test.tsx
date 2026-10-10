import type { Building } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const PATH = '/setup/buildings';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ARCHIVED_AT = '2026-10-09T04:00:00.000Z';

const MAIN: Building = {
  id: uid(1),
  name: 'Main',
  archivedAt: null,
  floors: [
    { id: uid(11), name: 'Ground', archivedAt: null, roomCount: 2 },
    { id: uid(12), name: '1', archivedAt: null, roomCount: 1 },
    { id: uid(13), name: 'Attic', archivedAt: ARCHIVED_AT, roomCount: 0 },
  ],
};

const ANNEX: Building = { id: uid(2), name: 'Annex', archivedAt: ARCHIVED_AT, floors: [] };

const superAdmin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const rowButton = (name: string) => screen.getByText(name, { selector: 'button' });

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openList(session = superAdmin(), buildings = [MAIN, ANNEX]) {
  let list = buildings;
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session),
    'GET /api/setup/buildings': () => json({ buildings: list }),
    'POST /api/setup/buildings': (body) => {
      const created: Building = {
        id: uid(3),
        ...(body as { name: string }),
        archivedAt: null,
        floors: [],
      };
      list = [...list, created];
      return json(created, 201);
    },
    [`PUT /api/setup/buildings/${MAIN.id}`]: (body) => json({ ...MAIN, ...(body as object) }),
    [`POST /api/setup/buildings/${MAIN.id}/archive`]: () => refusal('archive_refused', 409),
    [`POST /api/setup/buildings/${ANNEX.id}/archive`]: () => json(ANNEX),
    [`POST /api/setup/buildings/${ANNEX.id}/restore`]: () => json({ ...ANNEX, archivedAt: null }),
    [`POST /api/setup/buildings/${MAIN.id}/floors`]: (body) =>
      json({ id: uid(14), ...(body as { name: string }), archivedAt: null, roomCount: 0 }, 201),
    [`POST /api/setup/floors/${uid(12)}/archive`]: () =>
      json({ id: uid(12), name: '1', archivedAt: ARCHIVED_AT, roomCount: 1 }),
    [`POST /api/setup/floors/${uid(13)}/restore`]: () =>
      json({ id: uid(13), name: 'Attic', archivedAt: null, roomCount: 0 }),
    [`PUT /api/setup/floors/${uid(11)}`]: (body) =>
      json({ id: uid(11), ...(body as { name: string }), archivedAt: null, roomCount: 2 }),
  });
  const shell = renderApp(PATH);
  await screen.findByRole('heading', { name: en.setup.buildings.title });
  if (buildings.length > 0) {
    await screen.findByRole('table', { name: en.setup.buildings.caption });
  }
  return { ...shell, calls };
}

/** The confirmation dialog answered with its action. */
async function goOn(action: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
}

// docs/spec/03-school-setup.md, Building, floor, room: "Rooms are added floor
// by floor." `12`, Lists: one list pattern. Archive and restore as decided by
// the owner (pull request #37, answer 7).
describe('the buildings page', () => {
  it('lists the buildings with their active floors, rooms and status', async () => {
    await openList();

    expect(rowsDrawn().map((row) => row.slice(1))).toEqual([
      ['Main', '2', '3', en.setup.buildings.active],
      ['Annex', '0', '0', en.setup.buildings.archived],
    ]);
  });

  it('opens a building in the side panel with its rename form and its floors, and renames it', async () => {
    const { calls } = await openList();

    fireEvent.click(rowButton('Main'));

    const panel = await screen.findByRole('complementary', { name: 'Main' });
    const floors = within(panel).getAllByRole('row').slice(1);
    expect(floors.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ground'),
      expect.stringContaining('1'),
      expect.stringContaining('Attic'),
    ]);
    expect(floors[2]?.textContent).toContain(en.setup.buildings.archived);
    const form = within(panel).getByRole('form', { name: 'Main' });
    type(within(form).getByLabelText(en.setup.buildings.name), 'Main building');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await within(form).findByText(en.form.saved);
    expect(
      calls.find((call) => call.route === `PUT /api/setup/buildings/${MAIN.id}`)?.body,
    ).toEqual({ name: 'Main building' });
  });

  it('adds a floor to the open building and renames a floor', async () => {
    const { calls } = await openList();
    fireEvent.click(rowButton('Main'));
    const panel = await screen.findByRole('complementary', { name: 'Main' });

    const added = within(panel).getByRole('form', { name: en.setup.buildings.newFloor });
    type(within(added).getByLabelText(en.setup.buildings.floorName), '2');
    fireEvent.click(within(added).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/setup/buildings/${MAIN.id}/floors`)?.body,
      ).toEqual({ name: '2' });
    });

    fireEvent.click(
      within(panel).getByRole('button', {
        name: en.setup.buildings.renameNamed.replace('{{name}}', 'Ground'),
      }),
    );
    const rename = within(panel).getByRole('form', { name: 'Ground' });
    type(within(rename).getByLabelText(en.setup.buildings.floorName), 'G');
    fireEvent.click(within(rename).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(calls.find((call) => call.route === `PUT /api/setup/floors/${uid(11)}`)?.body).toEqual(
        { name: 'G' },
      );
    });
  });

  it('archives and restores a floor after asking, and shows a refused archive of the building as its text', async () => {
    const { calls } = await openList();
    fireEvent.click(rowButton('Main'));
    const panel = await screen.findByRole('complementary', { name: 'Main' });

    fireEvent.click(
      within(panel).getByRole('button', {
        name: en.setup.buildings.archiveNamed.replace('{{name}}', '1'),
      }),
    );
    await goOn(en.setup.buildings.archive);
    await waitFor(() => {
      expect(calls.some((call) => call.route === `POST /api/setup/floors/${uid(12)}/archive`)).toBe(
        true,
      );
    });

    fireEvent.click(
      within(panel).getByRole('button', {
        name: en.setup.buildings.restoreNamed.replace('{{name}}', 'Attic'),
      }),
    );
    await goOn(en.setup.buildings.restore);
    await waitFor(() => {
      expect(calls.some((call) => call.route === `POST /api/setup/floors/${uid(13)}/restore`)).toBe(
        true,
      );
    });

    fireEvent.click(
      within(panel).getByRole('button', { name: en.setup.buildings.archiveBuilding }),
    );
    await goOn(en.setup.buildings.archive);
    expect((await within(panel).findByRole('alert')).textContent).toBe(en.errors.archive_refused);
  });

  it('adds a building from the header and lists it', async () => {
    const { calls } = await openList();

    fireEvent.click(screen.getByRole('button', { name: en.setup.buildings.add }));
    const form = screen.getByRole('form', { name: en.setup.buildings.newTitle });
    type(within(form).getByLabelText(en.setup.buildings.name), 'Sports block');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: en.setup.buildings.newTitle })).toBeNull();
    });
    expect(calls.find((call) => call.route === 'POST /api/setup/buildings')?.body).toEqual({
      name: 'Sports block',
    });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['Main', 'Annex', 'Sports block']);
    });
  });

  it('archives and restores several buildings at once after asking, and names the refused ones', async () => {
    const { calls } = await openList();

    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', 'Main')));
    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', 'Annex')));
    fireEvent.click(screen.getByRole('button', { name: en.setup.buildings.archive }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(en.setup.buildings.archiveTitle_other.replace('{{n}}', '2')),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.buildings.archive }));

    const expected = `${en.setup.buildings.archived_done_one.replace('{{n}}', '1')} ${en.setup.buildings.refusedNames.replace('{{names}}', 'Main')}`;
    await waitFor(() => {
      const statuses = within(screen.getByRole('main')).getAllByRole('status');
      expect(statuses.map((status) => status.textContent)).toContain(expected);
    });
    // The archived one is sent too: the server answers for each.
    expect(calls.filter((call) => call.route.endsWith('/archive'))).toHaveLength(2);
    expect(
      calls.some((call) => call.route === `POST /api/setup/buildings/${MAIN.id}/archive`),
    ).toBe(true);
  });

  it('filters by status', async () => {
    await openList();

    fireEvent.change(screen.getByRole('combobox', { name: en.setup.buildings.status }), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['Annex']);
    });
  });

  it('shows the Principal the list and the floors without any way to change them', async () => {
    await openList(principal());

    expect(screen.queryByRole('button', { name: en.setup.buildings.add })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(rowButton('Main'));
    const panel = await screen.findByRole('complementary', { name: 'Main' });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en.setup.buildings.archiveBuilding }),
    ).toBeNull();
    expect(within(panel).getAllByRole('row')).toHaveLength(4);
  });

  it('says what the page is for when there is no building, and offers the first action', async () => {
    await openList(superAdmin(), []);

    expect(await screen.findByText(en.setup.buildings.empty)).toBeDefined();
    // In the header and as the first action of the empty page.
    expect(screen.getAllByRole('button', { name: en.setup.buildings.add })).toHaveLength(2);
  });
});
