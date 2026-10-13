import { EXPORT_TEXTS, ROOM_EXPORT_COLUMNS, type Building, type Room } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { setWindowWidth } from '@/testing/window-width';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { savedRecordPanel } from '@/testing/new-record';

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

  // Issue #39, hand test of 13 October 2026, finding 14 (task 2.7b-2, decision
  // 3): at a laptop width the list leaves out Building and Floor first.
  it('leaves out Building and Floor below 1280 px', async () => {
    setWindowWidth(1047);
    await openList();
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    expect(rowsDrawn()[0]?.slice(1)).toEqual(['101', 'Classroom', '28', 'In use', 'No']);
    const headers = () =>
      [...document.querySelectorAll('thead th')].map((cell) => cell.textContent ?? '');
    expect(headers()).not.toContain(en.setup.rooms.building);
    expect(headers()).not.toContain(en.setup.rooms.floor);
  });

  it('draws Building and Floor from 1280 px', async () => {
    setWindowWidth(1280);
    await openList();
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    const headers = [...document.querySelectorAll('thead th')].map(
      (cell) => cell.textContent ?? '',
    );
    expect(headers).toContain(en.setup.rooms.building);
    expect(headers).toContain(en.setup.rooms.floor);
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

  // Task 2.7c-2a: the saved room is shown in the side panel.
  it('shows a new room in the side panel once it is saved', async () => {
    await openList();
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: en.setup.rooms.add }).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: en.setup.rooms.add }));
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.rooms.newTitle }),
    ).getByRole('form', { name: en.setup.rooms.newTitle });
    type(field(form, en.setup.rooms.name), '205');
    type(field(form, en.setup.rooms.building), ANNEX.id);
    type(field(form, en.setup.rooms.floor), uid(21));
    type(field(form, en.setup.rooms.capacity), '24');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedRecordPanel(en.setup.rooms.newTitle);
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
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.setup.rooms.newTitle }),
    ).getByRole('form', { name: en.setup.rooms.newTitle });
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

  // Decided by the owner: a room on an archived floor can only be moved.
  it('says where a room on an archived floor is, and asks for an active floor before it can be saved', async () => {
    const attic = room(4, { name: 'A-1', floorId: uid(13), floorName: 'Attic', status: 'closed' });
    await openList(superAdmin(), [...ROOMS, attic]);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(4);
    });

    fireEvent.click(rowButton('A-1'));
    const panel = await screen.findByRole('complementary', { name: 'A-1' });
    const form = within(panel).getByRole('form', { name: 'A-1' });
    expect(
      within(form).getByText(
        en.setup.rooms.onArchivedFloor
          .replace('{{floor}}', 'Attic')
          .replace('{{building}}', 'Main'),
      ),
    ).toBeDefined();
    expect(field(form, en.setup.rooms.building).value).toBe('');
    expect(field(form, en.setup.rooms.floor).value).toBe('');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(field(form, en.setup.rooms.floor).getAttribute('aria-invalid')).toBe('true');
  });

  it('names the rooms whose floor is archived when the status of several is changed, and changes the others', async () => {
    const { calls } = await openList(superAdmin(), ROOMS, [MAIN, ANNEX], {
      [`PUT /api/setup/rooms/${uid(101)}`]: () => refusal('floor_archived', 409),
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });

    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', '101')));
    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', '102')));
    fireEvent.click(screen.getByRole('button', { name: en.setup.rooms.setStatus.closed }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.rooms.setStatus.closed }));

    const expected = `${en.setup.rooms.statusChanged_one.replace('{{n}}', '1')} ${en.setup.rooms.refusedNames.replace('{{names}}', '101')}`;
    await waitFor(() => {
      const statuses = within(screen.getByRole('main')).getAllByRole('status');
      expect(statuses.map((status) => status.textContent)).toContain(expected);
    });
    expect(calls.filter((call) => call.route.startsWith('PUT /api/setup/rooms/'))).toHaveLength(2);
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

/** The headers of the table, without the column of checkboxes. */
const headingsDrawn = (): string[] =>
  [...document.querySelectorAll('thead th')]
    .filter((cell) => cell.querySelector('input') === null)
    .map((cell) => cell.textContent ?? '');

/** An Excel answer of the export route, with the headers the server sends. */
const fileAnswer = (columns: string): Response =>
  new Response(new Blob(['PK']), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rooms-2026-10-10.xlsx"; filename*=UTF-8''${encodeURIComponent('Xonalar-2026-10-10.xlsx')}`,
      'X-Export-Columns': columns,
    },
  });

/** The downloads the page started: the file name of each saved file. */
function downloads(): string[] {
  const names: string[] = [];
  // jsdom makes no object addresses; the test's own URL does, and goes after the test.
  class FileUrl extends URL {
    static override createObjectURL = (): string => 'blob:file';
    static override revokeObjectURL = (): void => undefined;
  }
  vi.stubGlobal('URL', FileUrl);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return names;
}

// Task 2.2c-1: the Export button sends the ids, the columns shown and the
// search and filters; the server makes the file and decides what the role may
// see (edge cases, Personal data and the audit log).
describe('the export of the room list', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the matching rows in the order shown, the columns shown, the search and filters, and saves the file', async () => {
    const saved = downloads();
    const { calls } = await openList(principal(), ROOMS, [MAIN, ANNEX], {
      'POST /api/setup/rooms/export': () =>
        fileAnswer('name,building,floor,type,capacity,status,shared'),
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    expect(headingsDrawn()).toEqual(
      ROOM_EXPORT_COLUMNS.map((key) => EXPORT_TEXTS.en.rooms.columns[key]),
    );
    fireEvent.change(screen.getByLabelText(en.setup.rooms.type), {
      target: { value: 'laboratory' },
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: en.list.export }));

    await waitFor(() => {
      expect(saved).toEqual(['Xonalar-2026-10-10.xlsx']);
    });
    expect(calls.find((call) => call.route === 'POST /api/setup/rooms/export')?.body).toEqual({
      ids: [ROOMS[1]?.id],
      columns: [...ROOM_EXPORT_COLUMNS],
      selection: 'matching',
      search: '',
      filters: { type: 'laboratory' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the columns the server left out, and shows a refusal with its text', async () => {
    downloads();
    let answer = () => fileAnswer('name,building');
    await openList(principal(), ROOMS, [MAIN, ANNEX], {
      'POST /api/setup/rooms/export': () => answer(),
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });

    fireEvent.click(screen.getByRole('button', { name: en.list.export }));

    const left = ROOM_EXPORT_COLUMNS.filter((key) => key !== 'name' && key !== 'building')
      .map((key) => EXPORT_TEXTS.en.rooms.columns[key])
      .join(', ');
    expect(
      await screen.findByText(en.list.exportColumnsLeftOut.replace('{{columns}}', left)),
    ).toBeTruthy();

    answer = () => refusal('permission_denied', 403);
    fireEvent.click(screen.getByRole('button', { name: en.list.export }));
    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.permission_denied);
  });
});
