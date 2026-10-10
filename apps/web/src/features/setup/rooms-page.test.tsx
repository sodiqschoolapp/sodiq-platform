import type { Building, Room } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const PATH = '/setup/rooms';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const MAIN: Building = {
  id: uid(1),
  name: 'Main',
  archivedAt: null,
  floors: [
    { id: uid(11), name: 'Ground', archivedAt: null, roomCount: 2 },
    { id: uid(12), name: '1', archivedAt: null, roomCount: 1 },
    { id: uid(13), name: 'Attic', archivedAt: '2026-10-09T04:00:00.000Z', roomCount: 0 },
  ],
};

const ANNEX: Building = {
  id: uid(2),
  name: 'Annex',
  archivedAt: null,
  floors: [{ id: uid(21), name: 'Ground', archivedAt: null, roomCount: 0 }],
};

const room = (n: number, fields: Partial<Room>): Room => ({
  id: uid(100 + n),
  name: String(100 + n),
  floorId: uid(11),
  floorName: 'Ground',
  buildingId: MAIN.id,
  buildingName: 'Main',
  type: 'classroom',
  capacity: 28,
  status: 'in_use',
  shared: false,
  maxSimultaneousLessons: null,
  ...fields,
});

const ROOMS: Room[] = [
  room(1, {}),
  room(2, { type: 'laboratory', status: 'under_repair', floorId: uid(12), floorName: '1' }),
  room(3, {
    name: 'Sports hall',
    type: 'sports_hall',
    capacity: 120,
    shared: true,
    maxSimultaneousLessons: 2,
    status: 'closed',
  }),
];

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

const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText<HTMLInputElement | HTMLSelectElement>(label);

async function openList(
  session = superAdmin(),
  rooms = ROOMS,
  buildings = [MAIN, ANNEX],
  refuse?: Record<string, () => Response>,
) {
  let list = rooms;
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session),
    'GET /api/setup/rooms': () => json({ rooms: list }),
    'GET /api/setup/buildings': () => json({ buildings }),
    'POST /api/setup/rooms': (body) => {
      const created = room(9, body as Partial<Room>);
      list = [...list, created];
      return json(created, 201);
    },
    ...Object.fromEntries(
      rooms.map((one) => [
        `PUT /api/setup/rooms/${one.id}`,
        (body: unknown) => {
          const saved = { ...one, ...(body as object) };
          list = list.map((item) => (item.id === one.id ? saved : item));
          return json(saved);
        },
      ]),
    ),
    ...refuse,
  });
  const shell = renderApp(PATH);
  await screen.findByRole('heading', { name: en.setup.rooms.title });
  return { ...shell, calls };
}

// docs/spec/03-school-setup.md, Building, floor, room: "Room: name or number,
// floor, type, capacity, status"; docs/spec/edge-cases/timetable.md,
// Structure: the "shared" switch and the number of lessons at once. `12`,
// Lists: one pattern everywhere.
describe('the room list', () => {
  it('lists the rooms with their building, floor, type, capacity, status and the shared count', async () => {
    await openList();

    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    expect(rowsDrawn().map((row) => row.slice(1))).toEqual([
      ['101', 'Main', 'Ground', 'Classroom', '28', 'In use', 'No'],
      ['102', 'Main', '1', 'Laboratory', '28', 'Under repair', 'No'],
      ['Sports hall', 'Main', 'Ground', 'Sports hall', '120', 'Closed', '2 lessons at once'],
    ]);
  });

  it('filters by status and by floor', async () => {
    await openList();
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });

    fireEvent.change(screen.getByRole('combobox', { name: en.setup.rooms.status }), {
      target: { value: 'closed' },
    });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['Sports hall']);
    });

    fireEvent.change(screen.getByRole('combobox', { name: en.setup.rooms.status }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: en.setup.rooms.floor }), {
      target: { value: uid(12) },
    });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[1])).toEqual(['102']);
    });
  });

  it('opens a room in the side panel with its record, asks the number of lessons only for a shared room, and saves', async () => {
    const { calls } = await openList();
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });

    fireEvent.click(rowButton('101'));
    const panel = await screen.findByRole('complementary', { name: '101' });
    const form = within(panel).getByRole('form', { name: '101' });
    expect(field(form, en.setup.rooms.name).value).toBe('101');
    expect(field(form, en.setup.rooms.building).value).toBe(MAIN.id);
    expect(field(form, en.setup.rooms.floor).value).toBe(uid(11));
    // Only active floors of the chosen building are offered.
    expect(
      [...(field(form, en.setup.rooms.floor) as HTMLSelectElement).options].map(
        (option) => option.textContent,
      ),
    ).toEqual([en.setup.rooms.chooseFloor, 'Ground', '1']);
    expect(field(form, en.setup.rooms.capacity).value).toBe('28');
    expect(within(form).queryByLabelText(en.setup.rooms.maxLessons)).toBeNull();

    fireEvent.click(field(form, en.setup.rooms.sharedSwitch));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const lessons = field(form, en.setup.rooms.maxLessons);
    expect(lessons.getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByText(en.form.required)).toBeDefined();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);

    type(lessons, '3');
    type(field(form, en.setup.rooms.capacity), '60');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await within(form).findByText(en.form.saved);
    expect(calls.find((call) => call.route === `PUT /api/setup/rooms/${uid(101)}`)?.body).toEqual({
      name: '101',
      floorId: uid(11),
      type: 'classroom',
      capacity: 60,
      status: 'in_use',
      shared: true,
      maxSimultaneousLessons: 3,
    });
  });

  it('offers the floors of the building chosen, and starts the floor over when the building changes', async () => {
    await openList();
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    fireEvent.click(rowButton('101'));
    const panel = await screen.findByRole('complementary', { name: '101' });
    const form = within(panel).getByRole('form', { name: '101' });

    type(field(form, en.setup.rooms.building), ANNEX.id);

    expect(field(form, en.setup.rooms.floor).value).toBe('');
    expect(
      [...(field(form, en.setup.rooms.floor) as HTMLSelectElement).options].map(
        (option) => option.textContent,
      ),
    ).toEqual([en.setup.rooms.chooseFloor, 'Ground']);
  });

  it('adds a room from the header, and shows a refused name as its text', async () => {
    const { calls } = await openList(superAdmin(), ROOMS, [MAIN, ANNEX], {
      'POST /api/setup/rooms': () => refusal('already_exists', 409),
    });
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: en.setup.rooms.add }).disabled,
      ).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: en.setup.rooms.add }));
    const form = screen.getByRole('form', { name: en.setup.rooms.newTitle });
    type(field(form, en.setup.rooms.name), '101');
    type(field(form, en.setup.rooms.building), ANNEX.id);
    type(field(form, en.setup.rooms.floor), uid(21));
    type(field(form, en.setup.rooms.capacity), '24');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    expect((await within(form).findByRole('alert')).textContent).toBe(en.errors.already_exists);
    expect(calls.find((call) => call.route === 'POST /api/setup/rooms')?.body).toEqual({
      name: '101',
      floorId: uid(21),
      type: 'classroom',
      capacity: 24,
      status: 'in_use',
      shared: false,
      maxSimultaneousLessons: null,
    });
  });

  // `edge/academic-year`: "An action whose prerequisite is missing is switched off and says what is missing."
  it('switches "Add room" off while the branch has no active floor, says why, and the empty list leads to the buildings', async () => {
    await openList(superAdmin(), [], [{ ...MAIN, archivedAt: '2026-10-09T04:00:00.000Z' }]);

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: en.setup.rooms.add }).disabled,
      ).toBe(true);
    });
    expect(screen.getByText(en.setup.rooms.needFloor)).toBeDefined();
    expect(screen.getByText(en.setup.rooms.emptyNoFloor)).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.setup.rooms.goToBuildings }).getAttribute('href'),
    ).toBe('/setup/buildings');
  });

  it('changes the status of the ticked rooms at once after asking, skipping those already in it', async () => {
    const { calls } = await openList();
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });

    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', '101')));
    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', 'Sports hall')));
    fireEvent.click(screen.getByRole('button', { name: en.setup.rooms.setStatus.closed }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(en.setup.rooms.setStatusTitle_other.replace('{{n}}', '2')),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.rooms.setStatus.closed }));

    await screen.findByText(en.setup.rooms.statusChanged_one.replace('{{n}}', '1'));
    const puts = calls.filter((call) => call.route.startsWith('PUT /api/setup/rooms/'));
    expect(puts).toHaveLength(1);
    expect(puts[0]?.route).toBe(`PUT /api/setup/rooms/${uid(101)}`);
    expect(puts[0]?.body).toMatchObject({ status: 'closed', name: '101' });
    await waitFor(() => {
      expect(rowsDrawn()[0]?.[6]).toBe('Closed');
    });
  });

  it('shows the Principal the rooms read only: no adding, no checkboxes, the record as a list', async () => {
    await openList(principal());
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });

    expect(screen.queryByRole('button', { name: en.setup.rooms.add })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(rowButton('Sports hall'));
    const panel = await screen.findByRole('complementary', { name: 'Sports hall' });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).getByText('2 lessons at once')).toBeDefined();
  });
});
