import type { Room, RoomClosure, RoomClosureLessons } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.7a-2b, pull request #187: the closures of
// the branch's rooms (edge/timetable, After publishing: "A room closure has a
// start, an end and a reason. Lessons in the range go to 'needs a room', with
// 'move all to room R for the period'.").
const texts = en.timetable.roomClosures;
const PATH = '/timetable/room-closures';

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });
const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const room = (n: number, name: string, status: Room['status'] = 'in_use'): Room => ({
  id: uid(600 + n),
  name,
  floorId: uid(590),
  floorName: 'First',
  buildingId: uid(591),
  buildingName: 'Main',
  type: 'laboratory',
  capacity: 30,
  status,
  shared: false,
  maxSimultaneousLessons: null,
});

const LAB = room(1, 'Laboratory 1');
const ROOM_12 = room(2, 'Room 12');
const STORE = room(3, 'Store', 'closed');
const ATTIC = room(4, 'Attic', 'under_repair');

const closure = (n: number, fields: Partial<RoomClosure> = {}): RoomClosure => ({
  id: uid(700 + n),
  room: { id: LAB.id, name: LAB.name },
  startsOn: '2026-10-19',
  endsOn: '2026-10-30',
  reason: 'Repairs',
  state: 'planned',
  canEdit: true,
  canWithdraw: true,
  ...fields,
});

const LESSONS: RoomClosureLessons = {
  lessons: [
    {
      id: uid(800),
      date: '2026-10-19',
      start: 480,
      end: 525,
      unit: '7 Oxford',
      subject: { uz: 'Kimyo', ru: 'Химия', en: 'Chemistry' },
      teacher: 'Karimova Aziza',
      state: 'upcoming',
      needsRoom: true,
    },
  ],
};

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')]
    .filter((row) => row.closest('[role="complementary"]') === null)
    .map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''));

async function openList(
  input: {
    session?: ReturnType<typeof sessionOf>;
    closures?: RoomClosure[];
    lessons?: RoomClosureLessons;
    extra?: Record<string, (body: unknown) => Response>;
    language?: 'en' | 'ru';
  } = {},
) {
  const language = input.language ?? 'en';
  let list = input.closures ?? [closure(1)];
  const account = { ...(input.session ?? vice()), language };
  const calls = fakeApi({
    'GET /api/auth/session': () => json(account),
    'GET /api/timetable/room-closures': () => json({ closures: list, today: '2026-10-10' }),
    'GET /api/setup/rooms': () => json({ rooms: [LAB, ROOM_12, STORE, ATTIC] }),
    'POST /api/timetable/room-closures': (body) => {
      const made = closure(9, body as Partial<RoomClosure>);
      list = [...list, made];
      return json(made, 201);
    },
    [`GET /api/timetable/room-closures/${uid(701)}/lessons`]: () => json(input.lessons ?? LESSONS),
    [`PATCH /api/timetable/room-closures/${uid(701)}`]: (body) => {
      const changed = { ...closure(1), ...(body as object) };
      list = list.map((one) => (one.id === changed.id ? changed : one));
      return json(changed);
    },
    [`POST /api/timetable/room-closures/${uid(701)}/withdraw`]: () => {
      const gone = closure(1, { state: 'withdrawn', canEdit: false, canWithdraw: false });
      list = list.map((one) => (one.id === gone.id ? gone : one));
      return json(gone);
    },
    [`POST /api/timetable/room-closures/${uid(701)}/move`]: () => json({ moved: 1 }),
    ...input.extra,
  });
  renderApp(PATH, language);
  const words = language === 'ru' ? (await import('@/i18n/locales/ru')).ru : en;
  await screen.findByRole('heading', { name: words.timetable.roomClosures.title });
  if (list.length > 0) {
    await screen.findByRole('table', { name: words.timetable.roomClosures.caption });
  }
  return calls;
}

const openPanel = async () => {
  fireEvent.click(screen.getByText(LAB.name, { selector: 'button' }));
  return screen.findByRole('complementary', { name: LAB.name });
};

describe('the room closures page', () => {
  it('lists the closures with their room, days, reason and state', async () => {
    await openList({
      closures: [closure(1), closure(2, { state: 'current', reason: 'Paint' })],
    });
    expect(rowsDrawn()).toEqual([
      [LAB.name, '19 October 2026', '30 October 2026', 'Repairs', texts.state_planned],
      [LAB.name, '19 October 2026', '30 October 2026', 'Paint', texts.state_current],
    ]);
  });

  it('names the states in Russian when Russian is chosen', async () => {
    const { ru } = await import('@/i18n/locales/ru');
    await openList({ language: 'ru' });
    expect(rowsDrawn()[0]).toContain(ru.timetable.roomClosures.state_planned);
  });

  it('closes a room from a day to a day, offering no room closed by its status, and sends the record', async () => {
    const calls = await openList();
    fireEvent.click(await screen.findByRole('button', { name: texts.add }));
    const form = within(
      await screen.findByRole('complementary', { name: texts.newTitle }),
    ).getByRole('form', { name: texts.newTitle });
    const select = within(form).getByLabelText<HTMLSelectElement>(texts.room);
    expect([...select.options].map((one) => one.textContent)).toEqual([
      texts.roomChoose,
      ATTIC.name,
      LAB.name,
      ROOM_12.name,
    ]);
    fireEvent.change(select, { target: { value: ROOM_12.id } });
    fireEvent.change(within(form).getByLabelText(texts.firstDay), {
      target: { value: '2026-10-19' },
    });
    fireEvent.change(within(form).getByLabelText(texts.lastDay), {
      target: { value: '2026-10-23' },
    });
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Leak' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === 'POST /api/timetable/room-closures')?.body,
      ).toEqual({
        roomId: ROOM_12.id,
        startsOn: '2026-10-19',
        endsOn: '2026-10-23',
        reason: 'Leak',
      });
    });
  });

  it('shows the refusal of an overlap with what to do', async () => {
    await openList({
      extra: { 'POST /api/timetable/room-closures': () => refusal('room_closure_overlap', 409) },
    });
    fireEvent.click(await screen.findByRole('button', { name: texts.add }));
    const form = within(
      await screen.findByRole('complementary', { name: texts.newTitle }),
    ).getByRole('form', { name: texts.newTitle });
    fireEvent.change(within(form).getByLabelText(texts.room), { target: { value: LAB.id } });
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Leak' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.errors.room_closure_overlap)).toBeDefined();
  });

  it('opens a closure with its lessons, changes its last day and withdraws it after asking', async () => {
    const calls = await openList();
    const panel = await openPanel();
    const lessons = await within(panel).findByRole('region', { name: texts.lessons });
    const [row] = [...lessons.querySelectorAll('tbody tr')].map((one) =>
      [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
    );
    expect(row).toEqual([
      '19 October',
      '08:00–08:45',
      '7 Oxford',
      'Chemistry',
      'Karimova Aziza',
      texts.needsRoom,
    ]);
    fireEvent.click(within(panel).getByRole('button', { name: texts.changeDates }));
    const form = within(panel).getByRole('form', { name: texts.changeDates });
    fireEvent.change(within(form).getByLabelText(texts.lastDay), {
      target: { value: '2026-10-23' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PATCH /api/timetable/room-closures/${uid(701)}`)?.body,
      ).toEqual({ startsOn: '2026-10-19', endsOn: '2026-10-23' });
    });
    fireEvent.click(await within(panel).findByRole('button', { name: texts.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(texts.withdrawTitle)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: texts.withdraw }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `POST /api/timetable/room-closures/${uid(701)}/withdraw`,
        ),
      ).toBe(true);
    });
  });

  it('moves all the lessons to a room in use, the closed room left out, with the closure’s reason', async () => {
    const calls = await openList();
    const panel = await openPanel();
    await within(panel).findByRole('region', { name: texts.lessons });
    fireEvent.click(await within(panel).findByRole('button', { name: texts.moveAll }));
    const form = within(panel).getByRole('form', { name: texts.moveAll });
    const select = within(form).getByLabelText<HTMLSelectElement>(texts.moveRoom);
    expect([...select.options].map((one) => one.textContent)).toEqual([
      texts.roomChoose,
      ROOM_12.name,
    ]);
    expect(within(form).getByLabelText<HTMLInputElement>(texts.moveReason).value).toBe('Repairs');
    fireEvent.change(select, { target: { value: ROOM_12.id } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/timetable/room-closures/${uid(701)}/move`)
          ?.body,
      ).toEqual({ roomId: ROOM_12.id, reason: 'Repairs' });
    });
  });

  it('names the dates of the lessons a move cannot take, and moves nothing', async () => {
    await openList({
      extra: {
        [`POST /api/timetable/room-closures/${uid(701)}/move`]: () =>
          Response.json(
            {
              error: {
                code: 'room_move_blocked',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
                details: [
                  {
                    path: 'rules.room_double',
                    code: 'room_double',
                    message: 'x',
                    day: '2026-10-26',
                  },
                  {
                    path: 'rules.room_double',
                    code: 'room_double',
                    message: 'x',
                    day: '2026-10-19',
                  },
                ],
              },
            },
            { status: 409 },
          ),
      },
    });
    const panel = await openPanel();
    await within(panel).findByRole('region', { name: texts.lessons });
    fireEvent.click(await within(panel).findByRole('button', { name: texts.moveAll }));
    const form = within(panel).getByRole('form', { name: texts.moveAll });
    fireEvent.change(within(form).getByLabelText(texts.moveRoom), {
      target: { value: ROOM_12.id },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(
      await within(form).findByText(
        texts.moveBlocked.replace('{{dates}}', '19 October, 26 October'),
      ),
    ).toBeDefined();
  });

  it('offers no move when no lesson needs a room, and no withdraw once started', async () => {
    await openList({
      closures: [closure(1, { state: 'current', canWithdraw: false })],
      lessons: { lessons: [{ ...(LESSONS.lessons[0] ?? ({} as never)), needsRoom: false }] },
    });
    const panel = await openPanel();
    await within(panel).findByRole('region', { name: texts.lessons });
    expect(within(panel).queryByRole('button', { name: texts.moveAll })).toBeNull();
    expect(within(panel).queryByRole('button', { name: texts.withdraw })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: texts.changeDates }));
    const form = within(panel).getByRole('form', { name: texts.changeDates });
    expect(within(form).getByLabelText<HTMLInputElement>(texts.firstDay).disabled).toBe(true);
  });

  it('lets the Principal read with no way to add, change, move or withdraw', async () => {
    const calls = await openList({ session: principal() });
    expect(screen.queryByRole('button', { name: texts.add })).toBeNull();
    const panel = await openPanel();
    await within(panel).findByRole('region', { name: texts.lessons });
    for (const name of [texts.changeDates, texts.moveAll, texts.withdraw]) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
    expect(calls.some((call) => call.route === 'GET /api/setup/rooms')).toBe(false);
  });

  it('shows the empty page with its first action when there is no closure', async () => {
    await openList({ closures: [] });
    expect(await screen.findByText(texts.empty)).toBeDefined();
  });
});
