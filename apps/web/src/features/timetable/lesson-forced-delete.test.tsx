import type { DayAnswer, DayLesson, ForcedDelete, LessonHistory, SchoolClass } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.8b, pull request #195: the Super Admin's
// forced delete of a lesson from the day of a class, and the history of a
// lesson (06, Protection: "Forced delete is for Super Admin only, with a typed
// reason." "Every change records who, when, the value before and the value
// after.").
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

const LESSON: DayLesson = {
  id: uid(301),
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
};

const STORED: ForcedDelete = {
  id: uid(900),
  recordType: 'lesson',
  lesson: {
    id: LESSON.id,
    date: '2026-10-12',
    startsAt: '2026-10-12T03:00:00.000Z',
    endsAt: '2026-10-12T03:45:00.000Z',
    start: 480,
    end: 525,
    unit: LESSON.unit,
    subject: LESSON.subject,
    teacher: { id: uid(600), name: 'Karimova Aziza' },
    room: { id: uid(400), name: 'Room 12' },
    cancelCause: null,
  },
  reason: 'Entered for the wrong class',
  deletedBy: { id: uid(700), name: 'Yusupova Nodira' },
  deletedAt: '2026-10-10T18:55:00.000Z',
  restoreUntil: '2026-11-09T18:55:00.000Z',
  restoredAt: null,
  restoredBy: null,
  restorable: true,
};

const HISTORY: LessonHistory = {
  lines: [
    {
      id: uid(800),
      kind: 'changed',
      changedAt: '2026-10-09T10:00:00.000Z',
      who: { id: uid(700), name: 'Yusupova Nodira' },
      teacher: {
        before: { id: uid(600), name: 'Karimova Aziza' },
        after: { id: uid(601), name: 'Saidova Dilnoza' },
      },
      room: { before: { id: uid(400), name: 'Room 12' }, after: { id: uid(400), name: 'Room 12' } },
      date: { before: '2026-10-12', after: '2026-10-12' },
      startsAt: { before: '2026-10-12T03:00:00.000Z', after: '2026-10-12T03:00:00.000Z' },
      endsAt: { before: '2026-10-12T03:45:00.000Z', after: '2026-10-12T03:45:00.000Z' },
      cancelCause: { before: null, after: null },
      cancelReason: { before: null, after: null },
    },
    {
      id: uid(801),
      kind: 'changed',
      changedAt: '2026-10-09T11:00:00.000Z',
      who: null,
      teacher: {
        before: { id: uid(601), name: 'Saidova Dilnoza' },
        after: { id: uid(601), name: 'Saidova Dilnoza' },
      },
      room: { before: { id: uid(400), name: 'Room 12' }, after: { id: uid(400), name: 'Room 12' } },
      date: { before: '2026-10-12', after: '2026-10-12' },
      startsAt: { before: '2026-10-12T03:00:00.000Z', after: '2026-10-12T03:00:00.000Z' },
      endsAt: { before: '2026-10-12T03:45:00.000Z', after: '2026-10-12T03:45:00.000Z' },
      cancelCause: { before: null, after: 'reason' },
      cancelReason: { before: null, after: 'Excursion' },
    },
  ],
};

type Role = 'super_admin' | 'academic_vice_principal' | 'principal';

const session = (role: Role, language: 'en' | 'ru') =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH],
    language,
  });

async function openDay(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
) {
  let lessons = [LESSON];
  const day = (): DayAnswer => ({
    date: '2026-10-12',
    classId: OXFORD.id,
    slots: [{ lessonNumber: 1, start: 480, end: 525 }],
    longestDay: 1,
    today: '2026-10-10',
    lessons,
    exams: [],
  });
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session(role, language)),
    'GET /api/timetable/versions': () => json({ versions: [], today: '2026-10-10' }),
    'GET /api/classes': () => json({ classes: [OXFORD] }),
    'GET /api/timetable/day': () => json(day()),
    'GET /api/setup/rooms': () => json({ rooms: [] }),
    ...extra,
  });
  renderApp(`/timetable/day?date=2026-10-12&class=${OXFORD.id}`, language);
  const texts = language === 'en' ? en : ru;
  await screen.findByRole('heading', { name: texts.timetable.day.title });
  return {
    calls,
    clear: () => {
      lessons = [];
    },
  };
}

describe('the forced delete of a lesson on the day page', () => {
  it('lets the Super Admin delete a lesson for good with a reason, refusing an empty one before any call', async () => {
    const page = await openDay('super_admin', {
      [`POST /api/timetable/lessons/${LESSON.id}/forced-delete`]: () => {
        page.clear();
        return json(STORED);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.forcedDelete }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.forcedDeletes.send }));
    expect(await within(dialog).findByText(en.forcedDeletes.reasonNeeded)).not.toBeNull();
    expect(page.calls.filter((call) => call.route.endsWith('/forced-delete'))).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(en.forcedDeletes.reason), {
      target: { value: 'Entered for the wrong class' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.forcedDeletes.send }));
    expect(await screen.findByText(en.timetable.forcedDelete.done)).not.toBeNull();
    const sent = page.calls.filter((call) => call.route.endsWith('/forced-delete'));
    expect(sent.map((call) => call.body)).toEqual([{ reason: 'Entered for the wrong class' }]);
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(0);
    });
  });

  it('offers no forced delete to the Academic Vice Principal or the Principal', async () => {
    for (const role of ['academic_vice_principal', 'principal'] as const) {
      await openDay(role);
      await waitFor(() => {
        expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
      });
      expect(screen.queryByRole('button', { name: en.timetable.day.forcedDelete })).toBeNull();
      document.body.innerHTML = '';
    }
  });

  it('shows the history of a lesson to the Principal: who, before and after, the system for a job', async () => {
    await openDay('principal', {
      [`GET /api/timetable/lessons/${LESSON.id}/history`]: () => json(HISTORY),
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.history }));
    const dialog = await screen.findByRole('dialog');
    const lines = await within(dialog).findAllByRole('listitem');
    const top = [...dialog.querySelectorAll('ol > li')];
    expect(top).toHaveLength(2);
    expect(top[0]?.textContent).toContain('Yusupova Nodira');
    expect(top[0]?.textContent).toContain('Teacher: Karimova Aziza → Saidova Dilnoza');
    expect(top[0]?.textContent).not.toContain('Room:');
    expect(top[1]?.textContent).toContain(en.timetable.lessonHistory.system);
    expect(top[1]?.textContent).toContain('Cancelled: Excursion');
    expect(lines.length).toBeGreaterThan(2);
  });

  it('names an account without a name "No name", never a blank', async () => {
    const first = HISTORY.lines[0];
    if (first === undefined) throw new Error('No line.');
    await openDay('principal', {
      [`GET /api/timetable/lessons/${LESSON.id}/history`]: () =>
        json({ lines: [{ ...first, who: { id: uid(700), name: '' } }] }),
    });
    fireEvent.click(await screen.findByRole('button', { name: en.timetable.day.history }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findAllByRole('listitem');
    const [line] = [...dialog.querySelectorAll('ol > li')];
    expect(line?.textContent).toContain(en.audit.unnamed);
    expect(line?.textContent).not.toContain(' · ,');
  });

  it('shows the history in Russian', async () => {
    await openDay(
      'principal',
      { [`GET /api/timetable/lessons/${LESSON.id}/history`]: () => json(HISTORY) },
      'ru',
    );
    fireEvent.click(await screen.findByRole('button', { name: ru.timetable.day.history }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.querySelectorAll('ol > li')).toHaveLength(2);
    });
    expect(dialog.querySelector('ol > li')?.textContent).toContain(
      'Учитель: Karimova Aziza → Saidova Dilnoza',
    );
  });
});
