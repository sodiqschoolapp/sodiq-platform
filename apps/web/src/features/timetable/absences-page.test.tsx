import type { Absence, AbsenceLessons, StaffListItem } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.7a-1, pull request #185: the absences of
// the staff of the branch (06, Teachers who work in several branches:
// "An absence is entered once for the person and covers every branch").
const texts = en.timetable.absences;
const PATH = '/timetable/absences';

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });
const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const person = (n: number, firstName: string, lastName: string): StaffListItem => ({
  id: uid(600 + n),
  staffId: `S-26${String(n).padStart(4, '0')}`,
  firstName,
  lastName,
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
});

const AZIZA = person(1, 'Aziza', 'Karimova');
const BOBUR = person(2, 'Bobur', 'Aliyev');

const absence = (n: number, fields: Partial<Absence> = {}): Absence => ({
  id: uid(700 + n),
  staff: { id: AZIZA.id, name: 'Karimova Aziza' },
  startsOn: '2026-10-19',
  endsOn: null,
  reason: 'Ill',
  state: 'planned',
  canEdit: true,
  canWithdraw: true,
  ...fields,
});

const LESSONS: AbsenceLessons = {
  lessons: [
    {
      id: uid(800),
      date: '2026-10-19',
      start: 480,
      end: 525,
      unit: '7 Oxford',
      subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
      room: 'Room 12',
      state: 'needs_teacher',
      substitute: null,
      journalId: uid(900),
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
    absences?: Absence[];
    extra?: Record<string, (body: unknown) => Response>;
    language?: 'en' | 'ru';
  } = {},
) {
  const language = input.language ?? 'en';
  let list = input.absences ?? [absence(1)];
  const account = { ...(input.session ?? vice()), language };
  const calls = fakeApi({
    'GET /api/auth/session': () => json(account),
    'GET /api/timetable/absences': () => json({ absences: list }),
    'GET /api/people/staff': () => json({ staff: [AZIZA, BOBUR], today: '2026-10-10' }),
    'POST /api/timetable/absences': (body) => {
      const made = absence(9, {
        staff: { id: BOBUR.id, name: 'Aliyev Bobur' },
        ...(body as { startsOn: string; endsOn: string | null; reason: string }),
      });
      list = [...list, made];
      return json(made, 201);
    },
    [`GET /api/timetable/absences/${uid(701)}/lessons`]: () => json(LESSONS),
    [`PATCH /api/timetable/absences/${uid(701)}`]: (body) => {
      const changed = { ...absence(1), ...(body as object) };
      list = list.map((one) => (one.id === changed.id ? changed : one));
      return json(changed);
    },
    [`POST /api/timetable/absences/${uid(701)}/withdraw`]: () => {
      const gone = absence(1, { state: 'withdrawn', canEdit: false, canWithdraw: false });
      list = list.map((one) => (one.id === gone.id ? gone : one));
      return json(gone);
    },
    ...input.extra,
  });
  renderApp(PATH, language);
  const words = language === 'ru' ? (await import('@/i18n/locales/ru')).ru : en;
  await screen.findByRole('heading', { name: words.timetable.absences.title });
  if (list.length > 0) {
    await screen.findByRole('table', { name: words.timetable.absences.caption });
  }
  return calls;
}

describe('the absences page', () => {
  it('lists the absences with their days, reason and state', async () => {
    await openList({
      absences: [
        absence(1),
        absence(2, { endsOn: '2026-10-23', state: 'current', reason: 'Course' }),
      ],
    });
    expect(rowsDrawn()).toEqual([
      ['Karimova Aziza', '19 October 2026', texts.open, 'Ill', texts.state_planned],
      ['Karimova Aziza', '19 October 2026', '23 October 2026', 'Course', texts.state_current],
    ]);
  });

  it('names the states in Russian when Russian is chosen', async () => {
    const { ru } = await import('@/i18n/locales/ru');
    await openList({ language: 'ru' });
    expect(rowsDrawn()[0]).toContain(ru.timetable.absences.state_planned);
  });

  it('adds an absence for a person of the branch, open-ended, and sends the record', async () => {
    const calls = await openList();
    fireEvent.click(await screen.findByRole('button', { name: texts.add }));
    const form = within(
      await screen.findByRole('complementary', { name: texts.newTitle }),
    ).getByRole('form', { name: texts.newTitle });
    fireEvent.change(within(form).getByLabelText(texts.person), { target: { value: BOBUR.id } });
    fireEvent.change(within(form).getByLabelText(texts.firstDay), {
      target: { value: '2026-10-19' },
    });
    fireEvent.click(within(form).getByLabelText(texts.openEnded));
    expect(within(form).queryByLabelText(texts.lastDay)).toBeNull();
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Ill' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/timetable/absences')?.body).toEqual({
        staffId: BOBUR.id,
        startsOn: '2026-10-19',
        endsOn: null,
        reason: 'Ill',
      });
    });
  });

  it('shows the refusal of an overlap with what to do', async () => {
    await openList({
      extra: { 'POST /api/timetable/absences': () => refusal('absence_overlap', 409) },
    });
    fireEvent.click(await screen.findByRole('button', { name: texts.add }));
    const form = within(
      await screen.findByRole('complementary', { name: texts.newTitle }),
    ).getByRole('form', { name: texts.newTitle });
    fireEvent.change(within(form).getByLabelText(texts.person), { target: { value: AZIZA.id } });
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Ill' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.errors.absence_overlap)).toBeDefined();
  });

  it('opens an absence with the branch’s lessons in it, changes its last day and withdraws it after asking', async () => {
    const calls = await openList();
    fireEvent.click(screen.getByText('Karimova Aziza', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Karimova Aziza' });
    const lessons = await within(panel).findByRole('region', { name: texts.lessons });
    const [row] = [...lessons.querySelectorAll('tbody tr')].map((one) =>
      [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
    );
    expect(row).toEqual([
      '19 October',
      '08:00–08:45',
      '7 Oxford',
      'Mathematics',
      'Room 12',
      texts.state_needs_teacher,
      texts.noSubstitute,
      `${en.timetable.day.substitute}${texts.substituteJournal}`,
    ]);

    fireEvent.click(within(panel).getByRole('button', { name: texts.changeDates }));
    const form = within(panel).getByRole('form', { name: texts.changeDates });
    fireEvent.click(within(form).getByLabelText(texts.openEnded));
    fireEvent.change(within(form).getByLabelText(texts.lastDay), {
      target: { value: '2026-10-23' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PATCH /api/timetable/absences/${uid(701)}`)?.body,
      ).toEqual({ startsOn: '2026-10-19', endsOn: '2026-10-23' });
    });

    fireEvent.click(await within(panel).findByRole('button', { name: texts.withdraw }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(texts.withdrawTitle)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: texts.withdraw }));
    await waitFor(() => {
      expect(
        calls.some((call) => call.route === `POST /api/timetable/absences/${uid(701)}/withdraw`),
      ).toBe(true);
    });
  });

  it('keeps the first day of a started absence fixed and offers no withdraw', async () => {
    await openList({ absences: [absence(1, { state: 'current', canWithdraw: false })] });
    fireEvent.click(screen.getByText('Karimova Aziza', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Karimova Aziza' });
    expect(within(panel).queryByRole('button', { name: texts.withdraw })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: texts.changeDates }));
    const form = within(panel).getByRole('form', { name: texts.changeDates });
    expect(within(form).getByLabelText<HTMLInputElement>(texts.firstDay).disabled).toBe(true);
  });

  it('lets the Principal read with no way to add, change or withdraw', async () => {
    const calls = await openList({ session: principal() });
    expect(screen.queryByRole('button', { name: texts.add })).toBeNull();
    fireEvent.click(screen.getByText('Karimova Aziza', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Karimova Aziza' });
    await within(panel).findByRole('region', { name: texts.lessons });
    expect(within(panel).queryByRole('button', { name: texts.changeDates })).toBeNull();
    expect(within(panel).queryByRole('button', { name: texts.withdraw })).toBeNull();
    expect(within(panel).queryByRole('button', { name: texts.substituteJournal })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en.timetable.day.substitute })).toBeNull();
    expect(calls.some((call) => call.route === 'GET /api/people/staff')).toBe(false);
  });

  // Task 5.7b-2, pull request #192 (edge/timetable, After publishing: "One
  // substitute can be assigned per journal for the whole absence in one
  // action, each date still being checked. Shortening the absence returns
  // future lessons to the teacher.").
  describe('the substitution from the absence', () => {
    const journalPath = `/api/timetable/absences/${uid(701)}/journal-substitute`;
    const suggestions = {
      dates: ['2026-10-19', '2026-10-26'],
      teachers: [
        {
          id: BOBUR.id,
          name: 'Aliyev Bobur',
          group: 'subject',
          language: false,
          acting: false,
          dates: ['2026-10-19'],
          blockedDates: ['2026-10-26'],
        },
      ],
    };
    const needsTick = () =>
      json(
        {
          error: {
            code: 'substitution_needs_confirm',
            message: 'ENGLISH TEXT FOR THE DEVELOPER',
            requestId: 'test-request',
            details: [
              {
                path: 'rules.teacher_unavailable',
                code: 'teacher_unavailable',
                message: 'x',
                rule: { weekday: 1, lessonIds: [] },
                day: '2026-10-19',
              },
            ],
          },
        },
        409,
      );

    async function openJournalDialog(extra: Record<string, (body: unknown) => Response>) {
      const calls = await openList({
        extra: {
          [`GET /api/timetable/absences/${uid(701)}/journals/${uid(900)}/substitutes`]: () =>
            json(suggestions),
          ...extra,
        },
      });
      fireEvent.click(screen.getByText('Karimova Aziza', { selector: 'button' }));
      const panel = await screen.findByRole('complementary', { name: 'Karimova Aziza' });
      fireEvent.click(await within(panel).findByRole('button', { name: texts.substituteJournal }));
      const dialog = await screen.findByRole('dialog');
      return { calls, dialog };
    }

    it('substitutes one teacher for the journal, shows the dates the teacher cannot take, and lists what was saved and blocked', async () => {
      const { calls, dialog } = await openJournalDialog({
        [`POST ${journalPath}`]: () =>
          json({
            substitutionId: uid(950),
            saved: [{ lessonId: uid(800), date: '2026-10-19', relaxed: false }],
            blocked: [{ lessonIds: [uid(801)], date: '2026-10-26', rules: ['substitute_away'] }],
            taken: [],
          }),
      });
      const select = await within(dialog).findByLabelText(en.timetable.day.substitute);
      fireEvent.change(select, { target: { value: BOBUR.id } });
      expect(
        within(dialog).getByText(
          en.timetable.journalSubstitute.cannotTake.replace('{{dates}}', '26 October'),
        ),
      ).not.toBeNull();
      fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
        target: { value: 'The teacher is ill' },
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }),
      );
      const answer = await within(dialog).findByText(
        en.timetable.journalSubstitute.saved.replace('{{dates}}', '19 October'),
      );
      expect(answer).not.toBeNull();
      const blocked = dialog.querySelector('[data-blocked-date="2026-10-26"]');
      expect(blocked?.textContent).toBe(`26 October: ${en.errors.substitute_away}`);
      expect(
        calls.filter((call) => call.route === `POST ${journalPath}`).map((call) => call.body),
      ).toEqual([{ journalId: uid(900), teacherId: BOBUR.id, reason: 'The teacher is ill' }]);
    });

    it('asks a tick for the warnings by date and sends again with it; another teacher takes the tick away', async () => {
      let sent = 0;
      const { calls, dialog } = await openJournalDialog({
        [`POST ${journalPath}`]: () => {
          sent += 1;
          return sent === 1
            ? needsTick()
            : json({
                substitutionId: uid(950),
                saved: [{ lessonId: uid(800), date: '2026-10-19', relaxed: true }],
                blocked: [],
                taken: [],
              });
        },
      });
      fireEvent.change(await within(dialog).findByLabelText(en.timetable.day.substitute), {
        target: { value: BOBUR.id },
      });
      fireEvent.change(within(dialog).getByLabelText(en.timetable.day.reason), {
        target: { value: 'The teacher is ill' },
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }),
      );
      expect(await within(dialog).findByText(en.errors.substitution_needs_confirm)).not.toBeNull();
      expect(
        within(dialog).getByText(`19 October: ${en.timetable.rule.teacher_unavailable}`),
      ).not.toBeNull();
      fireEvent.click(within(dialog).getByLabelText(en.timetable.day.substituteConfirm));
      fireEvent.click(
        within(dialog).getByRole('button', { name: en.timetable.day.substituteSend }),
      );
      await within(dialog).findByText(
        en.timetable.journalSubstitute.saved.replace('{{dates}}', '19 October'),
      );
      expect(
        calls.filter((call) => call.route === `POST ${journalPath}`).map((call) => call.body),
      ).toEqual([
        { journalId: uid(900), teacherId: BOBUR.id, reason: 'The teacher is ill' },
        { journalId: uid(900), teacherId: BOBUR.id, reason: 'The teacher is ill', confirm: true },
      ]);
    });

    it('lists the lessons a shortening kept with their substitute', async () => {
      await openList({
        absences: [absence(1, { state: 'current', canWithdraw: false })],
        extra: {
          [`PATCH /api/timetable/absences/${uid(701)}`]: (body) =>
            json({
              ...absence(1, { state: 'current', canWithdraw: false }),
              ...(body as object),
              returns: {
                returned: [],
                kept: [{ lessonId: uid(801), date: '2026-10-26', rules: ['teacher_double'] }],
              },
            }),
        },
      });
      fireEvent.click(screen.getByText('Karimova Aziza', { selector: 'button' }));
      const panel = await screen.findByRole('complementary', { name: 'Karimova Aziza' });
      fireEvent.click(within(panel).getByRole('button', { name: texts.changeDates }));
      const form = within(panel).getByRole('form', { name: texts.changeDates });
      fireEvent.click(within(form).getByLabelText(texts.openEnded));
      fireEvent.change(within(form).getByLabelText(texts.lastDay), {
        target: { value: '2026-10-23' },
      });
      fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
      const kept = await waitFor(() => {
        const found = panel.querySelector(`[data-kept-lesson="${uid(801)}"]`);
        expect(found).not.toBeNull();
        return found;
      });
      expect(kept?.textContent).toBe(`26 October: ${en.timetable.rule.teacher_double}`);
    });
  });

  it('shows the empty page with its first action when there is no absence', async () => {
    await openList({ absences: [] });
    expect(await screen.findByText(texts.empty)).toBeDefined();
  });
});
