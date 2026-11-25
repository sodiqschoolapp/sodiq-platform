import type { AssistantConversation, AssistantMessage } from '@sodiq/shared';
import { ASSISTANT_DATA_GROUPS } from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ROLE_STORAGE_KEY } from '@/features/access/view-store';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

// Task 11.12 (pull request #374). `02`, Assistant: "A button in the top bar opens a chat panel
// beside the page; on a phone it fills the screen. … A person whose chosen role is another role
// does not see it. … it is off until switched on"; Limits: "When either is reached, or the model
// cannot be reached, the panel says so; every screen works as before". All names are invented.

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const admin = (extra: { role: 'teacher' | 'principal'; branchId: string }[] = []) =>
  sessionOf({
    assignments: [{ role: 'super_admin', branchId: null }, ...extra],
    branches: [NORTH],
  });

const ON = { available: true, refusal: null, questionsLeftToday: 30, files: false };

const message = (seq: number, fields: Partial<AssistantMessage> & Pick<AssistantMessage, 'kind'>) =>
  ({ id: uid(500 + seq), seq, at: '2026-11-20T05:00:00.000Z', ...fields }) as AssistantMessage;

const conversation = (
  messages: AssistantMessage[],
  fields: Partial<AssistantConversation> = {},
) => ({
  id: uid(1),
  branchId: NORTH.id,
  branchName: NORTH.name,
  role: 'super_admin' as const,
  title: 'Which classes have no Tutor?',
  createdAt: '2026-11-20T05:00:00.000Z',
  lastActivityAt: '2026-11-20T05:00:00.000Z',
  archived: false,
  archivesAt: '2027-02-18T05:00:00.000Z',
  messages,
  proposals: [],
  working: null,
  ...fields,
});

const button = () => screen.queryByRole('button', { name: en.assistant.open });

async function openPanel() {
  fireEvent.click(await screen.findByRole('button', { name: en.assistant.open }));
  return within(await screen.findByRole('complementary', { name: en.assistant.title }));
}

describe('the assistant in the top bar', () => {
  it('shows the button to the Super Admin while it is on, and none while it is off', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
    });
    renderApp('/', 'en');
    expect(await screen.findByRole('button', { name: en.assistant.open })).toBeTruthy();
  });

  it('shows no button while it is switched off', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () =>
        json({ ...ON, available: false, refusal: 'assistant_off' }),
    });
    renderApp('/', 'en');
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'GET /api/assistant/status')).toBe(true);
    });
    expect(button()).toBeNull();
  });

  it('shows no button and asks nothing for a role the table does not give the panel (a Principal)', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }] })),
    });
    renderApp('/', 'en');
    await screen.findByRole('heading', { level: 1 });
    expect(button()).toBeNull();
    expect(calls.some((call) => call.route.startsWith('GET /api/assistant'))).toBe(false);
  });

  it('shows no button and asks nothing while a Super Admin who is also a Principal has the Principal role chosen', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'principal');
    try {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(admin([{ role: 'principal', branchId: NORTH.id }])),
        'GET /api/assistant/status': () => json(ON),
      });
      renderApp('/', 'en');
      await screen.findByRole('heading', { level: 1 });
      expect(button()).toBeNull();
      expect(calls.some((call) => call.route.startsWith('GET /api/assistant'))).toBe(false);
    } finally {
      window.sessionStorage.removeItem(ROLE_STORAGE_KEY);
    }
  });

  // Task 11.14 (pull request #377): the Teacher has the panel; "mark everyone present" is refused
  // and the answer opens the lesson's journal column (`edge/people-roles-accounts`, The assistant).
  it('gives the Teacher the panel, asks in the Teacher role, and opens the lesson’s journal column from the answer', async () => {
    const journalId = uid(700);
    const quarterId = uid(701);
    const answered = conversation(
      [
        message(1, { kind: 'question', text: 'Mark everyone present.' }),
        message(2, {
          kind: 'answer',
          text: 'Attendance is marked in the journal.',
          pages: [],
          lessons: [{ journalId, quarterId, date: '2026-11-16' }],
        }),
      ],
      { role: 'teacher' },
    );
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'POST /api/assistant/questions': () => json({ conversation: answered }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(answered),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    expect(calls.find((call) => call.route === 'GET /api/assistant/status')?.query).toContain(
      'role=teacher',
    );
    fireEvent.change(panel.getByLabelText(en.assistant.question), {
      target: { value: 'Mark everyone present.' },
    });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
    const link = await panel.findByRole('link', {
      name: en.assistant.openLessonJournal.replace('{{date}}', '16 November 2026'),
    });
    expect(link.getAttribute('href')).toBe(
      `/journal/${journalId}?quarter=${quarterId}&date=2026-11-16`,
    );
    expect(calls.find((call) => call.route === 'POST /api/assistant/questions')?.body).toEqual({
      role: 'teacher',
      text: 'Mark everyone present.',
      // Task 11.19: the panel sends the page it is beside.
      place: { page: '/' },
    });
  });

  it('sends the page, its values and the record open in the panel with the question, and draws the answer’s links to the exact place (task 11.19)', async () => {
    const student = uid(9);
    const answered = conversation([
      message(1, { kind: 'question', text: 'What class is this student in?' }),
      message(2, {
        kind: 'answer',
        text: 'Open the record here.',
        pages: [],
        lessons: [],
        links: [
          {
            nodeId: 'page:/people/students',
            to: '/people/students',
            params: {},
            search: { open: student },
            label: { uz: 'Oʻquvchilar', ru: 'Ученики', en: 'Students' },
          },
        ],
      }),
    ]);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'POST /api/assistant/questions': () => json({ conversation: answered }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(answered),
    });
    renderApp(`/people/students?open=${student}&q=Oxford`, 'en');
    const panel = await openPanel();
    fireEvent.change(panel.getByLabelText(en.assistant.question), {
      target: { value: 'What class is this student in?' },
    });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
    const link = await panel.findByRole('link', { name: 'Students' });
    expect(link.getAttribute('href')).toBe(`/people/students?open=${student}`);
    expect(calls.find((call) => call.route === 'POST /api/assistant/questions')?.body).toEqual({
      role: 'super_admin',
      text: 'What class is this student in?',
      place: { page: '/people/students', search: { open: student, q: 'Oxford' } },
    });
  });

  it('keeps a question typed and not sent while the panel is closed and opened again (`12`, No lost work)', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
    });
    renderApp('/', 'en');
    let panel = await openPanel();
    fireEvent.change(panel.getByLabelText(en.assistant.question), {
      target: { value: 'Half a question' },
    });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.close }));
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: en.assistant.title })).toBeNull();
    });
    panel = await openPanel();
    expect(panel.getByLabelText<HTMLTextAreaElement>(en.assistant.question).value).toBe(
      'Half a question',
    );
  });

  it('asks a question with the chosen role, shows the answer as plain text, the reads and the linked pages', async () => {
    const answered = conversation([
      message(1, { kind: 'question', text: 'Which classes have no Tutor?' }),
      message(2, { kind: 'read', group: 'classes', status: 200 }),
      message(3, {
        kind: 'answer',
        text: '<b>Oxford B</b>, Oxford C',
        pages: ['setup'],
        lessons: [],
      }),
    ]);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'POST /api/assistant/questions': () => json({ conversation: answered }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(answered),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    expect(await panel.findByText(en.assistant.empty)).toBeTruthy();
    fireEvent.change(panel.getByLabelText(en.assistant.question), {
      target: { value: 'Which classes have no Tutor?' },
    });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
    // Plain text: the markup of an answer is shown as typed, never drawn.
    expect(await panel.findByText('<b>Oxford B</b>, Oxford C')).toBeTruthy();
    expect(document.querySelector('aside b')).toBeNull();
    expect(
      panel.getByText(en.assistant.read.replace('{{what}}', en.assistant.groups.classes)),
    ).toBeTruthy();
    expect(panel.getByRole('link', { name: en.menu.setup }).getAttribute('href')).toBe('/setup');
    expect(calls.find((call) => call.route === 'POST /api/assistant/questions')?.body).toEqual({
      role: 'super_admin',
      text: 'Which classes have no Tutor?',
      place: { page: '/' },
    });
    // The typed question is cleared once the server took it.
    expect(panel.getByLabelText<HTMLTextAreaElement>(en.assistant.question).value).toBe('');
  });

  it('keeps the typed question and says so when a limit refuses it (`12`, No lost work)', async () => {
    for (const code of [
      'assistant_daily_limit',
      'assistant_cap_reached',
      'assistant_model_unavailable',
      // Task 11.15: "busy, try again in a minute", apart from "cannot reach its model".
      'assistant_model_busy',
    ] as const) {
      fakeApi({
        'GET /api/auth/session': () => json(admin()),
        'GET /api/assistant/status': () => json(ON),
        'GET /api/assistant/conversations': () => json({ conversations: [] }),
        'POST /api/assistant/questions': () =>
          refusal(
            code,
            code === 'assistant_model_unavailable' || code === 'assistant_model_busy' ? 503 : 409,
          ),
      });
      renderApp('/', 'en');
      const panel = await openPanel();
      fireEvent.change(panel.getByLabelText(en.assistant.question), {
        target: { value: 'Still here?' },
      });
      fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
      expect(await panel.findByText(en.assistant.refusals[code])).toBeTruthy();
      expect(panel.getByLabelText<HTMLTextAreaElement>(en.assistant.question).value).toBe(
        'Still here?',
      );
      cleanup();
    }
  });

  it('shows bold words and list lines of an answer as such, and any HTML as its characters (task 11.15)', async () => {
    const answered = conversation([
      message(1, { kind: 'question', text: 'How many?' }),
      message(2, {
        kind: 'answer',
        text: 'There are **36 students**:\n* Oxford A\n* Oxford B\n1. First\n2. Second\nAnd <b>raw</b> text.',
        pages: [],
        lessons: [],
      }),
    ]);
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'POST /api/assistant/questions': () => json({ conversation: answered }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(answered),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.change(panel.getByLabelText(en.assistant.question), {
      target: { value: 'How many?' },
    });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
    const strong = await panel.findByText('36 students');
    expect(strong.tagName).toBe('STRONG');
    const bullets = document.querySelector('aside ul.list-disc');
    expect([...(bullets?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'Oxford A',
      'Oxford B',
    ]);
    const numbers = document.querySelector('aside ol.list-decimal');
    expect([...(numbers?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'First',
      'Second',
    ]);
    expect(await panel.findByText('And <b>raw</b> text.')).toBeTruthy();
    expect(document.querySelector('aside b')).toBeNull();
    expect(document.body.innerHTML).not.toContain('**');
  });

  it('shows the busy text for a stored busy notice of a conversation opened again (task 11.15)', async () => {
    const stored = conversation([
      message(1, { kind: 'question', text: 'Earlier.' }),
      message(2, { kind: 'notice', code: 'assistant_model_busy' }),
      message(3, { kind: 'question', text: 'Before.' }),
      message(4, { kind: 'notice', code: 'assistant_model_unavailable' }),
    ]);
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({
          conversations: [
            {
              id: stored.id,
              branchId: stored.branchId,
              branchName: stored.branchName,
              role: 'super_admin',
              title: 'Earlier question',
              createdAt: stored.createdAt,
              lastActivityAt: stored.lastActivityAt,
            },
          ],
        }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(stored),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Earlier question/ }));
    expect(await panel.findByText(en.assistant.refusals.assistant_model_busy)).toBeTruthy();
    expect(panel.getByText(en.assistant.refusals.assistant_model_unavailable)).toBeTruthy();
  });

  it('opens a conversation of another branch read only, with no question field', async () => {
    const other = conversation([message(1, { kind: 'question', text: 'Earlier.' })], {
      branchId: uid(77),
      branchName: 'South',
    });
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({
          conversations: [
            {
              id: other.id,
              branchId: other.branchId,
              branchName: 'South',
              role: 'super_admin',
              title: 'Earlier question',
              createdAt: other.createdAt,
              lastActivityAt: other.lastActivityAt,
            },
          ],
        }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(other),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Earlier question/ }));
    expect(await panel.findByText(en.assistant.readOnly)).toBeTruthy();
    expect(panel.queryByLabelText(en.assistant.question)).toBeNull();
  });

  it('fills the screen on a phone', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
    });
    renderApp('/', 'en');
    await openPanel();
    const aside = screen.getByRole('complementary', { name: en.assistant.title });
    expect(aside.className).toContain('max-sm:w-full');
    expect(aside.className).toContain('fixed');
  });
});

describe('the assistant’s settings and conversations of the Super Admin', () => {
  const settings = {
    schoolOn: false,
    rolesOn: [],
    dailyLimit: 30,
    monthlyCapDollars: 300,
    questionActions: 40,
    proposalSteps: 100,
    questionMinutes: 10,
    roles: ['super_admin'],
    spentThisMonthCents: 1234,
    modelConfigured: true,
    model: 'gemini-3.5-flash',
    fallbackOn: true,
    dataGroupsOn: [...ASSISTANT_DATA_GROUPS],
    fallbackQuestionsThisMonth: 2,
  };

  it('switches the assistant on for the school and the Super Admin, with the limit and the cap', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/setup/settings': () =>
        json({
          editDays: 7,
          lowResult: 50,
          resultDrop: 15,
          attendancePercent: 80,
          absencesInRow: 3,
          classDailyLessons: null,
          planWindows: true,
        }),
      'GET /api/setup/attendance-values': () => json({ years: [] }),
      'GET /api/setup/school-settings/digest': () =>
        json({ sendAt: '19:00', quietFrom: '21:00', quietUntil: '08:00' }),
      'GET /api/setup/school-settings/assistant': () => json(settings),
      'GET /api/assistant/actions': () => json({ roles: [] }),
      'PUT /api/setup/school-settings/assistant': (body) =>
        json({ ...settings, ...(body as object) }),
    });
    renderApp('/setup/assistant', 'en');
    const section = within(
      await screen.findByRole('region', { name: en.assistant.settings.title }),
    );
    fireEvent.click(await section.findByLabelText(en.assistant.settings.schoolOn));
    fireEvent.click(
      section.getByLabelText(
        en.assistant.settings.roleOn.replace('{{role}}', en.roles.super_admin),
      ),
    );
    fireEvent.change(section.getByLabelText(en.assistant.settings.dailyLimit), {
      target: { value: '12' },
    });
    // Task 11.21: the limits of one question and one proposal, and 0 as "no daily limit".
    expect(section.getByText(en.assistant.settings.dailyLimitNote)).toBeTruthy();
    for (const [label, value] of [
      [en.assistant.settings.questionActions, '60'],
      [en.assistant.settings.proposalSteps, '150'],
      [en.assistant.settings.questionMinutes, '20'],
    ] as const) {
      fireEvent.change(section.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(section.getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === 'PUT /api/setup/school-settings/assistant')?.body,
      ).toEqual({
        schoolOn: true,
        rolesOn: ['super_admin'],
        dailyLimit: 12,
        monthlyCapDollars: 300,
        questionActions: 60,
        proposalSteps: 150,
        questionMinutes: 20,
        fallbackOn: true,
        dataGroupsOn: [...ASSISTANT_DATA_GROUPS],
      });
    });
  });

  it('shows the worldwide fallback on until switched off, with the questions of the month, and switches it off (task 11.15)', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/setup/settings': () =>
        json({
          editDays: 7,
          lowResult: 50,
          resultDrop: 15,
          attendancePercent: 80,
          absencesInRow: 3,
          classDailyLessons: null,
          planWindows: true,
        }),
      'GET /api/setup/attendance-values': () => json({ years: [] }),
      'GET /api/setup/school-settings/digest': () =>
        json({ sendAt: '19:00', quietFrom: '21:00', quietUntil: '08:00' }),
      'GET /api/setup/school-settings/assistant': () => json(settings),
      'GET /api/assistant/actions': () => json({ roles: [] }),
      'PUT /api/setup/school-settings/assistant': (body) =>
        json({ ...settings, ...(body as object) }),
    });
    renderApp('/setup/assistant', 'en');
    const section = within(
      await screen.findByRole('region', { name: en.assistant.settings.title }),
    );
    const fallback = await section.findByLabelText<HTMLInputElement>(
      en.assistant.settings.fallbackOn,
    );
    expect(fallback.checked).toBe(true);
    expect(
      section.getByText(en.assistant.settings.fallbackNote.replace('{{number}}', '2')),
    ).toBeTruthy();
    fireEvent.click(fallback);
    fireEvent.click(section.getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === 'PUT /api/setup/school-settings/assistant')?.body,
      ).toEqual(expect.objectContaining({ fallbackOn: false }));
    });
  });

  it('lists every conversation, reads one and restores an archived one after asking', async () => {
    const archived = {
      id: uid(9),
      branchId: NORTH.id,
      branchName: NORTH.name,
      role: 'super_admin' as const,
      title: 'From August',
      createdAt: '2026-08-01T05:00:00.000Z',
      lastActivityAt: '2026-08-01T05:00:00.000Z',
      archived: true,
      personName: 'Karimova Dilnoza',
    };
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/all-conversations': () => json({ conversations: [archived] }),
      [`GET /api/assistant/all-conversations/${uid(9)}`]: () =>
        json({
          ...conversation([message(1, { kind: 'question', text: 'In August.' })], {
            id: uid(9),
            archived: true,
          }),
          personName: 'Karimova Dilnoza',
        }),
      [`POST /api/assistant/all-conversations/${uid(9)}/restore`]: () =>
        json({ ...conversation([], { id: uid(9) }), personName: 'Karimova Dilnoza' }),
    });
    renderApp('/assistant-conversations', 'en');
    await screen.findByRole('heading', { name: en.assistant.conversationsPage.title });
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr').length).toBe(1);
    });
    const row = document.querySelector('tbody tr button');
    if (!(row instanceof HTMLElement)) throw new Error('No row.');
    fireEvent.click(row);
    const panel = within(await screen.findByRole('complementary'));
    expect(await panel.findByText('In August.')).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: en.assistant.conversationsPage.restore }));
    const dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.click(dialog.getByRole('button', { name: en.assistant.conversationsPage.restore }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `POST /api/assistant/all-conversations/${uid(9)}/restore`,
        ),
      ).toBe(true);
    });
  });
});

// Task 11.13 (pull request #376): a proposal in the panel. `02`, Reading and proposing: "it is
// shown as a proposal that lists every change in plain words, with the platform's own preview …
// Nothing changes until the person presses Confirm"; the answer lists what was done and what not.
describe('a proposal of the assistant', () => {
  const step = (state: 'waiting' | 'done' | 'refused' | 'not_run', code: string | null = null) => ({
    id: uid(700),
    seq: 1,
    action: 'BulkCancelsController_save',
    group: 'timetable' as const,
    summary: 'Cancel lesson 3 of 7 Oxford today.',
    recordName: null,
    recordNames: null,
    fields: [{ name: 'reason', value: 'No electricity' }],
    entries: [],
    previewIssues: [{ kind: 'warning' as const, code: 'lesson_started' }],
    previewCounts: [{ list: 'cancel', count: 1 }],
    previewLessons: [
      {
        list: 'cancel',
        date: '2026-11-20',
        start: 9 * 60 + 50,
        unitName: '7 Oxford',
        subjectNames: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        teacherName: 'Karimov Aziz',
        roomName: '204',
        hasData: true,
        choice: 'keep' as const,
      },
    ],
    previewMore: 0,
    state,
    status: state === 'done' ? 200 : 0,
    code,
  });
  const withProposal = (state: 'waiting' | 'confirmed', steps: ReturnType<typeof step>[]) =>
    conversation(
      [
        message(1, { kind: 'question', text: 'Cancel the rest of today.' }),
        message(2, {
          kind: 'answer',
          text: 'I propose a bulk cancel from lesson 3.',
          pages: [],
          lessons: [],
        }),
      ],
      {
        proposals: [
          {
            id: uid(800),
            questionId: uid(501),
            createdAt: '2026-11-20T05:00:00.000Z',
            expiresAt: '2026-11-20T05:15:00.000Z',
            state,
            decidedAt: state === 'confirmed' ? '2026-11-20T05:01:00.000Z' : null,
            steps,
          },
        ],
      },
    );

  it('names the action and every lesson in the platform’s words, and confirms in the chosen role', async () => {
    const waiting = withProposal('waiting', [step('waiting')]);
    const done = withProposal('confirmed', [step('done')]);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({ conversations: [{ ...waiting, messages: undefined, proposals: undefined }] }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(waiting),
      [`POST /api/assistant/proposals/${uid(800)}/confirm`]: () => json({ ...done, secrets: [] }),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Which classes have no Tutor/ }));
    const card = within(await panel.findByRole('region', { name: en.assistant.proposal.title }));
    expect(card.getByText(`1. ${en.assistant.actions.BulkCancelsController_save}`)).toBeTruthy();
    expect(card.getByText(/7 Oxford, Mathematics/)).toBeTruthy();
    expect(card.getByText(/09:50/)).toBeTruthy();
    // Grouped under its list, with its data marked, the warning shown and the field named.
    expect(card.getByText(en.assistant.proposal.lists.cancel)).toBeTruthy();
    expect(card.getByText(en.assistant.proposal.hasData)).toBeTruthy();
    // The choice the step sends for a lesson with data, in plain words (review finding 1).
    expect(card.getByText(en.assistant.proposal.choice_keep)).toBeTruthy();
    expect(card.getByText(/^Warning: /)).toBeTruthy();
    expect(card.getByText(en.assistant.fields.reason)).toBeTruthy();
    expect(card.getByText(en.assistant.proposal.states.waiting, { exact: false })).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: en.assistant.proposal.confirm }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/assistant/proposals/${uid(800)}/confirm`)
          ?.body,
      ).toEqual({ role: 'super_admin' });
    });
    const after = within(await panel.findByRole('region', { name: en.assistant.proposal.title }));
    expect(await after.findByText(en.assistant.proposal.stepStates.done)).toBeTruthy();
    expect(after.queryByRole('button', { name: en.assistant.proposal.confirm })).toBeNull();
  });

  it('shows each step’s outcome after a refusal, and offers no Confirm once decided', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({
          conversations: [
            { ...withProposal('confirmed', []), messages: undefined, proposals: undefined },
          ],
        }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () =>
        json(
          withProposal('confirmed', [
            step('refused', 'lesson_started'),
            { ...step('not_run'), id: uid(701), seq: 2 },
          ]),
        ),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Which classes have no Tutor/ }));
    const card = within(await panel.findByRole('region', { name: en.assistant.proposal.title }));
    expect(
      await card.findByText(new RegExp(en.assistant.proposal.stepStates.refused)),
    ).toBeTruthy();
    expect(card.getByText(en.assistant.proposal.stepStates.not_run)).toBeTruthy();
    expect(card.queryByRole('button', { name: en.assistant.proposal.confirm })).toBeNull();
    cleanup();
  });

  it('declines in the chosen role, and shows an expired proposal without Confirm', async () => {
    const waiting = withProposal('waiting', [step('waiting')]);
    const declined = {
      ...waiting,
      proposals: waiting.proposals.map((one) => ({ ...one, state: 'declined' as const })),
    };
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({ conversations: [{ ...waiting, messages: undefined, proposals: undefined }] }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(waiting),
      [`POST /api/assistant/proposals/${uid(800)}/decline`]: () => json(declined),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Which classes have no Tutor/ }));
    const card = within(await panel.findByRole('region', { name: en.assistant.proposal.title }));
    fireEvent.click(card.getByRole('button', { name: en.assistant.proposal.decline }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/assistant/proposals/${uid(800)}/decline`)
          ?.body,
      ).toEqual({ role: 'super_admin' });
    });
    expect(await panel.findByText(en.assistant.proposal.states.declined)).toBeTruthy();
    cleanup();

    const expired = {
      ...waiting,
      proposals: waiting.proposals.map((one) => ({ ...one, state: 'expired' as const })),
    };
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({ conversations: [{ ...expired, messages: undefined, proposals: undefined }] }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(expired),
    });
    renderApp('/', 'en');
    const again = await openPanel();
    fireEvent.click(await again.findByRole('button', { name: /Which classes have no Tutor/ }));
    const old = within(await again.findByRole('region', { name: en.assistant.proposal.title }));
    expect(old.getByText(en.assistant.proposal.states.expired)).toBeTruthy();
    expect(old.queryByRole('button', { name: en.assistant.proposal.confirm })).toBeNull();
    expect(old.queryByRole('button', { name: en.assistant.proposal.decline })).toBeNull();
  });
});
