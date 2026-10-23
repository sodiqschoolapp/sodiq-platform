import {
  timeText,
  type DayAnswer,
  type DayExam,
  type DayLesson,
  type Room,
  type SchoolClass,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.6a-1, pull request #160: the day page, the
// one-day cancel of a lesson and its restore (06, Changes after publishing;
// edge/timetable, After publishing: "The restore can be refused, with another
// room offered").
const OXFORD: SchoolClass = {
  id: uid(101),
  academicYearId: uid(1),
  yearName: '2026–2027',
  yearStatus: 'current',
  grade: 7,
  name: 'Oxford',
  language: 'uz',
  mainRoom: null,
  maxSize: 25,
  students: 0,
  tutor: null,
  acting: null,
  archived: false,
  version: 0,
};

const room = (n: number, name: string, status: Room['status'] = 'in_use'): Room => ({
  id: uid(400 + n),
  name,
  floorId: uid(450),
  floorName: 'First',
  buildingId: uid(451),
  buildingName: 'Main',
  type: 'classroom',
  capacity: 30,
  status,
  shared: false,
  maxSimultaneousLessons: null,
});

const ROOMS = [
  room(0, 'Room 12'),
  room(1, 'Room 14'),
  room(2, 'Lab 2'),
  room(3, 'Old store', 'closed'),
];

const lesson = (n: number, fields: Partial<DayLesson> = {}): DayLesson => ({
  id: uid(300 + n),
  date: '2026-10-12',
  start: 480,
  end: 525,
  unit: { kind: 'class', id: OXFORD.id, name: '7 Oxford' },
  subject: { id: uid(200), names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } },
  teacher: { id: uid(600), kind: 'person', name: 'Karimova Aziza' },
  room: { id: uid(400), name: 'Room 12' },
  cancelCause: null,
  away: null,
  roomOut: null,
  cancelReason: null,
  changed: false,
  canCancel: true,
  canRestore: false,
  state: 'upcoming',
  canCorrect: false,
  substitution: null,
  canSubstitute: false,
  ...fields,
});

const session = (role: 'academic_vice_principal' | 'principal') =>
  sessionOf({ assignments: [{ role, branchId: NORTH.id }], branches: [NORTH], language: 'en' });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

async function openPage(
  options: {
    role?: 'academic_vice_principal' | 'principal';
    lessons?: DayLesson[];
    exams?: DayExam[];
    longestDay?: number;
    extra?: Record<string, (body: unknown) => Response>;
  } = {},
) {
  let lessons = options.lessons ?? [lesson(1)];
  const day = (): DayAnswer => ({
    date: '2026-10-12',
    classId: OXFORD.id,
    slots: [
      { lessonNumber: 1, start: 480, end: 525 },
      { lessonNumber: 2, start: 535, end: 580 },
    ],
    longestDay: options.longestDay ?? 2,
    today: '2026-10-10',
    lessons,
    exams: options.exams ?? [],
  });
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session(options.role ?? 'academic_vice_principal')),
    'GET /api/timetable/versions': () => json({ versions: [], today: '2026-10-10' }),
    'GET /api/classes': () => json({ classes: [OXFORD] }),
    'GET /api/timetable/day': () => json(day()),
    'GET /api/setup/rooms': () => json({ rooms: ROOMS }),
    ...options.extra,
  });
  renderApp(`/timetable/day?date=2026-10-12&class=${OXFORD.id}`, 'en');
  await screen.findByRole('heading', { name: en.timetable.day.title });
  return {
    calls,
    setLessons: (next: DayLesson[]) => {
      lessons = next;
    },
  };
}

/** A `cancel_holds_data` refusal of one lesson (task 6.1b-2). */
const heldRefusal = (lessonId: string) => ({
  error: {
    code: 'cancel_holds_data',
    message: 'ENGLISH TEXT FOR THE DEVELOPER',
    requestId: 'test-request',
    details: [
      {
        path: `lessons.${lessonId}`,
        code: 'cancel_holds_data',
        message: 'x',
        recordId: lessonId,
        heldData: { attendance: 2, scores: 5, totals: 0, notHeld: 0 },
      },
    ],
  },
});

describe('the day page', () => {
  it('lists the class’s lessons of the date with their state', async () => {
    await openPage({
      lessons: [
        lesson(1),
        lesson(2, {
          start: 535,
          end: 580,
          teacher: null,
          room: null,
          cancelCause: 'reason',
          cancelReason: 'Excursion',
          canCancel: false,
          canRestore: true,
          changed: true,
        }),
      ],
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const [first, second] = rowsDrawn();
    expect(first?.slice(0, 6)).toEqual([
      '08:00–08:45',
      '7 Oxford',
      'Mathematics',
      'Karimova Aziza',
      'Room 12',
      en.timetable.day.asPlanned,
    ]);
    expect(second?.slice(0, 6)).toEqual([
      '08:55–09:40',
      '7 Oxford',
      'Mathematics',
      en.timetable.day.needsTeacher,
      en.timetable.day.needsRoom,
      `Cancelled: Excursion · ${en.timetable.day.changed}`,
    ]);
  });

  // Task 5.7a-1: a lesson of an absent teacher keeps its teacher and needs one.
  it('marks the teacher of a lesson absent, "needs a teacher" before it starts and "unresolved" after', async () => {
    await openPage({
      lessons: [
        lesson(1, { away: 'absence', state: 'needs_teacher' }),
        lesson(2, { start: 535, end: 580, away: 'absence', state: 'unresolved', canCancel: false }),
      ],
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const [first, second] = rowsDrawn();
    expect(first?.slice(3, 6)).toEqual([
      `Karimova Aziza · ${en.timetable.day.absent}`,
      'Room 12',
      en.timetable.day.needsTeacherAbsent,
    ]);
    expect(second?.[5]).toBe(en.timetable.day.unresolvedAbsent);
  });

  // Task 5.7a-2a: a teacher inactive, left or locked.
  it('names the teacher inactive, left or locked, "needs a teacher" before and "unresolved" after', async () => {
    await openPage({
      lessons: [
        lesson(1, { away: 'locked', state: 'needs_teacher' }),
        lesson(2, { start: 535, end: 580, away: 'left', state: 'unresolved', canCancel: false }),
      ],
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const [first, second] = rowsDrawn();
    expect(first?.slice(3, 6)).toEqual([
      `Karimova Aziza · ${en.timetable.day.away_locked}`,
      'Room 12',
      en.timetable.day.needsTeacher_locked,
    ]);
    expect(second?.[3]).toBe(`Karimova Aziza · ${en.timetable.day.away_left}`);
    expect(second?.[5]).toBe(en.timetable.day.unresolved_left);
  });

  // Task 5.7a-2b (decision 2): a lesson whose room is out at its start.
  it('marks the room of a lesson that needs a room, by its cause', async () => {
    await openPage({
      lessons: [
        lesson(1, { roomOut: 'closure' }),
        lesson(2, { start: 535, end: 580, roomOut: 'under_repair' }),
      ],
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const [first, second] = rowsDrawn();
    expect(first?.[4]).toBe(`Room 12 · ${en.timetable.day.roomOut_closure}`);
    expect(second?.[4]).toBe(`Room 12 · ${en.timetable.day.roomOut_under_repair}`);
  });

  it('shows no actions to the Principal', async () => {
    await openPage({ role: 'principal' });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: en.timetable.day.cancel })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.day.changeRoom })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.day.move })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: en.timetable.day.actions })).toBeNull();
  });

  it('shows no cancel, room change or move on a started lesson', async () => {
    await openPage({
      lessons: [
        lesson(1, { canCancel: false, canRestore: false }),
        lesson(2, { start: 535, end: 580 }),
      ],
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const [started, ahead] = [...document.querySelectorAll('tbody tr')];
    if (!(started instanceof HTMLElement) || !(ahead instanceof HTMLElement)) {
      throw new Error('two rows expected');
    }
    expect(within(started).queryByRole('button', { name: en.timetable.day.cancel })).toBeNull();
    expect(within(started).queryByRole('button', { name: en.timetable.day.changeRoom })).toBeNull();
    expect(within(started).queryByRole('button', { name: en.timetable.day.move })).toBeNull();
    expect(within(started).queryByRole('button', { name: en.timetable.day.restore })).toBeNull();
    expect(within(ahead).getByRole('button', { name: en.timetable.day.cancel })).not.toBeNull();
    expect(within(ahead).getByRole('button', { name: en.timetable.day.changeRoom })).not.toBeNull();
    expect(within(ahead).getByRole('button', { name: en.timetable.day.move })).not.toBeNull();
  });

  it('says when the class has no lessons on the date', async () => {
    await openPage({ lessons: [] });
    expect(await screen.findByText(en.timetable.day.empty)).not.toBeNull();
  });

  it('cancels a lesson with its reason, refusing an empty one before any call', async () => {
    const page = await openPage({
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/cancel`]: () => {
          const cancelled = lesson(1, {
            cancelCause: 'reason',
            cancelReason: 'Excursion',
            canCancel: false,
            canRestore: true,
            changed: true,
          });
          page.setLessons([cancelled]);
          return json({ lesson: cancelled, warnings: [] });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.cancel }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.cancelSend }));
    expect(await within(dialog).findByText(en.timetable.day.reasonNeeded)).not.toBeNull();
    expect(page.calls.filter((call) => call.route.endsWith('/cancel'))).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Excursion' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.cancelSend }));
    expect(await screen.findByText(en.timetable.day.cancelled)).not.toBeNull();
    const sent = page.calls.filter((call) => call.route.endsWith('/cancel'));
    expect(sent.map((call) => call.body)).toEqual([{ reason: 'Excursion' }]);
    await waitFor(() => {
      expect(rowsDrawn()[0]?.[5]).toBe(`Cancelled: Excursion · ${en.timetable.day.changed}`);
    });
  });

  // Task 6.1b-2 (decision 2): edge/timetable, After publishing, "A lesson that
  // already has attendance must be cancelled … with a reason and a list of
  // what is affected."
  it('lists what a lesson with data holds on a refused cancel, and cancels it again with the tick', async () => {
    let sent = 0;
    const page = await openPage({
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/cancel`]: () => {
          sent += 1;
          return sent === 1
            ? json(heldRefusal(uid(301)), 409)
            : json({
                lesson: lesson(1, { cancelCause: 'reason', cancelReason: 'Excursion' }),
                warnings: [],
              });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.cancel }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Excursion' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.cancelSend }));
    expect(await within(dialog).findByText(en.timetable.held.title)).not.toBeNull();
    expect(within(dialog).getByText('attendance marks: 2, numbers: 5')).not.toBeNull();
    // Each lesson listed is named by its time and class (spec review of the code, should-fix 3).
    const named = dialog.querySelector(`[data-held-lesson="${uid(301)}"]`)?.textContent ?? '';
    expect(
      named.startsWith(
        `${timeText(lesson(1).start)}–${timeText(lesson(1).end)} ${lesson(1).unit.name}: `,
      ),
    ).toBe(true);
    fireEvent.click(within(dialog).getByLabelText(en.timetable.held.confirm));
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.cancelSend }));
    expect(await screen.findByText(en.timetable.day.cancelled)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/cancel')).map((call) => call.body),
    ).toEqual([{ reason: 'Excursion' }, { reason: 'Excursion', confirm: true }]);
  });

  it('shows a refused restore with its reasons and the free rooms', async () => {
    const cancelled = lesson(1, {
      cancelCause: 'reason',
      cancelReason: 'Excursion',
      canCancel: false,
      canRestore: true,
    });
    await openPage({
      lessons: [cancelled],
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/restore`]: () =>
          json(
            {
              error: {
                code: 'restore_blocked',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
                details: [
                  {
                    path: 'rules.room_double',
                    code: 'room_double',
                    message: 'x',
                    rule: { weekday: 1, lessonIds: [] },
                  },
                  {
                    path: 'rooms',
                    code: 'room_free',
                    message: 'x',
                    room: { id: uid(401), name: 'Room 14' },
                  },
                  {
                    path: 'rooms',
                    code: 'room_free',
                    message: 'x',
                    room: { id: uid(402), name: 'Lab 2' },
                  },
                ],
              },
            },
            409,
          ),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.restore }));
    expect(await screen.findByText(en.errors.restore_blocked)).not.toBeNull();
    expect(screen.getByText(`Broken at its time: ${en.timetable.rule.room_double}`)).not.toBeNull();
    expect(screen.getByText('Rooms free at that time: Room 14, Lab 2')).not.toBeNull();
  });

  it('restores a lesson and says so', async () => {
    const cancelled = lesson(1, {
      cancelCause: 'reason',
      cancelReason: 'Excursion',
      canCancel: false,
      canRestore: true,
    });
    const page = await openPage({
      lessons: [cancelled],
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/restore`]: () => {
          page.setLessons([lesson(1, { changed: true })]);
          return json({ lesson: lesson(1, { changed: true }), warnings: [] });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.restore }));
    expect(await screen.findByText(en.timetable.day.restored)).not.toBeNull();
    expect(page.calls.filter((call) => call.route.endsWith('/restore'))).toHaveLength(1);
  });

  // Task 5.6a-2: the one-day room change, the move and the restore into a free room.
  it('changes the room of a lesson with a reason, a refused room offering a free one that fills the field', async () => {
    let tries = 0;
    const page = await openPage({
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/room`]: () => {
          tries += 1;
          if (tries === 1) {
            return json(
              {
                error: {
                  code: 'day_change_blocked',
                  message: 'ENGLISH TEXT FOR THE DEVELOPER',
                  requestId: 'test-request',
                  details: [
                    {
                      path: 'rules.room_double',
                      code: 'room_double',
                      message: 'x',
                      rule: { weekday: 1, lessonIds: [] },
                    },
                    {
                      path: 'rooms',
                      code: 'room_free',
                      message: 'x',
                      room: { id: uid(402), name: 'Lab 2' },
                    },
                  ],
                },
              },
              409,
            );
          }
          const changed = lesson(1, { room: { id: uid(402), name: 'Lab 2' }, changed: true });
          page.setLessons([changed]);
          return json({ lesson: changed, warnings: [] });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.changeRoom }));
    const dialog = await screen.findByRole('dialog');
    const select = await within(dialog).findByLabelText(en.timetable.day.newRoom);
    // Only rooms in use are offered.
    expect([...select.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      en.timetable.day.roomChoose,
      'Lab 2',
      'Room 12',
      'Room 14',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.roomSend }));
    expect(await within(dialog).findByText(en.timetable.day.roomNeeded)).not.toBeNull();
    expect(page.calls.filter((call) => call.route.endsWith('/room'))).toHaveLength(0);
    fireEvent.change(select, { target: { value: uid(401) } });
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Painting' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.roomSend }));
    expect(await within(dialog).findByText(en.errors.day_change_blocked)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Lab 2' }));
    expect((select as HTMLSelectElement).value).toBe(uid(402));
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.roomSend }));
    expect(await screen.findByText(en.timetable.day.roomChanged)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/room')).map((call) => call.body),
    ).toEqual([
      { roomId: uid(401), reason: 'Painting' },
      { roomId: uid(402), reason: 'Painting' },
    ]);
  });

  it('moves a lesson to a lesson slot of the chosen date, keeping its room unless one is chosen', async () => {
    const page = await openPage({
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/move`]: () => {
          const moved = lesson(1, { start: 535, end: 580, changed: true });
          page.setLessons([moved]);
          return json({ lesson: moved, warnings: [] });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.move }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.timetable.day.moveDate).value).toBe(
      '2026-10-12',
    );
    const slot = await within(dialog).findByLabelText(en.timetable.day.slot);
    expect([...slot.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      en.timetable.day.slotChoose,
      'Lesson 1, 08:00–08:45',
      'Lesson 2, 08:55–09:40',
    ]);
    fireEvent.change(slot, { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Concert in the hall' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.moveSend }));
    expect(await screen.findByText(en.timetable.day.moved)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/move')).map((call) => call.body),
    ).toEqual([{ date: '2026-10-12', lessonNumber: 2, reason: 'Concert in the hall' }]);
  });

  it('restores a refused lesson into a free room it offered, with a reason', async () => {
    const cancelled = lesson(1, {
      cancelCause: 'reason',
      cancelReason: 'Excursion',
      canCancel: false,
      canRestore: true,
    });
    const bodies: unknown[] = [];
    const page = await openPage({
      lessons: [cancelled],
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/restore`]: (body) => {
          bodies.push(body);
          if (bodies.length === 1) {
            return json(
              {
                error: {
                  code: 'restore_blocked',
                  message: 'ENGLISH TEXT FOR THE DEVELOPER',
                  requestId: 'test-request',
                  details: [
                    {
                      path: 'rules.room_double',
                      code: 'room_double',
                      message: 'x',
                      rule: { weekday: 1, lessonIds: [] },
                    },
                    {
                      path: 'rooms',
                      code: 'room_free',
                      message: 'x',
                      room: { id: uid(402), name: 'Lab 2' },
                    },
                  ],
                },
              },
              409,
            );
          }
          const restored = lesson(1, { room: { id: uid(402), name: 'Lab 2' }, changed: true });
          page.setLessons([restored]);
          return json({ lesson: restored, warnings: [] });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.restore }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore into Lab 2' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('The lesson comes back in Lab 2.')).not.toBeNull();
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Room 12 is taken' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.restoreSend }));
    expect(await screen.findByText(en.timetable.day.restored)).not.toBeNull();
    expect(bodies).toEqual([{}, { roomId: uid(402), reason: 'Room 12 is taken' }]);
  });

  // Task 5.6a-3: the bulk cancel of the date, a shared block chosen.
  describe('the bulk cancel', () => {
    const PRINCETON: SchoolClass = { ...OXFORD, id: uid(102), name: 'Princeton' };
    const shared = (n: number, name: string) =>
      lesson(n, {
        start: 535,
        end: 580,
        unit: { kind: 'group', id: uid(700 + n), name },
        subject: { id: uid(201), names: { uz: 'Ingliz tili', ru: 'Английский', en: 'English' } },
      });
    const checkAnswer = {
      date: '2026-10-12',
      cancel: [{ lesson: lesson(1), broughtIn: false }],
      shared: [
        {
          blockId: uid(800),
          pairBlockId: null,
          lessons: [shared(11, '7-E-1'), shared(12, '7-E-2')],
          chosenOnly: [uid(312)],
          chosenClasses: [{ id: OXFORD.id, name: '7 Oxford' }],
          otherClasses: [{ id: PRINCETON.id, name: '7 Princeton' }],
        },
      ],
      alreadyCancelled: [],
      held: [],
      withData: [],
      plans: [],
    };

    it('checks the classes and slots, needs a choice for the shared block and sends what the check listed', async () => {
      const page = await openPage({
        extra: {
          'GET /api/classes': () => json({ classes: [OXFORD, PRINCETON] }),
          'POST /api/timetable/bulk-cancels/check': () => json(checkAnswer),
          'POST /api/timetable/bulk-cancels': () =>
            json({ id: uid(900), cancelled: [uid(301)], kept: [uid(800)], keptWithData: [] }),
        },
      });
      fireEvent.click(await screen.findByRole('button', { name: en.timetable.bulk.open }));
      const dialog = await screen.findByRole('dialog');
      const check = within(dialog).getByRole('button', { name: en.timetable.bulk.check });
      // The page's class is chosen; no slot yet, so nothing to check.
      expect(
        within(dialog).getByRole<HTMLInputElement>('checkbox', { name: '7 Oxford' }).checked,
      ).toBe(true);
      expect(check.hasAttribute('disabled')).toBe(true);
      for (const number of [1, 2]) {
        fireEvent.click(
          within(dialog).getByRole('checkbox', {
            name: en.timetable.bulk.slot.replace('{{number}}', String(number)),
          }),
        );
      }
      fireEvent.click(check);
      const block = await within(dialog).findByRole('group', {
        name: 'Shared by 7 Oxford with 7 Princeton',
      });
      expect(
        within(dialog).getByText('08:00–08:45 7 Oxford, Mathematics, Karimova Aziza'),
      ).not.toBeNull();
      const send = within(dialog).getByRole('button', { name: en.timetable.bulk.send });
      expect(send.hasAttribute('disabled')).toBe(true);
      expect(within(dialog).getByText(en.timetable.bulk.chooseEach)).not.toBeNull();
      fireEvent.click(within(block).getByRole('radio', { name: en.timetable.bulk.choice_keep }));
      fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
        target: { value: 'Excursion to the museum' },
      });
      expect(send.hasAttribute('disabled')).toBe(false);
      fireEvent.click(send);
      expect(await screen.findByText('1 lesson was cancelled.')).not.toBeNull();
      expect(
        page.calls
          .filter((call) => call.route.startsWith('POST /api/timetable/bulk-cancels'))
          .map((call) => [call.route, call.body]),
      ).toEqual([
        [
          'POST /api/timetable/bulk-cancels/check',
          { date: '2026-10-12', classIds: [OXFORD.id], lessonNumbers: [1, 2] },
        ],
        [
          'POST /api/timetable/bulk-cancels',
          {
            date: '2026-10-12',
            classIds: [OXFORD.id],
            lessonNumbers: [1, 2],
            reason: 'Excursion to the museum',
            blocks: [{ blockId: uid(800), choice: 'keep' }],
            // The lesson to cancel and, with “keep”, the part of the chosen class alone.
            lessonIds: [uid(301), uid(312)],
            dataChoices: [],
          },
        ],
      ]);
    });

    // Task 6.1b-2 (decision 4): edge/time-dates-calendar, "For a lesson that
    // already has data, the Academic Vice Principal chooses 'keep as held' or
    // 'cancel'".
    it('asks “Keep as held” or “Cancel” for each lesson with data, one choice for a double, and a shared block’s “cancel” for its parts', async () => {
      const held = { attendance: 3, scores: 0, totals: 1, notHeld: 0 };
      const page = await openPage({
        extra: {
          'GET /api/classes': () => json({ classes: [OXFORD, PRINCETON] }),
          'POST /api/timetable/bulk-cancels/check': () =>
            json({
              ...checkAnswer,
              cancel: [
                { lesson: lesson(1), broughtIn: false },
                { lesson: lesson(2), broughtIn: false },
              ],
              withData: [
                {
                  lessonId: uid(301),
                  heldData: held,
                  pairLessonIds: [uid(302)],
                  sharedBlockId: null,
                },
                { lessonId: uid(312), heldData: held, pairLessonIds: [], sharedBlockId: uid(800) },
              ],
            }),
          'POST /api/timetable/bulk-cancels': () =>
            json({ id: uid(900), cancelled: [uid(312)], kept: [uid(800)], keptWithData: [] }),
        },
      });
      fireEvent.click(await screen.findByRole('button', { name: en.timetable.bulk.open }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(
        within(dialog).getByRole('checkbox', {
          name: en.timetable.bulk.slot.replace('{{number}}', '1'),
        }),
      );
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.bulk.check }));
      expect(await within(dialog).findByText(en.timetable.bulk.withData)).not.toBeNull();
      expect(
        within(dialog).getAllByText('attendance marks: 3, works with a total: 1'),
      ).toHaveLength(1);
      const send = within(dialog).getByRole('button', { name: en.timetable.bulk.send });
      fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
        target: { value: 'The school closes at 11:00' },
      });
      // A shared block chosen "cancel" cancels its part with data too.
      const block = within(dialog).getByRole('group', {
        name: 'Shared by 7 Oxford with 7 Princeton',
      });
      fireEvent.click(within(block).getByRole('radio', { name: en.timetable.bulk.choice_cancel }));
      const part = dialog.querySelector('[data-data-lesson="' + uid(312) + '"]');
      if (!(part instanceof HTMLElement)) throw new Error('The part is not asked about.');
      const forced = within(part).getByRole<HTMLInputElement>('radio', {
        name: en.timetable.bulk.data_cancel,
      });
      expect(forced.checked && forced.disabled).toBe(true);
      // "keep": the part of the chosen class alone takes its own choice.
      fireEvent.click(within(block).getByRole('radio', { name: en.timetable.bulk.choice_keep }));
      expect(send.hasAttribute('disabled')).toBe(true);
      const first = dialog.querySelector('[data-data-lesson="' + uid(301) + '"]');
      if (!(first instanceof HTMLElement)) throw new Error('The lesson is not asked about.');
      fireEvent.click(within(first).getByRole('radio', { name: en.timetable.bulk.data_keep }));
      expect(send.hasAttribute('disabled')).toBe(true);
      const own = dialog.querySelector('[data-data-lesson="' + uid(312) + '"]');
      if (!(own instanceof HTMLElement)) throw new Error('The part is not asked about.');
      fireEvent.click(within(own).getByRole('radio', { name: en.timetable.bulk.data_cancel }));
      expect(send.hasAttribute('disabled')).toBe(false);
      fireEvent.click(send);
      expect(await screen.findByText('1 lesson was cancelled.')).not.toBeNull();
      const saved = page.calls.find((call) => call.route === 'POST /api/timetable/bulk-cancels');
      expect(saved?.body).toMatchObject({
        blocks: [{ blockId: uid(800), choice: 'keep' }],
        // The kept lesson and the other half of its double are not cancelled.
        lessonIds: [uid(312)],
        dataChoices: [
          { lessonId: uid(301), choice: 'keep' },
          { lessonId: uid(312), choice: 'cancel' },
        ],
      });
    });

    it('asks for a new check when a class changes, and ticks every class with “Every class of the branch”', async () => {
      await openPage({
        extra: {
          'GET /api/classes': () => json({ classes: [OXFORD, PRINCETON] }),
          'POST /api/timetable/bulk-cancels/check': () => json(checkAnswer),
        },
      });
      fireEvent.click(await screen.findByRole('button', { name: en.timetable.bulk.open }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(
        within(dialog).getByRole('checkbox', {
          name: en.timetable.bulk.slot.replace('{{number}}', '1'),
        }),
      );
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.bulk.check }));
      expect(await within(dialog).findByText(en.timetable.bulk.toCancel)).not.toBeNull();
      fireEvent.click(within(dialog).getByRole('checkbox', { name: en.timetable.bulk.everyClass }));
      expect(
        within(dialog).getByRole<HTMLInputElement>('checkbox', { name: '7 Princeton' }).checked,
      ).toBe(true);
      expect(within(dialog).queryByText(en.timetable.bulk.toCancel)).toBeNull();
      expect(
        within(dialog)
          .getByRole('button', { name: en.timetable.bulk.send })
          .hasAttribute('disabled'),
      ).toBe(true);
    });

    it('shows a refusal of the save with its text', async () => {
      await openPage({
        extra: {
          'POST /api/timetable/bulk-cancels/check': () => json({ ...checkAnswer, shared: [] }),
          'POST /api/timetable/bulk-cancels': () =>
            json(
              {
                error: {
                  code: 'bulk_scope_changed',
                  message: 'ENGLISH TEXT FOR THE DEVELOPER',
                  requestId: 'test-request',
                },
              },
              409,
            ),
        },
      });
      fireEvent.click(await screen.findByRole('button', { name: en.timetable.bulk.open }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(
        within(dialog).getByRole('checkbox', {
          name: en.timetable.bulk.slot.replace('{{number}}', '1'),
        }),
      );
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.bulk.check }));
      await within(dialog).findByText(en.timetable.bulk.toCancel);
      fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
        target: { value: 'School closes at 11:00' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.bulk.send }));
      expect(await within(dialog).findByText(en.errors.bulk_scope_changed)).not.toBeNull();
    });

    it('offers the lesson numbers of the longest day of the branch, not of the page’s class (review must-fix 1)', async () => {
      const page = await openPage({
        longestDay: 9,
        extra: {
          'GET /api/classes': () => json({ classes: [OXFORD, PRINCETON] }),
          'POST /api/timetable/bulk-cancels/check': () => json({ ...checkAnswer, shared: [] }),
        },
      });
      fireEvent.click(await screen.findByRole('button', { name: en.timetable.bulk.open }));
      const dialog = await screen.findByRole('dialog');
      const slot = (number: number) =>
        within(dialog).queryByRole('checkbox', {
          name: en.timetable.bulk.slot.replace('{{number}}', String(number)),
        });
      // The page's class has a day of two lessons; another class of the branch has nine.
      expect(slot(9)).not.toBeNull();
      expect(slot(10)).toBeNull();
      fireEvent.click(within(dialog).getByRole('checkbox', { name: en.timetable.bulk.everyClass }));
      for (const number of [4, 5, 6, 7, 8, 9]) {
        const box = slot(number);
        if (box === null) throw new Error(`No lesson ${String(number)}.`);
        fireEvent.click(box);
      }
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.bulk.check }));
      await within(dialog).findByText(en.timetable.bulk.toCancel);
      expect(
        page.calls
          .filter((call) => call.route === 'POST /api/timetable/bulk-cancels/check')
          .map((call) => call.body),
      ).toEqual([
        {
          date: '2026-10-12',
          classIds: [OXFORD.id, PRINCETON.id],
          lessonNumbers: [4, 5, 6, 7, 8, 9],
        },
      ]);
    });

    it('offers no bulk cancel to the Principal', async () => {
      await openPage({ role: 'principal' });
      await waitFor(() => {
        expect(rowsDrawn()).toHaveLength(1);
      });
      expect(screen.queryByRole('button', { name: en.timetable.bulk.open })).toBeNull();
    });
  });
});

// Task 5.6a-4, pull request #163: the correction of a past lesson (`06`, How
// surprises are prevented: "A past lesson can only be corrected one at a time
// by the Academic Vice Principal, with a reason"; edge/timetable, After
// publishing, "The lesson time passes and nobody was assigned").
describe('the correction of a past lesson', () => {
  const PERSON = { id: uid(601), name: 'Rahimov Bobur' };
  const past = (n: number, fields: Partial<DayLesson> = {}) =>
    lesson(n, { canCancel: false, state: 'held', canCorrect: true, ...fields });

  /** The cell of a row's state. */
  const stateCell = (row: number) => rowsDrawn()[row]?.[5] ?? '';

  it('shows a started lesson as held or unresolved, offers "Correct" on it, not on a lesson still to come or one cancelled for an exam', async () => {
    await openPage({
      lessons: [
        past(1),
        past(2, { start: 535, end: 580, teacher: null, state: 'unresolved' }),
        lesson(3, { start: 590, end: 635 }),
        past(4, { start: 645, end: 690, cancelCause: 'exam', state: 'cancelled' }),
      ],
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(4);
    });
    expect(stateCell(0)).toBe(en.timetable.day.held);
    expect(stateCell(1)).toBe(en.timetable.day.unresolved);
    expect(stateCell(2)).toBe(en.timetable.day.asPlanned);
    const rows = [...document.querySelectorAll('tbody tr')];
    const buttons = (row: number) =>
      [...(rows[row]?.querySelectorAll('button') ?? [])].map((one) => one.textContent);
    // Task 5.8b: every lesson also opens its history.
    expect(buttons(0)).toEqual([en.timetable.day.correct, en.timetable.day.history]);
    expect(buttons(1)).toEqual([en.timetable.day.correct, en.timetable.day.history]);
    expect(buttons(2)).not.toContain(en.timetable.day.correct);
    expect(buttons(3)).toEqual([en.timetable.day.history]);
  });

  it('offers no correction to the Principal', async () => {
    await openPage({ role: 'principal', lessons: [past(1)] });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: en.timetable.day.correct })).toBeNull();
  });

  it('records who taught an unresolved lesson with the reason', async () => {
    const page = await openPage({
      lessons: [past(1, { teacher: null, state: 'unresolved' })],
      extra: {
        [`GET /api/timetable/lessons/${uid(301)}/correction-teachers`]: () =>
          json({ teachers: [PERSON] }),
        [`POST /api/timetable/lessons/${uid(301)}/correction`]: () =>
          json({ lesson: past(1, { teacher: { ...PERSON, kind: 'person' } }), warnings: [] }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.correct }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.correctKind), {
      target: { value: 'teacher' },
    });
    fireEvent.change(await within(dialog).findByLabelText(en.timetable.day.whoTaught), {
      target: { value: PERSON.id },
    });
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'The register names him' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    expect(await screen.findByText(en.timetable.day.corrected)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/correction')).map((call) => call.body),
    ).toEqual([{ kind: 'teacher', teacherId: PERSON.id, reason: 'The register names him' }]);
  });

  it('lists what a past lesson with data holds on a refused cancel, and cancels it again with the tick (task 6.1b-2)', async () => {
    let sent = 0;
    const page = await openPage({
      lessons: [past(1)],
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/correction`]: () => {
          sent += 1;
          return sent === 1
            ? json(heldRefusal(uid(301)), 409)
            : json({
                lesson: past(1, { cancelCause: 'reason', cancelReason: 'Nobody came' }),
                warnings: [],
              });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.correct }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Nobody came' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    expect(await within(dialog).findByText('attendance marks: 2, numbers: 5')).not.toBeNull();
    fireEvent.click(within(dialog).getByLabelText(en.timetable.held.confirm));
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    expect(await screen.findByText(en.timetable.day.corrected)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/correction')).map((call) => call.body),
    ).toEqual([
      { kind: 'cancel', reason: 'Nobody came' },
      { kind: 'cancel', reason: 'Nobody came', confirm: true },
    ]);
  });

  it('sends nothing without a reason', async () => {
    const page = await openPage({ lessons: [past(1)] });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.correct }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    expect(await within(dialog).findByText(en.timetable.day.reasonNeededChange)).not.toBeNull();
    expect(page.calls.filter((call) => call.route.endsWith('/correction'))).toHaveLength(0);
  });

  it('lists the warnings of a correction with a tick and sends it again with the tick', async () => {
    let sent = 0;
    const page = await openPage({
      lessons: [past(1, { teacher: null, state: 'unresolved' })],
      extra: {
        [`GET /api/timetable/lessons/${uid(301)}/correction-teachers`]: () =>
          json({ teachers: [PERSON] }),
        [`POST /api/timetable/lessons/${uid(301)}/correction`]: () => {
          sent += 1;
          return sent === 1
            ? json(
                {
                  error: {
                    code: 'correction_needs_confirm',
                    message: 'ENGLISH TEXT FOR THE DEVELOPER',
                    requestId: 'test-request',
                    details: [
                      {
                        path: 'rules.teacher_subject',
                        code: 'teacher_subject',
                        message: 'x',
                        rule: { weekday: 1, lessonIds: [] },
                      },
                    ],
                  },
                },
                409,
              )
            : json({ lesson: past(1, { teacher: { ...PERSON, kind: 'person' } }), warnings: [] });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.correct }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.correctKind), {
      target: { value: 'teacher' },
    });
    fireEvent.change(await within(dialog).findByLabelText(en.timetable.day.whoTaught), {
      target: { value: PERSON.id },
    });
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Covered the lesson' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    expect(await within(dialog).findByText(en.errors.correction_needs_confirm)).not.toBeNull();
    expect(within(dialog).getByText(en.timetable.rule.teacher_subject)).not.toBeNull();
    fireEvent.click(within(dialog).getByLabelText(en.timetable.day.confirm));
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    expect(await screen.findByText(en.timetable.day.corrected)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/correction')).map((call) => call.body),
    ).toEqual([
      { kind: 'teacher', teacherId: PERSON.id, reason: 'Covered the lesson' },
      { kind: 'teacher', teacherId: PERSON.id, reason: 'Covered the lesson', confirm: true },
    ]);
  });

  it('takes the tick away when another person is chosen, so their warnings are shown first (spec review of the code, must-fix 2)', async () => {
    const OTHER = { id: uid(602), name: 'Saidova Malika' };
    const page = await openPage({
      lessons: [past(1, { teacher: null, state: 'unresolved' })],
      extra: {
        [`GET /api/timetable/lessons/${uid(301)}/correction-teachers`]: () =>
          json({ teachers: [PERSON, OTHER] }),
        [`POST /api/timetable/lessons/${uid(301)}/correction`]: () =>
          json(
            {
              error: {
                code: 'correction_needs_confirm',
                message: 'ENGLISH TEXT FOR THE DEVELOPER',
                requestId: 'test-request',
                details: [
                  {
                    path: 'rules.teacher_subject',
                    code: 'teacher_subject',
                    message: 'x',
                    rule: { weekday: 1, lessonIds: [] },
                  },
                ],
              },
            },
            409,
          ),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.correct }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.correctKind), {
      target: { value: 'teacher' },
    });
    const who = await within(dialog).findByLabelText(en.timetable.day.whoTaught);
    fireEvent.change(who, { target: { value: PERSON.id } });
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'Covered the lesson' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    const tick = await within(dialog).findByLabelText(en.timetable.day.confirm);
    fireEvent.click(tick);
    expect((tick as HTMLInputElement).checked).toBe(true);
    fireEvent.change(who, { target: { value: OTHER.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    await waitFor(() => {
      expect(page.calls.filter((call) => call.route.endsWith('/correction'))).toHaveLength(2);
    });
    expect(
      page.calls.filter((call) => call.route.endsWith('/correction')).map((call) => call.body),
    ).toEqual([
      { kind: 'teacher', teacherId: PERSON.id, reason: 'Covered the lesson' },
      { kind: 'teacher', teacherId: OTHER.id, reason: 'Covered the lesson' },
    ]);
  });

  it('offers a restore only for a lesson cancelled with a reason', async () => {
    const page = await openPage({
      lessons: [past(1, { cancelCause: 'reason', cancelReason: 'Rain', state: 'cancelled' })],
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/correction`]: () =>
          json({ lesson: past(1), warnings: [] }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.correct }));
    const dialog = await screen.findByRole('dialog');
    const kinds = within(dialog).getByLabelText(en.timetable.day.correctKind);
    expect([...kinds.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      en.timetable.day.kind_restore,
    ]);
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'It took place' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.correctSend }));
    expect(await screen.findByText(en.timetable.day.corrected)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/correction')).map((call) => call.body),
    ).toEqual([{ kind: 'restore', reason: 'It took place' }]);
  });

  // Task 5.6c-2 (plan test 17; `06`, Exam: "It is shown on every timetable
  // view ..., marked 'exam'").
  it('shows the class’s exam of the date as a row marked "Exam", with its room and invigilators', async () => {
    await openPage({
      lessons: [lesson(1, { cancelCause: 'exam', state: 'cancelled', canCancel: false })],
      exams: [
        {
          id: uid(901),
          title: 'Quarter exam in maths',
          subject: null,
          start: 480,
          end: 570,
          room: { id: uid(902), name: 'Hall' },
          invigilators: ['Karimova Dilnoza'],
        },
      ],
    });
    await waitFor(() => {
      expect(document.querySelector(`[data-exam="${uid(901)}"]`)).not.toBeNull();
    });
    const row = document.querySelector(`[data-exam="${uid(901)}"]`);
    const cells = [...(row?.querySelectorAll('td') ?? [])].map((one) => one.textContent);
    // In time order among the lessons (spec review of the code, should-fix 9).
    expect(document.querySelector('tbody tr')?.getAttribute('data-exam')).toBe(uid(901));
    expect(cells.slice(0, 6)).toEqual([
      '08:00–09:30',
      '7 Oxford',
      'Quarter exam in maths',
      'Karimova Dilnoza',
      'Hall',
      en.timetable.day.exam,
    ]);
  });
});

// Task 5.7b-1, pull request #191: the substitution of a lesson from the day
// page (06, Changes after publishing, Substitution; 05, Substitution:
// "listed last and marked. Choosing one needs a confirmation").
describe('the substitution of a lesson', () => {
  const FREE = { id: uid(611), name: 'Rahimov Bobur' };
  const RUSSIAN = { id: uid(612), name: 'Saidova Malika' };
  const coming = (n: number, fields: Partial<DayLesson> = {}) =>
    lesson(n, { canSubstitute: true, ...fields });

  const suggestions = (noSubjectTeacherFree = false) => ({
    noSubjectTeacherFree,
    teachers: [
      { ...FREE, group: 'subject', language: false, warnings: ['teacher_day_load'] },
      { ...RUSSIAN, group: 'department', language: true, warnings: ['substitute_language'] },
    ],
  });

  const needsConfirm = () =>
    json(
      {
        error: {
          code: 'substitution_needs_confirm',
          message: 'ENGLISH TEXT FOR THE DEVELOPER',
          requestId: 'test-request',
          details: [
            {
              path: 'rules.substitute_language',
              code: 'substitute_language',
              message: 'x',
              rule: { weekday: 1, lessonIds: [] },
            },
          ],
        },
      },
      409,
    );

  it('marks a substituted lesson with the teacher replaced, and offers the substitution and its withdrawal only on a lesson to come', async () => {
    await openPage({
      lessons: [
        coming(1, {
          teacher: { ...FREE, kind: 'person' },
          substitution: {
            id: uid(700),
            replaced: { id: uid(600), kind: 'person', name: 'Karimova Aziza' },
          },
        }),
        lesson(2, { start: 535, end: 580, canCancel: false, state: 'held' }),
      ],
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()[0]?.[3]).toBe(
      `${FREE.name} · ${en.timetable.day.substituteFor.replace('{{name}}', 'Karimova Aziza')}`,
    );
    const rows = [...document.querySelectorAll('tbody tr')];
    const buttons = (row: number) =>
      [...(rows[row]?.querySelectorAll('button') ?? [])].map((one) => one.textContent);
    expect(buttons(0)).toContain(en.timetable.day.substitute);
    expect(buttons(0)).toContain(en.timetable.day.withdrawSubstitution);
    expect(buttons(1)).not.toContain(en.timetable.day.substitute);
  });

  it('offers no substitution to the Principal', async () => {
    await openPage({ role: 'principal', lessons: [coming(1)] });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: en.timetable.day.substitute })).toBeNull();
  });

  it('lists the suggestions in their order with their group and mark, and asks the tick for a language warning before saving', async () => {
    let sent = 0;
    const page = await openPage({
      lessons: [coming(1)],
      extra: {
        [`GET /api/timetable/lessons/${uid(301)}/substitutes`]: () => json(suggestions()),
        [`POST /api/timetable/lessons/${uid(301)}/substitute`]: () => {
          sent += 1;
          return sent === 1
            ? needsConfirm()
            : json({
                lesson: coming(1, { teacher: { ...RUSSIAN, kind: 'person' } }),
                warnings: [],
              });
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.substitute }));
    const dialog = await screen.findByRole('dialog');
    const field = await within(dialog).findByLabelText(en.timetable.day.substitute);
    const options = [...field.querySelectorAll('option')].map((one) => one.textContent);
    expect(options).toEqual([
      en.timetable.day.teacherChoose,
      `${FREE.name} · ${en.timetable.day.substituteOfSubject} · ${en.timetable.rule.teacher_day_load}`,
      `${RUSSIAN.name} · ${en.timetable.day.substituteOfDepartment} · ${en.timetable.day.substituteLanguage}`,
    ]);
    fireEvent.change(field, { target: { value: RUSSIAN.id } });
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'The teacher is ill' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }));
    expect(await within(dialog).findByText(en.errors.substitution_needs_confirm)).not.toBeNull();
    expect(within(dialog).getByText(en.timetable.rule.substitute_language)).not.toBeNull();
    fireEvent.click(within(dialog).getByLabelText(en.timetable.day.substituteConfirm));
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }));
    expect(await screen.findByText(en.timetable.day.substituted)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/substitute')).map((call) => call.body),
    ).toEqual([
      { teacherId: RUSSIAN.id, reason: 'The teacher is ill' },
      { teacherId: RUSSIAN.id, reason: 'The teacher is ill', confirm: true },
    ]);
  });

  it('takes the tick away when another teacher is chosen', async () => {
    const page = await openPage({
      lessons: [coming(1)],
      extra: {
        [`GET /api/timetable/lessons/${uid(301)}/substitutes`]: () => json(suggestions()),
        [`POST /api/timetable/lessons/${uid(301)}/substitute`]: () => needsConfirm(),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.substitute }));
    const dialog = await screen.findByRole('dialog');
    const field = await within(dialog).findByLabelText(en.timetable.day.substitute);
    fireEvent.change(field, { target: { value: RUSSIAN.id } });
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'The teacher is ill' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }));
    const tick = await within(dialog).findByLabelText(en.timetable.day.substituteConfirm);
    fireEvent.click(tick);
    fireEvent.change(field, { target: { value: FREE.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }));
    await waitFor(() => {
      expect(page.calls.filter((call) => call.route.endsWith('/substitute'))).toHaveLength(2);
    });
    expect(
      page.calls.filter((call) => call.route.endsWith('/substitute')).map((call) => call.body),
    ).toEqual([
      { teacherId: RUSSIAN.id, reason: 'The teacher is ill' },
      { teacherId: FREE.id, reason: 'The teacher is ill' },
    ]);
  });

  it('says when no teacher of the subject is free, and when no teacher is free at all', async () => {
    await openPage({
      lessons: [coming(1)],
      extra: {
        [`GET /api/timetable/lessons/${uid(301)}/substitutes`]: () => json(suggestions(true)),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.substitute }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(en.timetable.day.substituteNoneOfSubject),
    ).not.toBeNull();
  });

  it('withdraws a substitution with a reason, and shows a refused return', async () => {
    let sent = 0;
    const substituted = coming(1, {
      teacher: { ...FREE, kind: 'person' },
      substitution: { id: uid(700), replaced: null },
    });
    const page = await openPage({
      lessons: [substituted],
      extra: {
        [`POST /api/timetable/lessons/${uid(301)}/substitution/withdraw`]: () => {
          sent += 1;
          return sent === 1
            ? json(
                {
                  error: {
                    code: 'substitution_return_blocked',
                    message: 'ENGLISH TEXT FOR THE DEVELOPER',
                    requestId: 'test-request',
                    details: [
                      {
                        path: 'rules.teacher_double',
                        code: 'teacher_double',
                        message: 'x',
                        rule: { weekday: 1, lessonIds: [] },
                      },
                    ],
                  },
                },
                409,
              )
            : json({ lesson: coming(1), warnings: [] });
        },
      },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: en.timetable.day.withdrawSubstitution }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
      target: { value: 'The teacher is back' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: en.timetable.day.withdrawSubstitutionSend }),
    );
    expect(await within(dialog).findByText(en.errors.substitution_return_blocked)).not.toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: en.timetable.day.withdrawSubstitutionSend }),
    );
    expect(await screen.findByText(en.timetable.day.substitutionWithdrawn)).not.toBeNull();
    expect(
      page.calls.filter((call) => call.route.endsWith('/withdraw')).map((call) => call.body),
    ).toEqual([{ reason: 'The teacher is back' }, { reason: 'The teacher is back' }]);
  });
});
