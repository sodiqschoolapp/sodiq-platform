import type { TimetableView, ViewChoices, ViewDay, ViewLesson } from '@sodiq/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.9a, pull request #197: the read-only
// timetable views (06, Views and outputs; edge/timetable, Structure: "Teacher
// and room views use a clock axis when more than one template is in force").
const CHOICES: ViewChoices = {
  today: '2026-10-12',
  branch: true,
  classes: [{ id: uid(101), name: '7 Oxford' }],
  teachers: [{ id: uid(600), kind: 'person', name: 'Karimova Aziza' }],
  rooms: [],
  own: uid(600),
};

const lesson = (n: number, fields: Partial<ViewLesson> = {}): ViewLesson => ({
  id: uid(300 + n),
  date: '2026-10-12',
  start: 480,
  end: 525,
  unit: { kind: 'class', id: uid(101), name: '7 Oxford' },
  subject: { id: uid(200), names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } },
  teacher: { id: uid(600), kind: 'person', name: 'Karimova Aziza' },
  room: { id: uid(400), name: 'Room 12' },
  cancelCause: null,
  cancelReason: null,
  changed: false,
  state: 'upcoming',
  away: null,
  roomOut: null,
  substitution: null,
  classIds: [uid(101)],
  lessonNumber: 1,
  replacedHere: false,
  journalId: null,
  ...fields,
});

const day = (date: string, fields: Partial<ViewDay> = {}): ViewDay => ({
  date,
  outsideYear: false,
  dayOff: null,
  version: { number: 1, startsOn: '2026-10-05' },
  fromPattern: false,
  axis: 'slots',
  slots: [
    { lessonNumber: 1, start: 480, end: 525 },
    { lessonNumber: 2, start: 535, end: 580 },
  ],
  ...fields,
});

const viewOf = (fields: Partial<TimetableView>): TimetableView => ({
  kind: 'teacher',
  span: 'day',
  today: '2026-10-12',
  subject: { id: uid(600), name: 'Karimova Aziza' },
  classes: [],
  days: [day('2026-10-12')],
  lessons: [],
  exams: [],
  busy: [],
  ...fields,
});

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

async function openPage(
  view: TimetableView,
  options: { choices?: ViewChoices; address?: string; role?: 'tutor' | 'teacher' } = {},
) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          assignments: [{ role: options.role ?? 'tutor', branchId: NORTH.id }],
          branches: [NORTH],
          language: 'en',
        }),
      ),
    'GET /api/timetable/views/choices': () => json(options.choices ?? CHOICES),
    'GET /api/timetable/views/branch': () => json(view),
    'GET /api/timetable/views/class': () => json(view),
    'GET /api/timetable/views/teacher': () => json(view),
    'GET /api/timetable/views/room': () => json(view),
  });
  renderApp(options.address ?? '/timetable/views?kind=teacher', 'en');
  await screen.findByRole('heading', { name: en.timetable.views.title });
  return calls;
}

describe('the timetable views', () => {
  it('offers only the views the server allows', async () => {
    await openPage(viewOf({}));
    const group = await screen.findByRole('radiogroup', { name: en.timetable.views.kind });
    const labels = [...group.querySelectorAll('label')].map((one) => one.textContent);
    expect(labels).toEqual([
      en.timetable.views.kind_branch,
      en.timetable.views.kind_class,
      en.timetable.views.kind_teacher,
    ]);
  });

  it('lists a day with its marks in words, an exam and a busy block', async () => {
    await openPage(
      viewOf({
        lessons: [
          lesson(1, { changed: true }),
          lesson(2, {
            start: 535,
            end: 580,
            lessonNumber: 2,
            cancelCause: 'reason',
            cancelReason: 'School trip',
            state: 'cancelled',
          }),
        ],
        exams: [
          {
            id: uid(700),
            date: '2026-10-12',
            title: 'Quarter exam',
            subject: null,
            start: 590,
            end: 635,
            rooms: [
              {
                room: { id: uid(400), name: 'Room 12' },
                classIds: [uid(101)],
                units: ['7 Oxford'],
                invigilators: ['Karimova Aziza'],
              },
            ],
          },
        ],
        busy: [{ date: '2026-10-12', start: 700, end: 745, branch: { id: uid(9), name: 'South' } }],
      }),
    );
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(4);
    });
    const rows = rowsDrawn();
    expect(rows[0]?.[5]).toBe(en.timetable.day.changed);
    expect(rows[1]?.[5]).toBe('Cancelled: School trip');
    expect(rows[2]?.[5]).toBe(en.timetable.day.exam);
    expect(rows[3]?.[1]).toBe('Busy in South');
  });

  // Task 6.1b-1 (decision 2): a lesson kept for its data that a version no longer has.
  it("opens a lesson's journal at its date from the subject (task 6.2; 07, Opening a journal)", async () => {
    await openPage(
      viewOf({
        lessons: [lesson(1, { journalId: uid(900) }), lesson(2, { start: 535, end: 580 })],
      }),
      {
        role: 'teacher',
      },
    );
    const link = await screen.findByRole('link', { name: 'Mathematics' });
    expect(link.getAttribute('href')).toBe(`/journal/${uid(900)}?date=2026-10-12`);
    // A lesson with no journal names its subject without a link.
    expect(screen.getAllByRole('link', { name: 'Mathematics' })).toHaveLength(1);
  });

  it('marks a lesson kept for its data with its cause in words', async () => {
    await openPage(
      viewOf({ lessons: [lesson(1, { cancelCause: 'kept_data', state: 'cancelled' })] }),
    );
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[5]).toBe(en.timetable.day.cause_kept_data);
  });

  it('marks a lesson a substitute took on the replaced teacher’s view', async () => {
    await openPage(
      viewOf({
        lessons: [
          lesson(1, {
            teacher: { id: uid(601), kind: 'person', name: 'Saidova Dilnoza' },
            substitution: {
              id: uid(800),
              replaced: { id: uid(600), kind: 'person', name: 'Karimova Aziza' },
            },
            replacedHere: true,
          }),
        ],
      }),
    );
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[3]).toBe('Karimova Aziza');
    expect(rowsDrawn()[0]?.[5]).toBe('Replaced by Saidova Dilnoza');
  });

  it('names every version of a week with its "valid from"', async () => {
    await openPage(
      viewOf({
        span: 'week',
        kind: 'class',
        days: [
          day('2026-10-12'),
          day('2026-10-14', { version: { number: 2, startsOn: '2026-10-14' } }),
        ],
      }),
      { address: '/timetable/views?kind=class&span=week' },
    );
    const line = await waitFor(() => {
      const found = document.querySelector('[data-version-line]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(line?.textContent).toBe(
      'Version 1, valid from 5 October 2026 · Version 2, valid from 14 October 2026',
    );
  });

  it('draws a week by clock time when one of its days is on the clock axis (review correction 2)', async () => {
    await openPage(
      viewOf({
        span: 'week',
        days: [day('2026-10-12', { axis: 'clock', slots: [] }), day('2026-10-13')],
        lessons: [
          lesson(1),
          lesson(2, { date: '2026-10-12', start: 480, end: 520, lessonNumber: 1 }),
          lesson(3, { date: '2026-10-13' }),
        ],
      }),
      { address: '/timetable/views?kind=teacher&span=week' },
    );
    await waitFor(() => {
      expect(document.querySelector('[data-axis]')?.getAttribute('data-axis')).toBe('clock');
    });
    // Two rows of times, never one row of "Lesson 1" for both templates.
    expect(rowsDrawn().map((one) => one[0])).toEqual(['08:00–08:40', '08:00–08:45']);
  });

  it('draws a week by lesson numbers when every day has one template', async () => {
    await openPage(
      viewOf({
        span: 'week',
        days: [day('2026-10-12'), day('2026-10-13')],
        lessons: [lesson(1), lesson(3, { date: '2026-10-13' })],
      }),
      { address: '/timetable/views?kind=teacher&span=week' },
    );
    await waitFor(() => {
      expect(document.querySelector('[data-axis]')?.getAttribute('data-axis')).toBe('slots');
    });
    expect(rowsDrawn().map((one) => one[0])).toEqual(['Lesson 1', 'Lesson 2']);
  });

  it('lists the school by class and lesson number', async () => {
    await openPage(
      viewOf({
        kind: 'branch',
        subject: null,
        classes: [
          { id: uid(101), name: '7 Oxford' },
          { id: uid(102), name: '7 Cambridge' },
        ],
        lessons: [lesson(1)],
      }),
      { address: '/timetable/views?kind=branch' },
    );
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()[0]?.[0]).toBe('7 Oxford');
    expect(rowsDrawn()[0]?.[1]).toBe('Mathematics · Karimova Aziza · Room 12');
    expect(rowsDrawn()[1]?.[1]).toBe('');
  });

  it('says so when the role has nothing to view', async () => {
    await openPage(viewOf({}), {
      role: 'teacher',
      choices: { ...CHOICES, branch: false, classes: [], teachers: [], own: null },
    });
    expect(await screen.findByText(en.timetable.views.nothing)).toBeDefined();
  });
});

// Task 5.9c-1, pull request #199: Print, PDF and Excel of the view shown
// (06, Views and outputs). The server makes and logs every file.
describe('the timetable files', () => {
  const pdfAnswer = () =>
    new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="class-2026-10-12.pdf"; filename*=UTF-8''sinf-7-Oxford-2026-10-12.pdf`,
      },
    });

  const openWith = async (answer: () => Response) => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role: 'tutor', branchId: NORTH.id }],
            branches: [NORTH],
            language: 'en',
          }),
        ),
      'GET /api/timetable/views/choices': () => json(CHOICES),
      'GET /api/timetable/views/class': () => json(viewOf({ kind: 'class' })),
      'POST /api/timetable/views/export': () => answer(),
    });
    renderApp(`/timetable/views?kind=class&id=${uid(101)}&date=2026-10-12&span=week`, 'en');
    await screen.findByRole('button', { name: en.timetable.views.pdf });
    return calls;
  };

  const sent = (calls: { route: string; body: unknown }[]) =>
    calls.filter((one) => one.route === 'POST /api/timetable/views/export').map((one) => one.body);

  it('sends the view shown for the PDF and for Excel, with the id its kind takes', async () => {
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    try {
      const calls = await openWith(pdfAnswer);
      screen.getByRole('button', { name: en.timetable.views.pdf }).click();
      await waitFor(() => {
        expect(saved).toEqual(['sinf-7-Oxford-2026-10-12.pdf']);
      });
      screen.getByRole('button', { name: en.timetable.views.excel }).click();
      await waitFor(() => {
        expect(sent(calls)).toHaveLength(2);
      });
      expect(sent(calls)).toEqual([
        { kind: 'class', classId: uid(101), date: '2026-10-12', span: 'week', format: 'pdf' },
        { kind: 'class', classId: uid(101), date: '2026-10-12', span: 'week', format: 'xlsx' },
      ]);
    } finally {
      click.mockRestore();
      created.mockRestore();
      revoked.mockRestore();
    }
  });

  it('opens the tab for Print in the click and gives it the PDF once it comes', async () => {
    const tab = { location: { href: '' }, close: () => undefined };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:printout');
    try {
      const calls = await openWith(pdfAnswer);
      screen.getByRole('button', { name: en.timetable.views.print }).click();
      // Opened at once, before the server answered.
      expect(open.mock.calls).toEqual([['', '_blank']]);
      await waitFor(() => {
        expect(tab.location.href).toBe('blob:printout');
      });
      expect(sent(calls)).toEqual([
        { kind: 'class', classId: uid(101), date: '2026-10-12', span: 'week', format: 'pdf' },
      ]);
    } finally {
      open.mockRestore();
      created.mockRestore();
    }
  });

  it('closes the tab and says so when the server cannot make the PDF', async () => {
    let closed = 0;
    const tab = {
      location: { href: '' },
      close: () => {
        closed += 1;
      },
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    try {
      await openWith(() => refusal('pdf_unavailable', 503));
      screen.getByRole('button', { name: en.timetable.views.print }).click();
      expect(await screen.findByText(en.errors.pdf_unavailable)).toBeTruthy();
      expect(closed).toBe(1);
      expect(tab.location.href).toBe('');
    } finally {
      open.mockRestore();
    }
  });
});
