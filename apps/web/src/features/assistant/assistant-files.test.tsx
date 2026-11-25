import type { AssistantConversation, AssistantMessage } from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { resetDraftFiles } from './assistant-files';

// Task 11.22 (`02`, Assistant, Files, photos and voice; `12`, No lost work). The paperclip, the
// chips of the files attached, the check of type and size before an upload, the microphone of a
// phone, and the files of a conversation to download. All names are invented.

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const admin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const ON = { available: true, refusal: null, questionsLeftToday: null, files: true };

const message = (seq: number, fields: Partial<AssistantMessage> & Pick<AssistantMessage, 'kind'>) =>
  ({ id: uid(500 + seq), seq, at: '2026-11-20T05:00:00.000Z', ...fields }) as AssistantMessage;

const conversation = (messages: AssistantMessage[]): AssistantConversation => ({
  id: uid(1),
  branchId: NORTH.id,
  branchName: NORTH.name,
  role: 'super_admin',
  title: 'Absences',
  createdAt: '2026-11-20T05:00:00.000Z',
  lastActivityAt: '2026-11-20T05:00:00.000Z',
  archived: false,
  archivesAt: '2027-02-18T05:00:00.000Z',
  messages,
  proposals: [],
  working: null,
});

const stored = (n: number, name: string, mediaType = 'image/png', size = 64) => ({
  id: uid(n),
  kind: 'attachment' as const,
  name,
  mediaType,
  size,
});

async function openPanel() {
  fireEvent.click(await screen.findByRole('button', { name: en.assistant.open }));
  return within(await screen.findByRole('complementary', { name: en.assistant.title }));
}

function choose(panel: ReturnType<typeof within>, files: File[]): void {
  const input = panel
    .getByRole('button', { name: en.assistant.files.attach })
    .parentElement?.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('The paperclip has its input.');
  fireEvent.change(input, { target: { files } });
}

afterEach(() => {
  // The files live outside the chat, as the typed words do: each test starts with none.
  resetDraftFiles();
});

describe('files in the assistant’s chat', () => {
  it('uploads a chosen photo at once, shows its chip, sends it with the question and clears it', async () => {
    const answered = conversation([
      message(1, {
        kind: 'question',
        text: 'Mark these absent.',
        files: [stored(10, 'Absences 7B.png')],
        voice: false,
      }),
      message(2, { kind: 'answer', text: 'I read three names.', pages: [], lessons: [] }),
    ]);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'PUT /api/assistant/files': () => json(stored(10, 'Absences 7B.png')),
      'POST /api/assistant/questions': () => json({ conversation: answered }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () => json(answered),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    choose(panel, [new File(['png'], 'Absences 7B.png', { type: 'image/png' })]);
    const chips = await panel.findByRole('list', { name: en.assistant.files.attached });
    expect(within(chips).getByText('Absences 7B.png')).toBeTruthy();
    expect(calls.find((call) => call.route === 'PUT /api/assistant/files')?.query).toContain(
      'kind=attachment',
    );
    fireEvent.change(panel.getByLabelText(en.assistant.question), {
      target: { value: 'Mark these absent.' },
    });
    fireEvent.click(panel.getByRole('button', { name: en.assistant.send }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/assistant/questions')?.body).toEqual({
        role: 'super_admin',
        text: 'Mark these absent.',
        place: { page: '/' },
        files: [uid(10)],
      });
    });
    await waitFor(() => {
      expect(panel.queryByRole('list', { name: en.assistant.files.attached })).toBeNull();
    });
    // The question shows its file, to download.
    expect(
      await panel.findByRole('button', {
        name: en.assistant.files.download.replace('{{name}}', 'Absences 7B.png'),
      }),
    ).toBeTruthy();
  });

  it('refuses a file over its limit and a type not taken before any upload, in plain words', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    const big = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 10_000_001 });
    choose(panel, [big]);
    expect((await panel.findByRole('alert')).textContent).toBe(en.errors.assistant_file_too_large);
    choose(panel, [new File(['a,b'], 'list.csv', { type: 'text/csv' })]);
    await waitFor(() => {
      expect(panel.getByRole('alert').textContent).toBe(en.errors.unsupported_media_type);
    });
    expect(calls.some((call) => call.route === 'PUT /api/assistant/files')).toBe(false);
  });

  it('keeps the chips when the panel closes and opens again (`12`, No lost work)', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'PUT /api/assistant/files': () => json(stored(11, 'Days off.pdf', 'application/pdf')),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    choose(panel, [new File(['%PDF-'], 'Days off.pdf', { type: 'application/pdf' })]);
    await panel.findByText('Days off.pdf');
    fireEvent.click(screen.getByRole('button', { name: en.assistant.open }));
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: en.assistant.title })).toBeNull();
    });
    const again = await openPanel();
    expect(again.getByText('Days off.pdf')).toBeTruthy();
    fireEvent.click(
      again.getByRole('button', {
        name: en.assistant.files.remove.replace('{{name}}', 'Days off.pdf'),
      }),
    );
    expect(again.queryByText('Days off.pdf')).toBeNull();
  });

  it('hides the paperclip and the microphone without a store of files', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json({ ...ON, files: false }),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    await panel.findByLabelText(en.assistant.question);
    expect(panel.queryByRole('button', { name: en.assistant.files.attach })).toBeNull();
    expect(panel.queryByRole('button', { name: en.assistant.files.record })).toBeNull();
  });

  it('shows the microphone only on a phone width where the browser records', async () => {
    const narrow = (phone: boolean) => {
      vi.stubGlobal(
        'matchMedia',
        (query: string) =>
          ({
            matches: !phone,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }) as unknown as MediaQueryList,
      );
      return { mockRestore: () => undefined };
    };
    const recorder = vi.fn() as unknown as typeof MediaRecorder;
    vi.stubGlobal('MediaRecorder', recorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new Error('no')) },
      configurable: true,
    });
    try {
      for (const phone of [false, true]) {
        const spy = narrow(phone);
        fakeApi({
          'GET /api/auth/session': () => json(admin()),
          'GET /api/assistant/status': () => json(ON),
          'GET /api/assistant/conversations': () => json({ conversations: [] }),
        });
        renderApp('/', 'en');
        const panel = await openPanel();
        await panel.findByLabelText(en.assistant.question);
        expect(
          panel.queryByRole('button', { name: en.assistant.files.record }) !== null,
          String(phone),
        ).toBe(phone);
        cleanup();
        spy.mockRestore();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows an export of an answer and a spoken question in three languages', async () => {
    const answered = conversation([
      message(1, {
        kind: 'question',
        text: 'Bugun kim yoʻq?',
        voice: true,
        files: [
          { id: uid(20), kind: 'voice', name: 'question.webm', mediaType: 'audio/webm', size: 300 },
        ],
      }),
      message(2, {
        kind: 'answer',
        text: 'Here is the list.',
        pages: [],
        lessons: [],
        files: [
          {
            id: uid(21),
            kind: 'export',
            name: 'students.xlsx',
            mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 9000,
          },
        ],
      }),
    ]);
    for (const [language, texts] of [
      ['en', en],
      ['uz', uz],
      ['ru', ru],
    ] as const) {
      fakeApi({
        'GET /api/auth/session': () => json(admin()),
        'GET /api/assistant/status': () => json(ON),
        'GET /api/assistant/conversations': () =>
          json({ conversations: [{ ...answered, messages: undefined }] }),
        [`GET /api/assistant/conversations/${uid(1)}`]: () => json(answered),
      });
      renderApp(`/assistant?conversation=${uid(1)}`, language);
      expect(
        await screen.findByRole('button', {
          name: texts.assistant.files.download.replace('{{name}}', 'students.xlsx'),
        }),
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: texts.assistant.files.recordingFile }),
      ).toBeTruthy();
      expect(screen.getByText(texts.assistant.files.spoken)).toBeTruthy();
      cleanup();
    }
  });
});
