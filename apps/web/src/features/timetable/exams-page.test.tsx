import type {
  DayLesson,
  Exam,
  ExamCheck,
  Room,
  SchoolClass,
  StaffListItem,
  Subject,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.6c-2, pull request #182: the exams of a
// date, the form with the check of its save, and the cancel (06, Changes
// after publishing, Exam; edge/timetable, Exams).
const DATE = '2026-10-19';
const texts = en.timetable.exams;

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

const room = (n: number, name: string): Room => ({
  id: uid(400 + n),
  name,
  floorId: uid(450),
  floorName: 'First',
  buildingId: uid(451),
  buildingName: 'Main',
  type: 'classroom',
  capacity: 30,
  status: 'in_use',
  shared: false,
  maxSimultaneousLessons: null,
});

const HALL = room(0, 'Hall');
const ROOM_14 = room(1, 'Room 14');

const MATHS: Subject = {
  departmentSince: null,
  departmentMove: null,
  id: uid(200),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  departmentId: uid(210),
  grades: [7],
  colour: 'blue',
  journalType: 'attendance_only',
  ratingExam: false,
  groupSubject: false,
  languageRule: true,
  demanding: false,
  archivedAt: null,
  daily: null,
  quarterWeightsMissing: null,
  quarterCount: null,
};

const INVIGILATOR: StaffListItem = {
  id: uid(600),
  staffId: 'S-000600',
  firstName: 'Bekzod',
  lastName: 'Nazarov',
  fatherName: null,
  categories: ['teacher'],
  branches: [{ branchId: NORTH.id, name: NORTH.name, main: true }],
  divisions: [],
  subjects: [],
  languages: ['uz'],
  phone: '+998901234567',
  status: 'active',
  planned: null,
  photoId: null,
};

const lesson = (n: number, fields: Partial<DayLesson> = {}): DayLesson => ({
  id: uid(300 + n),
  date: DATE,
  start: 480,
  end: 525,
  unit: { kind: 'class', id: OXFORD.id, name: '7 Oxford' },
  subject: { id: MATHS.id, names: MATHS.names },
  teacher: { id: uid(610), kind: 'person', name: 'Karimova Aziza' },
  room: { id: uid(402), name: 'Room 12' },
  cancelCause: null,
  cancelReason: null,
  changed: false,
  canCancel: true,
  canRestore: false,
  state: 'upcoming',
  canCorrect: false,
  ...fields,
});

const EXAM: Exam = {
  id: uid(900),
  date: DATE,
  firstLesson: 1,
  lastLesson: 1,
  start: 480,
  end: 525,
  title: 'Quarter exam in maths',
  subject: { id: MATHS.id, names: MATHS.names },
  rooms: [
    {
      room: { id: HALL.id, name: HALL.name },
      classes: [{ id: OXFORD.id, name: '7 Oxford' }],
      groups: [],
      invigilators: [{ id: INVIGILATOR.id, name: 'Nazarov Bekzod' }],
    },
  ],
  cancelled: false,
  started: false,
  lessonIds: [uid(301)],
};

const SHARED_BLOCK = uid(700);

const checkOf = (fields: Partial<ExamCheck>): ExamCheck => ({
  cancels: [],
  choices: [],
  blocked: [],
  warnings: [],
  givenBack: [],
  freeRooms: [],
  canSave: true,
  ...fields,
});

const sharedChoice = (choice: 'cancel' | 'keep' | null): ExamCheck['choices'][number] => ({
  classId: OXFORD.id,
  className: '7 Oxford',
  blockId: SHARED_BLOCK,
  lessons: [lesson(2, { unit: { kind: 'group', id: uid(120), name: '7-8 Art' } })],
  otherClasses: ['8 Cambridge'],
  choice,
  stored: null,
});

const rule = (code: string, lessonIds: string[]) => ({
  path: `rules.${code}`,
  code,
  message: 'A rule.',
  rule: { weekday: 1 as const, lessonIds },
  day: DATE,
});

type Role = 'academic_vice_principal' | 'principal';

async function openPage(
  options: {
    role?: Role;
    exams?: Exam[];
    path?: string;
    check?: (body: unknown) => Response;
    extra?: Record<string, (body: unknown) => Response>;
  } = {},
) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          assignments: [{ role: options.role ?? 'academic_vice_principal', branchId: NORTH.id }],
          branches: [NORTH],
          language: 'en',
        }),
      ),
    'GET /api/timetable/versions': () => json({ versions: [], today: DATE }),
    'GET /api/timetable/exams': () => json({ exams: options.exams ?? [EXAM] }),
    'GET /api/classes': () => json({ classes: [OXFORD] }),
    'GET /api/groups': () => json({ groups: [] }),
    'GET /api/people/staff': () => json({ staff: [INVIGILATOR], today: DATE }),
    'GET /api/setup/rooms': () => json({ rooms: [HALL, ROOM_14] }),
    'GET /api/setup/subjects': () => json({ subjects: [MATHS], mayMoveDepartment: false }),
    'GET /api/timetable/day': () =>
      json({
        date: DATE,
        classId: OXFORD.id,
        slots: [
          { lessonNumber: 1, start: 480, end: 525 },
          { lessonNumber: 2, start: 535, end: 580 },
        ],
        longestDay: 2,
        today: DATE,
        lessons: [lesson(1)],
        exams: [],
      }),
    'POST /api/timetable/exams/check': options.check ?? (() => json(checkOf({}))),
    ...options.extra,
  });
  renderApp(options.path ?? `/timetable/exams?date=${DATE}`, 'en');
  await screen.findByRole('heading', { name: texts.title });
  return calls;
}

/** Fills the form of a new exam: title, the class and the invigilator in room 1, lesson 1. */
async function fillNew(dialog: HTMLElement) {
  fireEvent.change(await within(dialog).findByLabelText(texts.examTitle), {
    target: { value: 'Quarter exam in maths' },
  });
  fireEvent.change(within(dialog).getByLabelText(texts.room), { target: { value: HALL.id } });
  fireEvent.click(within(dialog).getByLabelText('7 Oxford'));
  fireEvent.click(await within(dialog).findByLabelText('Nazarov Bekzod'));
  fireEvent.change(await within(dialog).findByLabelText(texts.firstLesson), {
    target: { value: '1' },
  });
  fireEvent.change(within(dialog).getByLabelText(texts.lastLesson), { target: { value: '1' } });
}

const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: texts.save });

const checksOf = (calls: { route: string; body: unknown }[]) =>
  calls.filter((one) => one.route === 'POST /api/timetable/exams/check').map((one) => one.body);

describe('the exams page (task 5.6c-2)', () => {
  it('lists the exams of the date from the address, with no actions for a reader (plan test 12)', async () => {
    await openPage({ role: 'principal', path: `/timetable/exams?date=${DATE}&open=${EXAM.id}` });
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    });
    const cells = [...document.querySelectorAll('tbody tr td')].map((one) => one.textContent);
    expect(cells).toContain('Quarter exam in maths');
    expect(cells).toContain('Hall: 7 Oxford');
    expect(cells).toContain(texts.standing);
    expect(screen.queryByRole('button', { name: texts.new })).toBeNull();
    const panel = await waitFor(() => {
      const found = document.querySelector(`[data-exam-panel="${EXAM.id}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(panel).queryByRole('button', { name: texts.change })).toBeNull();
  });

  it('says when a date has no exams and offers a new one; a failed list offers a retry (plan test 12)', async () => {
    await openPage({ exams: [] });
    expect(await screen.findByText(texts.emptyTitle)).not.toBeNull();
    expect(screen.getAllByRole('button', { name: texts.new }).length).toBeGreaterThan(0);
  });

  it('offers no change or cancel of a started exam (plan test 12)', async () => {
    await openPage({
      exams: [{ ...EXAM, started: true }],
      path: `/timetable/exams?date=${DATE}&open=${EXAM.id}`,
    });
    const panel = await waitFor(() => {
      const found = document.querySelector(`[data-exam-panel="${EXAM.id}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(panel).getByText(new RegExp(texts.started))).not.toBeNull();
    expect(within(panel).queryByRole('button', { name: texts.change })).toBeNull();
    expect(within(panel).queryByRole('button', { name: texts.cancel })).toBeNull();
  });

  it('offers the lesson slots only once a class is chosen (plan test 13a)', async () => {
    await openPage({ exams: [] });
    fireEvent.click(screen.getAllByRole('button', { name: texts.new })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(texts.chooseClassFirst)).not.toBeNull();
    expect(within(dialog).queryByLabelText(texts.firstLesson)).toBeNull();
    fireEvent.click(within(dialog).getByLabelText('7 Oxford'));
    const first = await within(dialog).findByLabelText(texts.firstLesson);
    expect([...first.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      en.timetable.day.slotChoose,
      'Lesson 1, 08:00–08:45',
      'Lesson 2, 08:55–09:40',
    ]);
  });

  it('checks a new exam, asks a choice for a shared block, asks again on the choice, and saves with the choice and the tick (plan test 13; done when)', async () => {
    const calls = await openPage({
      exams: [],
      check: (body) => {
        const chosen = (body as { blockChoices: { choice: string }[] }).blockChoices[0];
        if (chosen === undefined) {
          return json(
            checkOf({
              cancels: [lesson(1)],
              choices: [sharedChoice(null)],
              blocked: null,
              warnings: null,
              givenBack: null,
              canSave: false,
            }),
          );
        }
        return json(
          checkOf({
            cancels: [lesson(1)],
            choices: [sharedChoice('keep')],
            warnings: [rule('room_capacity', [])],
          }),
        );
      },
      extra: {
        'POST /api/timetable/exams': () =>
          json({ exam: { ...EXAM, id: uid(901) }, warnings: ['room_capacity'] }, 201),
      },
    });
    fireEvent.click(screen.getAllByRole('button', { name: texts.new })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await fillNew(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: texts.check }));
    const shared = await waitFor(() => {
      const found = dialog.querySelector(`[data-shared="${SHARED_BLOCK}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(dialog.querySelector('[data-exam-cancels] li')?.textContent).toContain('7 Oxford');
    expect(within(dialog).getByText(texts.chooseEach)).not.toBeNull();
    expect(saveButton(dialog)).toHaveProperty('disabled', true);
    fireEvent.click(within(shared).getByLabelText(texts.choice_keep));
    // The choice asks the check again; its warnings need the tick.
    await waitFor(() => {
      expect(dialog.querySelector('[data-exam-warnings]')).not.toBeNull();
    });
    expect(saveButton(dialog)).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByLabelText(texts.tick));
    await waitFor(() => {
      expect(saveButton(dialog)).toHaveProperty('disabled', false);
    });
    fireEvent.click(saveButton(dialog));
    expect(await screen.findByText(texts.created)).not.toBeNull();
    expect(checksOf(calls)).toHaveLength(2);
    expect(checksOf(calls)[1]).toMatchObject({
      blockChoices: [{ classId: OXFORD.id, blockId: SHARED_BLOCK, choice: 'keep' }],
    });
    const created = calls.find((one) => one.route === 'POST /api/timetable/exams');
    expect(created?.body).toEqual({
      date: DATE,
      firstLesson: 1,
      lastLesson: 1,
      title: 'Quarter exam in maths',
      subjectId: null,
      rooms: [
        { roomId: HALL.id, classIds: [OXFORD.id], groupIds: [], invigilatorIds: [INVIGILATOR.id] },
      ],
      blockChoices: [{ classId: OXFORD.id, blockId: SHARED_BLOCK, choice: 'keep' }],
      confirm: true,
    });
  });

  it('keeps Save off while a "keep" brings a blocked line, naming the rule; "cancel" frees it (plan tests 13b and 14)', async () => {
    await openPage({
      exams: [],
      check: (body) => {
        const chosen = (body as { blockChoices: { choice: string }[] }).blockChoices[0];
        if (chosen === undefined) {
          return json(
            checkOf({
              choices: [sharedChoice(null)],
              blocked: null,
              warnings: null,
              givenBack: null,
              canSave: false,
            }),
          );
        }
        return json(
          chosen.choice === 'keep'
            ? checkOf({
                choices: [sharedChoice('keep')],
                blocked: [rule('teacher_double', [uid(302)])],
                givenBack: null,
                canSave: false,
              })
            : checkOf({ choices: [sharedChoice('cancel')] }),
        );
      },
    });
    fireEvent.click(screen.getAllByRole('button', { name: texts.new })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await fillNew(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: texts.check }));
    const shared = await waitFor(() => {
      const found = dialog.querySelector(`[data-shared="${SHARED_BLOCK}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(within(shared).getByLabelText(texts.choice_keep));
    const blocked = await waitFor(() => {
      const found = dialog.querySelector('[data-exam-blocked]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(blocked.querySelector('li')?.textContent).not.toBe('');
    expect(saveButton(dialog)).toHaveProperty('disabled', true);
    fireEvent.click(
      within(dialog.querySelector(`[data-shared="${SHARED_BLOCK}"]`) as HTMLElement).getByLabelText(
        texts.choice_cancel,
      ),
    );
    await waitFor(() => {
      expect(dialog.querySelector('[data-exam-blocked]')).toBeNull();
    });
    await waitFor(() => {
      expect(saveButton(dialog)).toHaveProperty('disabled', false);
    });
  });

  it('takes the tick away when the check answers other warnings (spec review of the code, must-fix 2)', async () => {
    await openPage({
      exams: [],
      check: (body) => {
        const chosen = (body as { blockChoices: { choice: string }[] }).blockChoices[0];
        if (chosen === undefined) {
          return json(
            checkOf({
              choices: [sharedChoice(null)],
              blocked: null,
              warnings: null,
              givenBack: null,
              canSave: false,
            }),
          );
        }
        return json(
          checkOf({
            choices: [sharedChoice(chosen.choice === 'keep' ? 'keep' : 'cancel')],
            warnings: [
              rule(chosen.choice === 'keep' ? 'room_capacity' : 'invigilator_subject', []),
            ],
          }),
        );
      },
    });
    fireEvent.click(screen.getAllByRole('button', { name: texts.new })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await fillNew(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: texts.check }));
    const sharedOf = () => dialog.querySelector(`[data-shared="${SHARED_BLOCK}"]`) as HTMLElement;
    await waitFor(() => {
      expect(sharedOf()).not.toBeNull();
    });
    fireEvent.click(within(sharedOf()).getByLabelText(texts.choice_keep));
    await waitFor(() => {
      expect(dialog.querySelector('[data-exam-warnings]')).not.toBeNull();
    });
    fireEvent.click(within(dialog).getByLabelText(texts.tick));
    await waitFor(() => {
      expect(saveButton(dialog)).toHaveProperty('disabled', false);
    });
    fireEvent.click(within(sharedOf()).getByLabelText(texts.choice_cancel));
    await waitFor(() => {
      expect(within(dialog).getByLabelText(texts.tick)).toHaveProperty('checked', false);
    });
    expect(saveButton(dialog)).toHaveProperty('disabled', true);
  });

  it('changes an exam: a lesson given back that cannot come back is kept cancelled with a reason (plan test 15)', async () => {
    const blockedLesson = lesson(5, { cancelCause: 'exam', state: 'cancelled' });
    const calls = await openPage({
      path: `/timetable/exams?date=${DATE}&open=${EXAM.id}`,
      check: (body) => {
        const kept = (body as { keepCancelled?: string[] }).keepCancelled ?? [];
        return json(
          checkOf({
            givenBack: [
              {
                lesson: blockedLesson,
                state: kept.length === 0 ? 'blocked' : 'kept',
                rules: [rule('room_double', [blockedLesson.id])],
              },
            ],
            freeRooms: [{ id: ROOM_14.id, name: ROOM_14.name }],
            canSave: kept.length > 0,
          }),
        );
      },
      extra: {
        [`PUT /api/timetable/exams/${EXAM.id}`]: () => json({ exam: EXAM, warnings: [] }),
      },
    });
    const panel = await waitFor(() => {
      const found = document.querySelector(`[data-exam-panel="${EXAM.id}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(within(panel).getByRole('button', { name: texts.change }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(texts.firstLesson);
    fireEvent.click(within(dialog).getByRole('button', { name: texts.check }));
    const given = await waitFor(() => {
      const found = dialog.querySelector('[data-exam-given-back="true"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(given.querySelector('[data-given-back="blocked"]')).not.toBeNull();
    expect(given.querySelector('[data-free-rooms]')?.textContent).toContain('Room 14');
    expect(saveButton(dialog)).toHaveProperty('disabled', true);
    fireEvent.click(within(given).getByLabelText(texts.keep));
    await waitFor(() => {
      expect(dialog.querySelector('[data-given-back="kept"]')).not.toBeNull();
    });
    // A reason is needed before the save.
    expect(saveButton(dialog)).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText(texts.keepReason), {
      target: { value: 'The room is taken' },
    });
    await waitFor(() => {
      expect(saveButton(dialog)).toHaveProperty('disabled', false);
    });
    fireEvent.click(saveButton(dialog));
    expect(await screen.findByText(texts.changed)).not.toBeNull();
    expect(checksOf(calls)[0]).toMatchObject({ examId: EXAM.id });
    expect(checksOf(calls)[1]).toMatchObject({ keepCancelled: [blockedLesson.id] });
    const changed = calls.find((one) => one.route === `PUT /api/timetable/exams/${EXAM.id}`);
    expect(changed?.body).toMatchObject({
      title: EXAM.title,
      subjectId: MATHS.id,
      keepCancelled: [blockedLesson.id],
      keepReason: 'The room is taken',
      confirm: false,
    });
    expect(changed?.body).not.toHaveProperty('examId');
  });

  it('cancels an exam keeping a lesson that cannot come back cancelled with a reason, the free rooms named (plan test 16; done when)', async () => {
    let sent = 0;
    const calls = await openPage({
      path: `/timetable/exams?date=${DATE}&open=${EXAM.id}`,
      extra: {
        [`POST /api/timetable/exams/${EXAM.id}/cancel`]: () => {
          sent += 1;
          if (sent === 1) {
            return Response.json(
              {
                error: {
                  code: 'exam_restore_blocked',
                  message: 'ENGLISH TEXT FOR THE DEVELOPER',
                  requestId: 'test-request',
                  details: [
                    // The rule names the lesson that holds the time too.
                    rule('room_double', [uid(301), uid(399)]),
                    {
                      path: 'rooms',
                      code: 'room_free',
                      message: 'A room.',
                      room: { id: ROOM_14.id, name: ROOM_14.name },
                    },
                  ],
                },
              },
              { status: 409 },
            );
          }
          return json({ exam: { ...EXAM, cancelled: true }, warnings: [] });
        },
      },
    });
    const panel = await waitFor(() => {
      const found = document.querySelector(`[data-exam-panel="${EXAM.id}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(within(panel).getByRole('button', { name: texts.cancel }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: texts.cancelSend }));
    const blocked = await waitFor(() => {
      const found = dialog.querySelector('[data-exam-restore-blocked]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(blocked.textContent).toContain('Room 14');
    // The lesson kept cancelled is named (spec review of the code, must-fix 3).
    expect(dialog.querySelector('[data-exam-kept-lessons] li')?.textContent).toBe(
      '08:00–08:45 · 7 Oxford · Mathematics · Karimova Aziza',
    );
    fireEvent.change(within(dialog).getByLabelText(texts.keepReason), {
      target: { value: 'The room is taken' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: texts.cancelKeeping }));
    expect(await screen.findByText(texts.cancelledDone)).not.toBeNull();
    expect(calls.filter((one) => one.route.endsWith('/cancel')).map((one) => one.body)).toEqual([
      {},
      { keepCancelled: [uid(301)], keepReason: 'The room is taken' },
    ]);
  });
});
