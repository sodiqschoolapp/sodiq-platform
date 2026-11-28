import type { AssistantConversation, AssistantMessage, AssistantProgress } from '@sodiq/shared';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import type { LiveConnector, LiveHandlers } from '@/features/notifications/live';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { resetDraftFiles } from './assistant-files';

// The owner's request of 28 November 2026 for the assistant's chat, in the panel and on the
// Assistant page (they draw the same chat): it follows new messages unless the reader scrolled up,
// takes files pasted with Ctrl+V as the paperclip takes them, cuts long conversation names with an
// ellipsis, and grows the question box with its text. All names are invented.

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-11-20T05:00:00.000Z';
const ON = { available: true, refusal: null, questionsLeftToday: null, files: true };
const LONG =
  'Which pupils of 7 Oxford missed more than three lessons of mathematics in the second quarter and why';

const admin = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const message = (seq: number, fields: Partial<AssistantMessage> & Pick<AssistantMessage, 'kind'>) =>
  ({ id: uid(500 + seq), seq, at: AT, ...fields }) as AssistantMessage;

const QUESTION = message(1, { kind: 'question', text: 'Who is absent today?', files: [] });

const conversation = (
  messages: AssistantMessage[],
  fields: Partial<AssistantConversation> = {},
): AssistantConversation => ({
  id: uid(1),
  branchId: NORTH.id,
  branchName: NORTH.name,
  role: 'super_admin',
  title: 'Absences',
  createdAt: AT,
  lastActivityAt: AT,
  archived: false,
  archivesAt: '2027-02-18T05:00:00.000Z',
  messages,
  proposals: [],
  working: null,
  ...fields,
});

const summary = (title: string) => ({
  id: uid(1),
  branchId: NORTH.id,
  branchName: NORTH.name,
  role: 'super_admin' as const,
  title,
  createdAt: AT,
  lastActivityAt: AT,
});

const stored = (n: number, name: string) => ({
  id: uid(n),
  kind: 'attachment' as const,
  name,
  mediaType: 'image/png',
  size: 3,
});

async function openPanel() {
  fireEvent.click(await screen.findByRole('button', { name: en.assistant.open }));
  return within(await screen.findByRole('complementary', { name: en.assistant.title }));
}

/** A paste into an element; `true` when the browser's own paste goes ahead. */
function paste(target: Element, data: { files?: File[]; items?: unknown[]; text?: string }) {
  return fireEvent.paste(target, {
    clipboardData: {
      files: data.files ?? [],
      items: data.items ?? [],
      getData: () => data.text ?? '',
    },
  });
}

/** A fake live connection: the test tells the tab what the server would. */
function fakeLive() {
  const handlers: LiveHandlers[] = [];
  const connect: LiveConnector = (given) => {
    handlers.push(given);
    return { close: () => undefined };
  };
  const tell = (event: AssistantProgress['event']) => {
    act(() => {
      for (const one of handlers) {
        one.onAssistant({ conversationId: uid(1), questionId: QUESTION.id, event });
      }
    });
  };
  return { connect, tell };
}

/** The scroll box of the messages, measured as a browser would (jsdom lays nothing out). */
function measured(box: HTMLElement, sizes: { height: number; client: number; top: number }) {
  let top = sizes.top;
  Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => sizes.height });
  Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => sizes.client });
  Object.defineProperty(box, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    top = options.top ?? top;
  });
  Object.defineProperty(box, 'scrollTo', { configurable: true, value: scrollTo });
  return {
    scrollTo,
    /** The reader scrolls to `to`. */
    scroll: (to: number) => {
      top = to;
      fireEvent.scroll(box);
    },
  };
}

/** Whether the system asks for reduced motion, for every query of the page. */
function reducedMotion(on: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (media: string) =>
      ({
        matches: media.includes('reduced-motion') ? on : true,
        media,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  resetDraftFiles();
});

describe('files pasted into the question box', () => {
  it('attaches a pasted screenshot through the paperclip’s upload, and stops the browser’s own paste', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'PUT /api/assistant/files': () => json(stored(10, 'image.png')),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    const box = await panel.findByLabelText(en.assistant.question);
    // A screenshot comes as a file the browser names, or, in some browsers, as an item with none.
    const shot = new File(['png'], '', { type: 'image/png' });
    const item = { kind: 'file', type: 'image/png', getAsFile: () => shot };
    expect(paste(box, { items: [item] })).toBe(false);
    const chips = await panel.findByRole('list', { name: en.assistant.files.attached });
    expect(within(chips).getByText('image.png')).toBeTruthy();
    const upload = calls.find((call) => call.route === 'PUT /api/assistant/files');
    expect(upload?.query).toContain('kind=attachment');
    expect(upload?.query).toContain('name=image.png');
  });

  it('refuses a pasted file of a type not taken with the paperclip’s words, before any upload', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    const box = await panel.findByLabelText(en.assistant.question);
    expect(paste(box, { files: [new File(['a,b'], 'list.csv', { type: 'text/csv' })] })).toBe(
      false,
    );
    expect((await panel.findByRole('alert')).textContent).toBe(en.errors.unsupported_media_type);
    expect(calls.some((call) => call.route === 'PUT /api/assistant/files')).toBe(false);
  });

  it('leaves a paste of text to the browser, and a paste of files where the school keeps none', async () => {
    for (const files of [true, false]) {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(admin()),
        'GET /api/assistant/status': () => json({ ...ON, files }),
        'GET /api/assistant/conversations': () => json({ conversations: [] }),
      });
      renderApp('/', 'en');
      const panel = await openPanel();
      const box = await panel.findByLabelText(en.assistant.question);
      if (files) {
        await panel.findByRole('button', { name: en.assistant.files.attach });
        expect(paste(box, { text: 'Who is absent today?' })).toBe(true);
      } else {
        await waitFor(() => {
          expect(calls.some((call) => call.route === 'GET /api/assistant/status')).toBe(true);
        });
        const shot = new File(['png'], 'image.png', { type: 'image/png' });
        expect(paste(box, { files: [shot] })).toBe(true);
      }
      expect(panel.queryByRole('alert')).toBeNull();
      expect(calls.some((call) => call.route === 'PUT /api/assistant/files')).toBe(false);
      cleanup();
    }
  });
});

describe('the messages follow their end', () => {
  const setUp = async () => {
    const live = fakeLive();
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [summary('Absences')] }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () =>
        json(
          conversation([QUESTION], {
            working: {
              questionId: QUESTION.id,
              askedAt: AT,
              until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          }),
        ),
    });
    renderApp(`/assistant?conversation=${uid(1)}`, 'en', undefined, live.connect);
    expect(await screen.findByText(en.assistant.working)).toBeTruthy();
    const box = document.querySelector('[data-assistant-messages]');
    if (!(box instanceof HTMLElement)) throw new Error('The chat has its box of messages.');
    return { live, box };
  };

  it('follows the answer as it is written while the reader is near the end', async () => {
    reducedMotion(false);
    const { live, box } = await setUp();
    const sizes = { height: 1000, client: 300, top: 0 };
    const view = measured(box, sizes);
    // 40 px from the end: within 80, still at the end.
    view.scroll(660);
    sizes.height = 1200;
    live.tell({ kind: 'text', seq: 1, delta: 'Three pupils are absent.' });
    await screen.findByText('Three pupils are absent.');
    expect(box.scrollTop).toBe(1200);
    expect(screen.queryByRole('button', { name: en.assistant.newMessages })).toBeNull();
  });

  it('leaves a reader who scrolled up where they are and offers New messages, which scrolls to the end', async () => {
    reducedMotion(false);
    const { live, box } = await setUp();
    const sizes = { height: 1000, client: 300, top: 0 };
    const view = measured(box, sizes);
    view.scroll(200);
    sizes.height = 1200;
    live.tell({ kind: 'text', seq: 1, delta: 'Three pupils are absent.' });
    const button = await screen.findByRole('button', { name: en.assistant.newMessages });
    expect(box.scrollTop).toBe(200);
    fireEvent.click(button);
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: en.assistant.newMessages })).toBeNull();
    // The smooth scroll's own events on its way down do not count as the reader's.
    view.scroll(700);
    sizes.height = 1300;
    live.tell({ kind: 'text', seq: 2, delta: ' Two are ill.' });
    await screen.findByText('Three pupils are absent. Two are ill.');
    expect(box.scrollTop).toBe(1300);
  });

  it('jumps without a smooth scroll when the system asks for reduced motion', async () => {
    reducedMotion(true);
    const { live, box } = await setUp();
    const sizes = { height: 1000, client: 300, top: 0 };
    const view = measured(box, sizes);
    view.scroll(100);
    sizes.height = 1100;
    live.tell({ kind: 'text', seq: 1, delta: 'Three pupils are absent.' });
    fireEvent.click(await screen.findByRole('button', { name: en.assistant.newMessages }));
    expect(view.scrollTo).not.toHaveBeenCalled();
    expect(box.scrollTop).toBe(1100);
  });

  it('scrolls to the end when a question is sent, wherever the reader was', async () => {
    reducedMotion(false);
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [summary('Absences')] }),
      [`GET /api/assistant/conversations/${uid(1)}`]: () =>
        json(
          conversation([
            QUESTION,
            message(2, { kind: 'answer', text: 'Nobody.', pages: [], lessons: [], files: [] }),
          ]),
        ),
      // The server has not taken it yet: the question shows as sent.
      'POST /api/assistant/questions': () => new Promise<Response>(() => undefined),
    });
    renderApp(`/assistant?conversation=${uid(1)}`, 'en');
    await screen.findByText('Nobody.');
    const box = document.querySelector('[data-assistant-messages]');
    if (!(box instanceof HTMLElement)) throw new Error('The chat has its box of messages.');
    const sizes = { height: 1000, client: 300, top: 0 };
    const view = measured(box, sizes);
    view.scroll(0);
    sizes.height = 1100;
    fireEvent.change(screen.getByLabelText(en.assistant.question), {
      target: { value: 'And yesterday?' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.assistant.send }));
    await waitFor(() => {
      expect(view.scrollTo).toHaveBeenCalledWith({ top: 1100, behavior: 'smooth' });
    });
    expect(screen.queryByRole('button', { name: en.assistant.newMessages })).toBeNull();
  });
});

describe('long conversation names', () => {
  it('cut with an ellipsis in the panel’s list and the page’s list, the whole name in the tooltip', async () => {
    for (const where of ['panel', 'page'] as const) {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(admin()),
        'GET /api/assistant/status': () => json(ON),
        'GET /api/assistant/conversations': () => json({ conversations: [summary(LONG)] }),
      });
      renderApp(where === 'panel' ? '/' : '/assistant', 'en');
      const scope = where === 'panel' ? await openPanel() : within(document.body);
      const name = await scope.findByText(LONG);
      expect(name.getAttribute('title'), where).toBe(LONG);
      expect(name.className.split(' '), where).toEqual(expect.arrayContaining(['truncate']));
      // Neither the row nor the list takes the width of the whole name.
      const row = name.closest('li');
      expect(row?.className.split(' '), where).toEqual(expect.arrayContaining(['min-w-0']));
      expect(name.closest('button')?.className.split(' '), where).toEqual(
        expect.arrayContaining(['w-full', 'min-w-0']),
      );
      expect(row?.parentElement?.className.split(' '), where).toEqual(
        expect.arrayContaining(['min-w-0', 'grid-cols-1']),
      );
      expect(calls.length).toBeGreaterThan(0);
      cleanup();
    }
  });

  it('cut after two lines in the list of every conversation, the whole name in the tooltip', async () => {
    const word = 'Oʻquvchilarningdavomatihisobotikvartalboʻyichatoʻliqroʻyxati';
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/all-conversations': () =>
        json({
          conversations: [{ ...summary(word), archived: false, personName: 'Valiyev Anvar' }],
        }),
    });
    renderApp('/assistant-conversations', 'en');
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr').length).toBe(1);
    });
    const cell = document.querySelector(`tbody tr span[title="${word}"]`);
    expect(cell?.textContent).toBe(word);
    expect(cell?.className.split(' ')).toEqual(
      expect.arrayContaining(['line-clamp-2', 'wrap-anywhere']),
    );
  });
});

describe('the question box', () => {
  const setUp = async () => {
    fakeApi({
      'GET /api/auth/session': () => json(admin()),
      'GET /api/assistant/status': () => json(ON),
      'GET /api/assistant/conversations': () => json({ conversations: [] }),
      'POST /api/assistant/questions': () => new Promise<Response>(() => undefined),
    });
    renderApp('/', 'en');
    const panel = await openPanel();
    return panel.findByLabelText<HTMLTextAreaElement>(en.assistant.question);
  };

  it('has no fixed height, and grows from two lines up to a part of the window', async () => {
    const box = await setUp();
    const classes = box.className.split(' ');
    for (const fixed of ['h-10', 'max-sm:h-11', 'h-auto']) expect(classes).not.toContain(fixed);
    expect(classes).toEqual(
      expect.arrayContaining([
        'field-sizing-content',
        'min-h-[3.625rem]',
        'max-h-[40dvh]',
        'max-sm:max-h-[min(40dvh,10rem)]',
        'overflow-y-auto',
        'resize-none',
      ]),
    );
    expect(box.rows).toBe(2);
    // Where the browser sizes it by its content (`field-sizing`), nothing measures it.
    fireEvent.change(box, { target: { value: 'One\nTwo\nThree' } });
    expect(box.style.height).toBe('');
  });

  it('measures its text where the browser cannot size it by its content, and keeps the caret’s line in view', async () => {
    // A browser without `field-sizing`, as Firefox and Safari today (jsdom says it has it).
    vi.stubGlobal('CSS', { supports: () => false });
    const box = await setUp();
    let height = 58;
    let top = 0;
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(box, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    height = 180;
    fireEvent.change(box, { target: { value: 'One\nTwo\nThree\nFour\nFive\nSix\nSeven' } });
    await waitFor(() => {
      expect(box.style.height).toBe('180px');
    });
    expect(box.scrollTop).toBe(180);
    height = 58;
    fireEvent.change(box, { target: { value: 'One' } });
    await waitFor(() => {
      expect(box.style.height).toBe('58px');
    });
  });

  it('still sends on Enter and adds a line on Shift+Enter', async () => {
    const box = await setUp();
    fireEvent.change(box, { target: { value: 'Who is absent?' } });
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false);
  });
});
