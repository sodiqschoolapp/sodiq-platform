import type { AssistantConversation, AssistantMessage } from '@sodiq/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { AnswerText, blocksOf, TABLE_MAX_COLUMNS } from './answer-text';

// Task 11.21 (pull request #388). `02`, Assistant, Answers: "Lists and comparisons come as small
// tables. When it asks the person to choose …, the choices are buttons. A long piece of work goes
// on in parts: … offers Continue." Reading and proposing: "A confirmed proposal can be undone".
// All names are invented.

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const admin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const ON = { available: true, refusal: null, questionsLeftToday: null };

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
  title: 'Rooms',
  createdAt: '2026-11-20T05:00:00.000Z',
  lastActivityAt: '2026-11-20T05:00:00.000Z',
  archived: false,
  archivesAt: '2027-02-18T05:00:00.000Z',
  messages,
  proposals: [],
  working: null,
  ...fields,
});

async function openConversation() {
  fireEvent.click(await screen.findByRole('button', { name: en.assistant.open }));
  const panel = within(await screen.findByRole('complementary', { name: en.assistant.title }));
  fireEvent.click(await panel.findByRole('button', { name: /Rooms/ }));
  return panel;
}

const listed = (one: ReturnType<typeof conversation>) => ({
  conversations: [{ ...one, messages: undefined, proposals: undefined }],
});

afterEach(() => {
  cleanup();
});

describe('tables in an answer', () => {
  it('draws a pipe table as a table, its cells as text with bold, and nothing else as markup', () => {
    render(
      <AnswerText
        text={
          'Rooms:\n| Room | Floor |\n| --- | :---: |\n| **204** | 2 |\n| <b>305</b> | 3 |\nThat is all.'
        }
      />,
    );
    const table = document.querySelector('[data-assistant-table] table');
    expect([...(table?.querySelectorAll('th') ?? [])].map((th) => th.textContent)).toEqual([
      'Room',
      'Floor',
    ]);
    const rows = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['204', '2'],
      ['<b>305</b>', '3'],
    ]);
    expect(table?.querySelector('td strong')?.textContent).toBe('204');
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('That is all.')).toBeTruthy();
  });

  it('reads a line that only looks like a table, a table without its separator, or one of too many columns, as text', () => {
    expect(blocksOf('| just a line |').map((block) => block.kind)).toEqual(['text']);
    expect(blocksOf('| a | b |\n| c | d |').map((block) => block.kind)).toEqual(['text']);
    const wide = Array.from({ length: TABLE_MAX_COLUMNS + 1 }, (_, i) => `c${String(i)}`);
    expect(
      blocksOf(`| ${wide.join(' | ')} |\n| ${wide.map(() => '---').join(' | ')} |`).map(
        (block) => block.kind,
      ),
    ).toEqual(['text']);
    // A row of fewer cells is filled with blanks; one of more keeps the header's columns.
    expect(blocksOf('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |')).toEqual([
      {
        kind: 'table',
        header: ['a', 'b'],
        rows: [
          ['1', ''],
          ['1', '2'],
        ],
      },
    ]);
  });
});

describe('choices, Continue and Undo in the chat', () => {
  it('draws the choices of the newest answer as buttons and sends the one pressed as the person’s answer', async () => {
    const asking = conversation([
      message(1, { kind: 'question', text: 'Cancel Friday.' }),
      message(2, {
        kind: 'answer',
        text: 'Which classes?',
        pages: [],
        lessons: [],
        choices: ['Oxford 7A', 'Oxford 7B'],
      }),
    ]);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json(listed(asking)),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(asking),
      'POST /api/assistant/questions': () => json({ conversation: asking }),
    });
    renderApp('/', 'en');
    const panel = await openConversation();
    const choices = within(await panel.findByRole('list', { name: en.assistant.choices }));
    fireEvent.click(choices.getByRole('button', { name: 'Oxford 7B' }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/assistant/questions')?.body).toEqual({
        role: 'super_admin',
        text: 'Oxford 7B',
        conversationId: uid(1),
        place: expect.anything() as unknown,
      });
    });
  });

  it('offers no choices under an answer that is not the newest message', async () => {
    const later = conversation([
      message(1, { kind: 'question', text: 'Cancel Friday.' }),
      message(2, { kind: 'answer', text: 'Which?', pages: [], lessons: [], choices: ['A', 'B'] }),
      message(3, { kind: 'question', text: 'A' }),
      message(4, { kind: 'answer', text: 'Done.', pages: [], lessons: [] }),
    ]);
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json(listed(later)),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(later),
    });
    renderApp('/', 'en');
    const panel = await openConversation();
    expect(await panel.findByText('Done.')).toBeTruthy();
    expect(panel.queryByRole('list', { name: en.assistant.choices })).toBeNull();
  });

  it('offers Continue under a cut answer, sends it as the next part, and shows a stored Continue as such', async () => {
    const cut = conversation([
      message(1, { kind: 'question', text: 'Rename 60 rooms.' }),
      message(2, {
        kind: 'answer',
        text: '40 proposed; 20 left.',
        pages: [],
        lessons: [],
        continues: true,
      }),
    ]);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json(listed(cut)),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(cut),
      'POST /api/assistant/questions': () =>
        json({
          conversation: conversation([
            ...cut.messages,
            message(3, { kind: 'question', text: 'Continue', continued: true }),
          ]),
        }),
    });
    renderApp('/', 'en');
    const panel = await openConversation();
    fireEvent.click(await panel.findByRole('button', { name: en.assistant.continue }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === 'POST /api/assistant/questions')?.body,
      ).toMatchObject({ role: 'super_admin', conversationId: uid(1), continue: true });
    });
  });

  it('offers Undo on a confirmed proposal with a change made, sends it, and draws the changes it does not reverse', async () => {
    const step = (seq: number, state: 'done' | 'refused') => ({
      id: uid(700 + seq),
      seq,
      action: 'ClassesController_archive',
      group: 'classes' as const,
      summary: `Archive class ${String(seq)}.`,
      recordName: null,
      recordNames: null,
      fields: [],
      entries: [],
      previewIssues: [],
      previewCounts: [],
      previewLessons: [],
      previewMore: 0,
      state,
      status: state === 'done' ? 200 : 409,
      code: state === 'done' ? null : 'record_changed',
    });
    const confirmed = conversation(
      [
        message(1, { kind: 'question', text: 'Archive them.' }),
        message(2, { kind: 'answer', text: 'Proposed.', pages: [], lessons: [] }),
      ],
      {
        proposals: [
          {
            id: uid(800),
            questionId: uid(501),
            createdAt: '2026-11-20T05:00:00.000Z',
            expiresAt: '2026-11-20T05:15:00.000Z',
            state: 'confirmed',
            decidedAt: '2026-11-20T05:01:00.000Z',
            steps: [step(1, 'done'), step(2, 'refused')],
          },
        ],
      },
    );
    const undone = conversation(
      [
        ...confirmed.messages,
        message(3, { kind: 'question', text: '', undoOf: uid(800) }),
        message(4, {
          kind: 'answer',
          text: '',
          pages: [],
          lessons: [],
          undo: {
            proposalId: uid(800),
            none: [
              {
                seq: 3,
                action: 'RoomsController_update',
                summary: 'Rename.',
                reason: 'no_reverse',
              },
            ],
          },
        }),
      ],
      { proposals: confirmed.proposals },
    );
    let now: ReturnType<typeof conversation> = confirmed;
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json(listed(confirmed)),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(now),
      [`POST /api/assistant/proposals/${uid(800)}/undo`]: () => {
        now = undone;
        return json({ conversation: undone });
      },
    });
    renderApp('/', 'en');
    const panel = await openConversation();
    const card = within(await panel.findByRole('region', { name: en.assistant.proposal.title }));
    fireEvent.click(card.getByRole('button', { name: en.assistant.proposal.undo }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/assistant/proposals/${uid(800)}/undo`)?.body,
      ).toEqual({ role: 'super_admin' });
    });
    expect(
      await panel.findByText(new RegExp(en.assistant.undoAskedAt.replace('{{time}}', '.+'))),
    ).toBeTruthy();
    const answer = document.querySelector('[data-assistant-undo]');
    expect(answer?.textContent).toContain(en.assistant.undo.reasons.no_reverse);
    // Its Undo is shown: no second Undo is offered.
    expect(panel.queryByRole('button', { name: en.assistant.proposal.undo })).toBeNull();
  });

  it('has every new text in the three languages', () => {
    for (const locale of [en, ru, uz]) {
      expect(locale.assistant.continue).toBeTruthy();
      expect(locale.assistant.undoAsked).toBeTruthy();
      expect(Object.keys(locale.assistant.undo.reasons).sort()).toEqual(
        Object.keys(en.assistant.undo.reasons).sort(),
      );
      expect(locale.assistant.settings.questionMinutes).toBeTruthy();
      expect(locale.errors.assistant_undo_exists).toBeTruthy();
    }
  });
});
