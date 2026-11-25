import type { AssistantActions, AssistantConversation, AssistantMessage } from '@sodiq/shared';
import { ASSISTANT_DATA_GROUPS } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// Task 11.20 (`02`, Assistant, Switches; Personal data and the model; Never, whatever the
// switches; build plan: "The proposal of many entries of one kind (attendance for a lesson)
// shows them as one grouped step list"). All names are invented.

/** A label that starts with these words (an action's switch also names its kind). */
const startsWith = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\const uid = (n: number)')}`);

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const admin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const SETTINGS = {
  schoolOn: true,
  rolesOn: ['super_admin'],
  dailyLimit: 30,
  monthlyCapDollars: 300,
  questionActions: 40,
  proposalSteps: 100,
  questionMinutes: 10,
  roles: ['super_admin', 'academic_vice_principal', 'teacher'],
  spentThisMonthCents: 0,
  modelConfigured: true,
  model: 'gemini-3.5-flash',
  fallbackOn: true,
  dataGroupsOn: [...ASSISTANT_DATA_GROUPS],
  fallbackQuestionsThisMonth: 0,
};

const action = (route: string, operation: string, on: boolean, kind = 'change' as const) => ({
  route,
  operation,
  kind,
  on,
  defaultOn: on,
  hasTool: true,
});

const CATALOGUE: AssistantActions = {
  roles: [
    {
      role: 'super_admin',
      areas: [
        {
          area: 'rooms',
          on: true,
          actions: [
            action('PUT /api/setup/rooms/:id', 'RoomsController_edit', true),
            action('POST /api/setup/rooms', 'RoomsController_create', true),
          ],
        },
        {
          area: 'account_access',
          on: true,
          actions: [
            action(
              'POST /api/people/staff/:id/account/password-reset',
              'AccountAccessController_resetPassword',
              false,
            ),
          ],
        },
      ],
    },
    { role: 'academic_vice_principal', areas: [] },
    { role: 'teacher', areas: [] },
  ],
};

describe('the Assistant settings page', () => {
  it('switches one action and a whole area, each at once, and the personal-data groups with the settings', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () =>
        json({ available: true, refusal: null, questionsLeftToday: 30, files: false }),
      'GET /api/setup/school-settings/assistant': () => json(SETTINGS),
      'PUT /api/setup/school-settings/assistant': (body) =>
        json({ ...SETTINGS, ...(body as object) }),
      'GET /api/assistant/actions': () => json(CATALOGUE),
      'PUT /api/assistant/actions': () => json(CATALOGUE),
    });
    renderApp('/setup/assistant', 'en');
    expect(
      await screen.findByRole('heading', { name: en.assistant.settingsPage.title }),
    ).toBeTruthy();
    const actions = within(
      await screen.findByRole('region', { name: en.assistant.settingsPage.actions }),
    );
    // The area's name and count, then its actions by their names on the screens.
    expect(await actions.findByText(en.assistant.areas.rooms)).toBeTruthy();
    expect(
      actions.getByText(
        en.assistant.settingsPage.count.replace('{{on}}', '2').replace('{{total}}', '2'),
      ),
    ).toBeTruthy();
    fireEvent.click(actions.getByLabelText(startsWith(en.assistant.actions.RoomsController_edit)));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'PUT /api/assistant/actions')?.body).toEqual({
        changes: [
          { role: 'super_admin', area: 'rooms', route: 'PUT /api/setup/rooms/:id', on: false },
        ],
      });
    });
    fireEvent.click(
      actions.getByLabelText(
        en.assistant.settingsPage.areaSwitch.replace('{{area}}', en.assistant.areas.account_access),
      ),
    );
    await waitFor(() => {
      expect(
        calls.filter((call) => call.route === 'PUT /api/assistant/actions').at(-1)?.body,
      ).toEqual({
        changes: [{ role: 'super_admin', area: 'account_access', on: true }],
      });
    });
    // "Off at the start" beside the heavy action.
    expect(actions.getAllByText(new RegExp(en.assistant.settingsPage.offAtStart)).length).toBe(1);
    // A search narrows the list by the names on the screens.
    fireEvent.change(actions.getByLabelText(en.assistant.settingsPage.search), {
      target: { value: 'password' },
    });
    expect(actions.queryByText(en.assistant.areas.rooms)).toBeNull();
    // The personal-data groups go with the settings' Save.
    const settings = within(
      await screen.findByRole('region', { name: en.assistant.settings.title }),
    );
    fireEvent.click(settings.getByLabelText(en.assistant.settings.dataGroup_medical));
    fireEvent.click(settings.getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      const sent = calls.find((call) => call.route === 'PUT /api/setup/school-settings/assistant');
      expect((sent?.body as { dataGroupsOn: string[] } | undefined)?.dataGroupsOn).toEqual(
        ASSISTANT_DATA_GROUPS.filter((group) => group !== 'medical'),
      );
    });
  });

  it('names the areas and actions in Uzbek and Russian too', async () => {
    for (const [language, texts] of [
      ['uz', uz],
      ['ru', ru],
    ] as const) {
      fakeApi({
        'GET /api/auth/session': () => json({ ...admin(), language }),
        'GET /api/assistant/status': () =>
          json({ available: true, refusal: null, questionsLeftToday: 30, files: false }),
        'GET /api/setup/school-settings/assistant': () => json(SETTINGS),
        'GET /api/assistant/actions': () => json(CATALOGUE),
      });
      renderApp('/setup/assistant', language);
      const actions = within(
        await screen.findByRole('region', { name: texts.assistant.settingsPage.actions }),
      );
      expect(await actions.findByText(texts.assistant.areas.rooms)).toBeTruthy();
      expect(
        actions.getByLabelText(startsWith(texts.assistant.actions.RoomsController_edit)),
      ).toBeTruthy();
      document.body.innerHTML = '';
    }
  });
});

const message = (seq: number, fields: Partial<AssistantMessage> & Pick<AssistantMessage, 'kind'>) =>
  ({ id: uid(500 + seq), seq, at: '2026-11-20T05:00:00.000Z', ...fields }) as AssistantMessage;

const conversationWith = (state: 'waiting' | 'confirmed', stepState: 'waiting' | 'done') =>
  ({
    id: uid(1),
    branchId: NORTH.id,
    branchName: NORTH.name,
    role: 'super_admin',
    title: 'Reset and mark.',
    createdAt: '2026-11-20T05:00:00.000Z',
    lastActivityAt: '2026-11-20T05:00:00.000Z',
    archived: false,
    archivesAt: '2027-02-18T05:00:00.000Z',
    messages: [
      message(1, { kind: 'question', text: 'Mark everyone present.' }),
      message(2, { kind: 'answer', text: 'Proposed.', pages: [], lessons: [], links: [] }),
    ],
    proposals: [
      {
        id: uid(800),
        questionId: uid(501),
        createdAt: '2026-11-20T05:00:00.000Z',
        expiresAt: '2026-11-20T05:15:00.000Z',
        state,
        decidedAt: state === 'confirmed' ? '2026-11-20T05:01:00.000Z' : null,
        steps: [
          {
            id: uid(700),
            seq: 1,
            action: 'AttendanceController_save',
            group: 'journal',
            summary: 'Everyone present.',
            recordName: null,
            recordNames: null,
            fields: [],
            entries: [
              { name: 'Karimova Dilnoza', value: 'present' },
              { name: 'Rahimov Aziz', value: 'present' },
            ],
            previewIssues: [],
            previewCounts: [],
            previewLessons: [],
            previewMore: 0,
            state: stepState,
            status: stepState === 'done' ? 200 : 0,
            code: null,
          },
        ],
      },
    ],
    working: null,
  }) as unknown as AssistantConversation;

describe('a proposal of many entries, and a secret shown once', () => {
  it('lists each student’s entry under its one step, and shows a secret of Confirm once, gone when closed', async () => {
    const waiting = conversationWith('waiting', 'waiting');
    const done = conversationWith('confirmed', 'done');
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () =>
        json({ available: true, refusal: null, questionsLeftToday: 30, files: false }),
      'GET /api/assistant/conversations': () =>
        json({ conversations: [{ ...waiting, messages: undefined, proposals: undefined }] }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(waiting),
      [`POST /api/assistant/proposals/${uid(800)}/confirm`]: () =>
        json({
          ...done,
          secrets: [
            {
              stepId: uid(700),
              items: [
                {
                  login: 'd.karimova',
                  password: 'Sentinel-Pass-77',
                  validUntil: '2026-11-21T05:00:00.000Z',
                },
              ],
            },
          ],
        }),
    });
    const shell = renderApp('/', 'en');
    fireEvent.click(await screen.findByRole('button', { name: en.assistant.open }));
    const panel = within(await screen.findByRole('complementary', { name: en.assistant.title }));
    fireEvent.click(await panel.findByRole('button', { name: /Reset and mark/ }));
    const card = within(await panel.findByRole('region', { name: en.assistant.proposal.title }));
    const entries = within(card.getByRole('list', { name: en.assistant.proposal.entries }));
    expect(entries.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `Karimova Dilnoza: ${en.journal.marks.present}`,
      `Rahimov Aziz: ${en.journal.marks.present}`,
    ]);
    fireEvent.click(card.getByRole('button', { name: en.assistant.proposal.confirm }));
    const secret = within(
      await panel.findByRole('region', { name: en.assistant.proposal.secretTitle }),
    );
    expect(secret.getByText('Sentinel-Pass-77')).toBeTruthy();
    fireEvent.click(secret.getByRole('button', { name: en.assistant.proposal.secretClose }));
    await waitFor(() => {
      expect(panel.queryByText('Sentinel-Pass-77')).toBeNull();
    });
    // `.claude/rules/web.md`, a secret an answer holds once: no query or mutation keeps it.
    await waitFor(() => {
      const kept = JSON.stringify([
        shell.queryClient
          .getMutationCache()
          .getAll()
          .map((one) => [one.state.data, one.state.variables]),
        shell.queryClient
          .getQueryCache()
          .getAll()
          .map((one) => one.state.data),
      ]);
      expect(kept).not.toContain('Sentinel-Pass-77');
    });
  });
});
