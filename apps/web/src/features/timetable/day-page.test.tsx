import type { DayAnswer, DayLesson, SchoolClass } from '@sodiq/shared';
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
  cancelReason: null,
  changed: false,
  canCancel: true,
  canRestore: false,
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
    extra?: Record<string, (body: unknown) => Response>;
  } = {},
) {
  let lessons = options.lessons ?? [lesson(1)];
  const day = (): DayAnswer => ({
    date: '2026-10-12',
    classId: OXFORD.id,
    today: '2026-10-10',
    lessons,
  });
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session(options.role ?? 'academic_vice_principal')),
    'GET /api/timetable/versions': () => json({ versions: [], today: '2026-10-10' }),
    'GET /api/classes': () => json({ classes: [OXFORD] }),
    'GET /api/timetable/day': () => json(day()),
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

  it('shows no actions to the Principal', async () => {
    await openPage({ role: 'principal' });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: en.timetable.day.cancel })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: en.timetable.day.actions })).toBeNull();
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
});
