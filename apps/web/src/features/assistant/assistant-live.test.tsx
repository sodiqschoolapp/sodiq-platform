import type { AssistantConversation, AssistantMessage, AssistantProgress } from '@sodiq/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ROLE_STORAGE_KEY } from '@/features/access/view-store';
import type { LiveConnector, LiveHandlers } from '@/features/notifications/live';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';

// Task 11.16 (pull request #381). `02`, Assistant, Where: "The same conversations also open on a
// page of their own, Assistant, in the menu of the three roles … the panel links to it"; While it
// works: "A question shows in the conversation the moment it is sent, and the box is empty again.
// The conversation shows what the assistant is reading as it reads it, and the answer as it is
// written"; Limits: "the panel and the Assistant page say so". `edge/people-roles-accounts`, "The
// same conversation is open in the panel and on the Assistant page, or in two tabs". All names
// are invented.

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ON = { available: true, refusal: null, questionsLeftToday: 30 };
const ASKED_AT = '2026-11-20T05:00:00.000Z';

const admin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const message = (seq: number, fields: Partial<AssistantMessage> & Pick<AssistantMessage, 'kind'>) =>
  ({ id: uid(500 + seq), seq, at: ASKED_AT, ...fields }) as AssistantMessage;

const conversation = (
  messages: AssistantMessage[],
  fields: Partial<AssistantConversation> = {},
): AssistantConversation => ({
  id: uid(1),
  branchId: NORTH.id,
  branchName: NORTH.name,
  role: 'super_admin',
  title: 'Which classes have no Tutor?',
  createdAt: ASKED_AT,
  lastActivityAt: ASKED_AT,
  archived: false,
  archivesAt: '2027-02-18T05:00:00.000Z',
  messages,
  proposals: [],
  working: null,
  ...fields,
});

const QUESTION = message(1, { kind: 'question', text: 'Which classes have no Tutor?' });
/** Working until an hour from the test's moment, so no timer ends it. */
const working = (until = new Date(Date.now() + 60 * 60 * 1000).toISOString()) => ({
  questionId: QUESTION.id,
  askedAt: ASKED_AT,
  until,
});
const ANSWERED = conversation([
  QUESTION,
  message(2, { kind: 'read', group: 'classes', status: 200 }),
  message(3, { kind: 'answer', text: 'Oxford B, Oxford C', pages: [], lessons: [] }),
]);

/** A fake live connection: the test tells the tab what the server would. */
function fakeLive() {
  const handlers: LiveHandlers[] = [];
  const connect: LiveConnector = (given) => {
    handlers.push(given);
    return { close: () => undefined };
  };
  const tell = (progress: AssistantProgress['event'], conversationId = uid(1)) => {
    act(() => {
      for (const one of handlers) {
        one.onAssistant({ conversationId, questionId: QUESTION.id, event: progress });
      }
    });
  };
  return { connect, tell, opened: () => handlers.length };
}

async function openPanel() {
  fireEvent.click(await screen.findByRole('button', { name: en.assistant.open }));
  return within(await screen.findByRole('complementary', { name: en.assistant.title }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the assistant while it works', () => {
  it('shows the question and an empty box before the server took it, and puts a refused question back with its message', async () => {
    let take: (response: Response) => void = () => undefined;
    let sends = 0;
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'POST /api/assistant/questions': () => {
        sends += 1;
        return sends === 1
          ? new Promise<Response>((resolve) => {
              take = resolve;
            })
          : refusal('assistant_question_running', 409);
      },
      [`GET /api/assistant/conversations/${uid(1)}`]: () =>
        json(conversation([QUESTION], { working: working() })),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    const box = panel.getByLabelText<HTMLTextAreaElement>(en.assistant.question);
    fireEvent.change(box, { target: { value: 'Which classes have no Tutor?' } });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
    // Before the server answered: the question shows, the box is empty, the assistant works.
    expect(await panel.findByText('Which classes have no Tutor?')).toBeTruthy();
    expect(box.value).toBe('');
    expect(panel.getByText(en.assistant.working)).toBeTruthy();
    take(json({ conversation: conversation([QUESTION], { working: working() }) }, 202));
    await waitFor(() => {
      expect(panel.getAllByText('Which classes have no Tutor?')).toHaveLength(1);
    });
    expect(panel.getByText(en.assistant.working)).toBeTruthy();
  });

  it('puts the question back into the box when a second question is refused while one runs', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'POST /api/assistant/questions': () => refusal('assistant_question_running', 409),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    const box = panel.getByLabelText<HTMLTextAreaElement>(en.assistant.question);
    fireEvent.change(box, { target: { value: 'A second question' } });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
    expect(await panel.findByText(en.assistant.refusals.assistant_question_running)).toBeTruthy();
    expect(box.value).toBe('A second question');
  });

  it('shows each read and the text as they come, never as HTML; done reads the stored answer once; another conversation’s progress is ignored', async () => {
    const live = fakeLive();
    let stored: AssistantConversation = conversation([QUESTION], { working: working() });
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({
          conversations: [
            {
              id: uid(1),
              branchId: NORTH.id,
              branchName: NORTH.name,
              role: 'super_admin',
              title: 'Which classes have no Tutor?',
              createdAt: ASKED_AT,
              lastActivityAt: ASKED_AT,
            },
          ],
        }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(stored),
    });
    renderApp('/', 'en', undefined, live.connect);
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Which classes have no Tutor\?/ }));
    expect(await panel.findByText(en.assistant.working)).toBeTruthy();
    live.tell({ kind: 'read', group: 'classes', status: 200 });
    const reading = en.assistant.reading.replace('{{what}}', en.assistant.groups.classes);
    expect(await panel.findByText(reading)).toBeTruthy();
    live.tell({ kind: 'text', seq: 1, delta: '<b>Oxford B</b>' });
    live.tell({ kind: 'text', seq: 2, delta: ', Oxford C' });
    expect(await panel.findByText('<b>Oxford B</b>, Oxford C')).toBeTruthy();
    expect(document.querySelector('aside b')).toBeNull();
    // Another conversation's progress names it; this one shows none of it.
    live.tell({ kind: 'text', seq: 1, delta: 'Not this one' }, uid(2));
    live.tell({ kind: 'read', group: 'staff', status: 200 }, uid(2));
    expect(panel.queryByText('Not this one')).toBeNull();
    expect(
      panel.queryByText(en.assistant.reading.replace('{{what}}', en.assistant.groups.staff)),
    ).toBeNull();
    stored = ANSWERED;
    live.tell({ kind: 'done' });
    await waitFor(() => {
      expect(panel.queryByText(en.assistant.working)).toBeNull();
    });
    expect(panel.getAllByText('Oxford B, Oxford C')).toHaveLength(1);
    expect(panel.queryByText(reading)).toBeNull();
  });

  it('shows "No answer came" once the window of a question being answered passes, with no call', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const until = new Date(Date.now() + 5_000).toISOString();
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({
          conversations: [
            {
              id: uid(1),
              branchId: NORTH.id,
              branchName: NORTH.name,
              role: 'super_admin',
              title: 'Which classes have no Tutor?',
              createdAt: ASKED_AT,
              lastActivityAt: ASKED_AT,
            },
          ],
        }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () =>
        json(conversation([QUESTION], { working: working(until) })),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Which classes have no Tutor\?/ }));
    expect(await panel.findByText(en.assistant.working)).toBeTruthy();
    expect(
      panel.getByRole('button', { name: en.assistant.working }).getAttribute('aria-busy'),
    ).toBe('true');
    const before = calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(await panel.findByText(en.assistant.noAnswer)).toBeTruthy();
    expect(panel.queryByText(en.assistant.working)).toBeNull();
    expect(calls.length).toBe(before);
  });

  it('shows "No answer came" for a stranded question the server reads as no longer working', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () =>
        json({
          conversations: [
            {
              id: uid(1),
              branchId: NORTH.id,
              branchName: NORTH.name,
              role: 'super_admin',
              title: 'Which classes have no Tutor?',
              createdAt: ASKED_AT,
              lastActivityAt: ASKED_AT,
            },
          ],
        }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () =>
        json(
          conversation([
            QUESTION,
            message(2, { kind: 'read', group: 'classes', status: 200 }),
            message(3, { kind: 'question', text: 'Again?' }),
            message(4, { kind: 'answer', text: 'Yes.', pages: [], lessons: [] }),
          ]),
        ),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    fireEvent.click(await panel.findByRole('button', { name: /Which classes have no Tutor\?/ }));
    expect(await panel.findByText(en.assistant.noAnswer)).toBeTruthy();
    expect(panel.getAllByText(en.assistant.noAnswer)).toHaveLength(1);
  });

  it('reads the conversation again when another tab sent a question in it (two tabs)', async () => {
    const live = fakeLive();
    let stored: AssistantConversation = ANSWERED;
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(stored),
    });
    renderApp(`/assistant?conversation=${uid(1)}`, 'en', undefined, live.connect);
    expect(await screen.findByText('Oxford B, Oxford C')).toBeTruthy();
    const reads = () =>
      calls.filter((call) => call.route === `GET /api/assistant/conversations/${uid(1)}`).length;
    const before = reads();
    stored = conversation(
      [...ANSWERED.messages, message(4, { kind: 'question', text: 'From the other tab' })],
      { working: { ...working(), questionId: uid(504) } },
    );
    live.tell({ kind: 'question' });
    expect(await screen.findByText('From the other tab')).toBeTruthy();
    expect(reads()).toBeGreaterThan(before);
  });
});

describe('the Assistant page', () => {
  const LIST = {
    conversations: [
      {
        id: uid(1),
        branchId: NORTH.id,
        branchName: NORTH.name,
        role: 'super_admin',
        title: 'Which classes have no Tutor?',
        createdAt: ASKED_AT,
        lastActivityAt: ASKED_AT,
      },
    ],
  };

  it('lists the person’s conversations beside the chat, opens one from the address and continues it', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json(LIST),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(ANSWERED),
      'POST /api/assistant/questions': () =>
        json(
          {
            conversation: conversation(
              [...ANSWERED.messages, message(4, { kind: 'question', text: 'And 7B?' })],
              { working: { ...working(), questionId: uid(504) } },
            ),
          },
          202,
        ),
    });
    renderApp('/assistant', 'en');
    expect(
      await screen.findByRole('heading', { level: 1, name: en.assistant.page.title }),
    ).toBeTruthy();
    const list = within(
      await screen.findByRole('navigation', { name: en.assistant.conversations }),
    );
    expect(await screen.findByText(en.assistant.page.choose)).toBeTruthy();
    fireEvent.click(await list.findByRole('button', { name: /Which classes have no Tutor\?/ }));
    expect(await screen.findByText('Oxford B, Oxford C')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(en.assistant.question), {
      target: { value: 'And 7B?' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.assistant.send }));
    expect(await screen.findByText('And 7B?')).toBeTruthy();
    expect(calls.find((call) => call.route === 'POST /api/assistant/questions')?.body).toEqual({
      role: 'super_admin',
      text: 'And 7B?',
      conversationId: uid(1),
    });
  });

  it('shows the list, then the chat with Back, as two steps on a phone', async () => {
    setWindowWidth(360);
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json(LIST),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(ANSWERED),
    });
    renderApp('/assistant', 'en');
    const list = within(
      await screen.findByRole('navigation', { name: en.assistant.conversations }),
    );
    expect(screen.queryByLabelText(en.assistant.question)).toBeNull();
    fireEvent.click(await list.findByRole('button', { name: /Which classes have no Tutor\?/ }));
    expect(await screen.findByText('Oxford B, Oxford C')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: en.assistant.conversations })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.assistant.page.back }));
    expect(
      await screen.findByRole('navigation', { name: en.assistant.conversations }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(en.assistant.question)).toBeNull();
  });

  it.each([
    ['assistant_daily_limit', en.assistant.refusals.assistant_daily_limit],
    ['assistant_cap_reached', en.assistant.refusals.assistant_cap_reached],
    ['assistant_model_unavailable', en.assistant.refusals.assistant_model_unavailable],
  ] as const)(
    'says %s as the panel does, and keeps the menu item (`02`, Limits)',
    async (code, text) => {
      fakeApi({
        'GET /api/auth/session': () => json(admin()),
        'GET /api/assistant/status': () => json({ ...ON, available: false, refusal: code }),
        'GET /api/assistant/conversations': () => json({ conversations: [] }),
      });
      renderApp('/assistant', 'en');
      const main = within(await screen.findByRole('main'));
      expect(await main.findByText(text)).toBeTruthy();
      expect(main.getByRole('button', { name: en.assistant.send }).hasAttribute('disabled')).toBe(
        true,
      );
      expect(await screen.findByRole('link', { name: en.menu.assistant })).toBeTruthy();
    },
  );

  it.each([
    ['assistant_model_busy', en.assistant.refusals.assistant_model_busy],
    ['assistant_model_unavailable', en.assistant.refusals.assistant_model_unavailable],
    ['assistant_answer_failed', en.assistant.refusals.assistant_answer_failed],
  ] as const)('shows the notice %s in the page’s conversation', async (code, text) => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json(LIST),
      [`GET /api/assistant/conversations/${uid(1)}`]: () =>
        json(conversation([QUESTION, message(2, { kind: 'notice', code })])),
    });
    renderApp(`/assistant?conversation=${uid(1)}`, 'en');
    const chat = within(await screen.findByRole('region', { name: en.assistant.title }));
    expect(await chat.findByText(text)).toBeTruthy();
    expect(chat.queryByText(en.assistant.noAnswer)).toBeNull();
  });

  it('is linked from the panel', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    expect(panel.getByRole('link', { name: en.assistant.openPage }).getAttribute('href')).toBe(
      '/assistant',
    );
  });
});

describe('the menu item Assistant', () => {
  const menuLink = () => screen.queryAllByRole('link', { name: en.menu.assistant })[0] ?? null;

  it('shows for the Super Admin, the Academic Vice Principal and the Teacher while the assistant is on', async () => {
    for (const role of ['super_admin', 'academic_vice_principal', 'teacher'] as const) {
      fakeApi({
        'GET /api/auth/session': () =>
          json(
            sessionOf({
              assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
              branches: [NORTH],
            }),
          ),
        'GET /api/assistant/status': () => json(ON),
        'GET /api/timetable/attention': () =>
          json({
            needsTeacher: [],
            unresolved: [],
            needsInvigilator: [],
            needsRoom: [],
            examsNeedRoom: [],
          }),
        'GET /api/people/students/no-class': () => json({ count: 0 }),
        'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
      });
      const shell = renderApp('/assistant', 'en');
      expect(await screen.findByRole('link', { name: en.menu.assistant }), role).toBeTruthy();
      shell.queryClient.clear();
      document.body.innerHTML = '';
    }
  });

  it('hides it while the assistant is off for the chosen role', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () =>
        json({ ...ON, available: false, refusal: 'assistant_off' }),
    });
    renderApp('/', 'en');
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'GET /api/assistant/status')).toBe(true);
    });
    await screen.findAllByRole('link', { name: en.menu.home });
    expect(menuLink()).toBeNull();
  });

  it('hides it when another role is chosen, though the person also holds one with the assistant', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'principal');
    onTestFinished(() => {
      window.sessionStorage.removeItem(ROLE_STORAGE_KEY);
    });
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [
              { role: 'super_admin', branchId: null },
              { role: 'principal', branchId: NORTH.id },
            ],
            branches: [NORTH],
          }),
        ),
      'GET /api/assistant/status': () => json(ON),
    });
    renderApp('/', 'en');
    await screen.findAllByRole('link', { name: en.menu.home });
    await waitFor(() => {
      expect(screen.queryAllByRole('link', { name: en.menu.audit_log }).length).toBeGreaterThan(0);
    });
    expect(menuLink()).toBeNull();
  });

  it('never shows for a role without the assistant', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }] })),
    });
    renderApp('/', 'en');
    await screen.findAllByRole('link', { name: en.menu.home });
    expect(menuLink()).toBeNull();
    expect(calls.some((call) => call.route === 'GET /api/assistant/status')).toBe(false);
  });
});
