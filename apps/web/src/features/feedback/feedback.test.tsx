import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, refusal, renderApp, sessionOf, type Handler } from '@/testing/render-app';

const ROUTE = 'POST /api/feedback';

/** The app at an address, with the feedback dialog open. */
async function openDialog(
  address = '/',
  send: Handler = () => new Response(null, { status: 204 }),
) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf()),
    [ROUTE]: send,
  });
  const shell = renderApp(address);
  await screen.findByRole('button', { name: en.feedback.button });
  fireEvent.click(screen.getByRole('button', { name: en.feedback.button }));
  const dialog = await screen.findByRole('dialog', { name: en.feedback.title });
  return { ...shell, calls, dialog };
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>(en.feedback.message);

const type = (value: string): void => {
  fireEvent.change(field(), { target: { value } });
};

const send = (dialog: HTMLElement): void => {
  fireEvent.click(within(dialog).getByRole('button', { name: en.feedback.send }));
};

/** What a field says is wrong with it, read the way a screen reader does. */
const errorOf = (input: HTMLElement): string | null => {
  if (input.getAttribute('aria-invalid') !== 'true') {
    return null;
  }
  const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
  return document.getElementById(ids.at(-1) ?? '')?.textContent ?? null;
};

const sentReports = (calls: { route: string; body: unknown }[]) =>
  calls.filter((call) => call.route === ROUTE).map((call) => call.body);

const noDialog = () =>
  waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });

// docs/spec/14-quality-plan.md, Whole system, Monitoring: "A feedback button on
// every page sends a report with the page and role attached." Decided by the
// owner (task 0.8b-3): the button inside the layout only; the page is the path
// without the query; the roles are added by the server.
describe('the feedback dialog', () => {
  it('opens from the top bar with the title, the note and an empty message', async () => {
    const { dialog } = await openDialog();

    expect(within(dialog).getByText(en.feedback.text)).toBeDefined();
    expect(field().value).toBe('');
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    expect(within(dialog).getByRole('status').textContent).toBe('');
  });

  // 12, No lost work: "Forms check each field as it is typed and say in plain words what to fix."
  it('says what to fix when Send is pressed with nothing typed, sends nothing and goes to the field', async () => {
    const { dialog, calls } = await openDialog();
    within(dialog).getByRole('button', { name: en.feedback.send }).focus();

    send(dialog);

    await waitFor(() => {
      expect(errorOf(field())).toBe(en.form.required);
    });
    expect(document.activeElement).toBe(field());
    expect(sentReports(calls)).toEqual([]);

    type('   ');
    expect(errorOf(field())).toBe(en.form.required);
    type('Now there is text.');
    expect(errorOf(field())).toBeNull();
  });

  it('says as it is typed when the text is too long', async () => {
    await openDialog();

    type('x'.repeat(2001));

    expect(errorOf(field())).toBe(en.form.tooLong_other.replace('{{n}}', '2,000'));
  });

  it('sends the page without the query and the text, then shows the sign and an empty field', async () => {
    const { dialog, calls } = await openDialog('/dev/patterns?q=abdullayev');
    type('  The list jumps when the rows arrive.  ');

    send(dialog);

    await waitFor(() => {
      expect(within(dialog).getByRole('status').textContent).toBe(en.feedback.sent);
    });
    expect(sentReports(calls)).toEqual([
      { page: '/dev/patterns', text: 'The list jumps when the rows arrive.' },
    ]);
    expect(field().value).toBe('');
    expect(errorOf(field())).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    // The sign goes away once something new is typed.
    type('A second report.');
    expect(within(dialog).getByRole('status').textContent).toBe('');
  });

  it('is disabled while a report is on its way, so nothing is sent twice', async () => {
    const { dialog } = await openDialog();
    const original = globalThis.fetch;
    // A send that never answers.
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input) =>
        input instanceof Request && input.method === 'POST' && input.url.endsWith('/api/feedback')
          ? new Promise<Response>(() => undefined)
          : original(input),
      ),
    );
    type('Held.');

    send(dialog);

    const button = within(dialog).getByRole('button', { name: en.feedback.send });
    await waitFor(() => {
      expect(
        button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true',
      ).toBe(true);
    });
  });

  it('says that too many reports were sent, with the limit, and keeps the text', async () => {
    const { dialog } = await openDialog('/', () => refusal('too_many_attempts', 429, 3600));
    type('One too many.');

    send(dialog);

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(en.feedback.tooMany_other.replace('{{n}}', '20'));
    expect(field().value).toBe('One too many.');
    expect(within(dialog).getByRole('status').textContent).toBe('');
  });

  it('shows the shared text for another refusal', async () => {
    const { dialog } = await openDialog('/', () => refusal('request_refused', 400));
    type('Refused.');

    send(dialog);

    expect((await within(dialog).findByRole('alert')).textContent).toBe(en.errors.request_refused);
    expect(field().value).toBe('Refused.');
  });

  it('shows the failure of a lost connection', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: en.feedback.button }));
    const dialog = await screen.findByRole('dialog', { name: en.feedback.title });
    type('No connection.');

    send(dialog);

    expect((await within(dialog).findByRole('alert')).textContent).toBe(en.problems.noAnswer);
  });

  it('keeps a text that was typed and not sent while the dialog is closed and opened again', async () => {
    const { dialog } = await openDialog();
    type('Half a thought');

    fireEvent.keyDown(field(), { key: 'Escape' });
    await noDialog();
    fireEvent.click(screen.getByRole('button', { name: en.feedback.button }));
    await screen.findByRole('dialog', { name: en.feedback.title });

    expect(field().value).toBe('Half a thought');
    expect(errorOf(field())).toBeNull();
    expect(dialog).not.toBe(screen.getByRole('dialog'));
  });

  it('closes with Cancel and leaves an open side panel open when Escape closes it', async () => {
    const { dialog } = await openDialog('/dev/patterns?q=abdullayev&open=sample-0002');
    expect(screen.getByRole('complementary', { name: 'Bekzod Abdullayev' })).toBeDefined();

    fireEvent.keyDown(field(), { key: 'Escape' });
    await noDialog();
    expect(screen.getByRole('complementary', { name: 'Bekzod Abdullayev' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: en.feedback.button }));
    const again = await screen.findByRole('dialog', { name: en.feedback.title });
    fireEvent.click(within(again).getByRole('button', { name: en.confirm.cancel }));
    await noDialog();
    expect(dialog).not.toBe(again);
  });

  // Decided by the owner: inside the layout only.
  it('is not on the sign-in page', async () => {
    fakeApi({ 'GET /api/auth/session': () => refusal('not_signed_in', 401) });
    renderApp('/sign-in');
    await screen.findByRole('heading', { name: en.signIn.title });

    expect(screen.queryByRole('button', { name: en.feedback.button })).toBeNull();
  });
});
