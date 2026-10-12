import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import {
  fakeApi,
  json,
  nothing,
  refusal,
  renderApp,
  sessionOf,
  type Handler,
} from '@/testing/render-app';

const heading = (name: string) => screen.findByRole('heading', { name });
const press = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
};
const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const section = (title: string) => within(screen.getByRole('region', { name: title }));

/** The confirmation dialog of the app; the button that goes on names the action. */
async function confirmDialog(action: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: action }));
}

const LAPTOP = {
  id: '0199a000-0000-7000-8000-000000000001',
  startedAt: '2026-10-07T04:00:00.000Z',
  lastUsedAt: '2026-10-07T05:30:00.000Z',
  userAgent: 'Invented Browser 12 on a laptop',
  current: true,
  trusted: true,
};
const PHONE = {
  id: '0199a000-0000-7000-8000-000000000002',
  startedAt: '2026-10-06T10:00:00.000Z',
  lastUsedAt: '2026-10-06T10:05:00.000Z',
  userAgent: null,
  current: false,
  trusted: false,
};
const CLASSROOM = {
  id: '0199a000-0000-7000-8000-000000000003',
  startedAt: '2026-10-05T03:00:00.000Z',
  lastUsedAt: '2026-10-07T03:00:00.000Z',
  userAgent: 'Invented Browser 12 in a classroom',
  current: false,
  trusted: true,
};

const device = (row: typeof LAPTOP | typeof CLASSROOM) => ({
  id: row.id,
  startedAt: row.startedAt,
  lastUsedAt: row.lastUsedAt,
  userAgent: row.userAgent,
  trustedUntil: '2026-10-14T04:00:00.000Z',
  current: row.current,
});

const OFF = { on: false, required: false, recoveryCodesLeft: 0 };
const ON = { on: true, required: false, recoveryCodesLeft: 7 };

/** The account page with the given answers; the rest is the usual. */
function openAccount(handlers: Record<string, Handler> = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ trustedUntil: '2026-10-14T04:00:00.000Z' })),
    'GET /api/auth/sessions': () => json({ sessions: [LAPTOP, PHONE, CLASSROOM] }),
    'GET /api/auth/trusted-devices': () => json({ devices: [device(LAPTOP), device(CLASSROOM)] }),
    'GET /api/auth/second-step': () => json(OFF),
    ...handlers,
  });
  const shell = renderApp('/account');
  return { calls, shell };
}

// Edge cases, "Accounts and sign-in": one account is open on a classroom
// computer, a phone and at home; the profile lists the sessions, with "sign
// out everywhere", and the trusted devices, each removable. Decided by the
// owner (task 0.8d): at /account, with the language and the second step.
describe('the account page', () => {
  it('lists the sessions with device, start, last use and the marks, the devices with their end, and the rest', async () => {
    openAccount();
    await heading(en.account.title);

    const sessions = section(en.account.sessionsTitle);
    const rows = await sessions.findAllByRole('row');
    // The header row and the three sessions.
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(en.account.device),
      expect.stringContaining(`${en.account.thisDevice}${en.account.trusted}`),
      expect.stringContaining(en.account.unknownDevice),
      expect.stringContaining('in a classroom'),
    ]);
    // Moments in the language of the page (`12`, Language), not the stored text.
    expect(rows[1]?.textContent).not.toContain('2026-10-07T04:00');
    expect(rows[1]?.textContent).toMatch(/2026/);
    expect(rows[2]?.textContent).not.toContain(en.account.trusted);

    const devices = section(en.account.devicesTitle);
    const deviceRows = await devices.findAllByRole('row');
    expect(deviceRows).toHaveLength(3);
    expect(deviceRows[0]?.textContent).toContain(en.account.trustedUntil);
    expect(deviceRows[1]?.textContent).toContain(en.account.thisDevice);
    expect(devices.getAllByRole('button', { name: /Remove/ })).toHaveLength(2);

    expect(section(en.account.secondStepTitle).getByText(en.account.secondStepOff)).toBeDefined();
    expect(
      section(en.account.secondStepTitle).getByRole('button', { name: en.account.turnOn }),
    ).toBeDefined();
    expect(
      section(en.account.languageTitle).getByLabelText<HTMLSelectElement>(en.language.label).value,
    ).toBe('en');
    expect(
      section(en.account.passwordTitle).getByRole('link', { name: en.layout.changePassword }),
    ).toBeDefined();
  });

  // The entry every role has, in the person menu at the foot of the navy menu
  // (docs/design-system.md, Layout shell; pull request #61, decision 7).
  it('is the entry every role has, and opens from the person menu at the foot of the menu', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'GET /api/auth/sessions': () => json({ sessions: [LAPTOP] }),
      'GET /api/auth/trusted-devices': () => json({ devices: [] }),
      'GET /api/auth/second-step': () => json(OFF),
    });
    renderApp('/');
    await heading(en.home.title);

    fireEvent.click(screen.getByRole('button', { name: en.layout.account }));
    expect(await screen.findByRole('menuitem', { name: en.layout.changePassword })).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: en.account.title }));

    await heading(en.account.title);
  });

  // "Sign out everywhere" keeps this session (owner); its trust ends (spec).
  it('asks before "sign out everywhere", naming the count and the end of the trust, then signs the others out', async () => {
    let signedOut = false;
    const { calls } = openAccount({
      'GET /api/auth/session': () =>
        json(sessionOf({ trustedUntil: signedOut ? null : '2026-10-14T04:00:00.000Z' })),
      'GET /api/auth/sessions': () =>
        json({
          sessions: signedOut ? [{ ...LAPTOP, trusted: false }] : [LAPTOP, PHONE, CLASSROOM],
        }),
      'GET /api/auth/trusted-devices': () =>
        json({ devices: signedOut ? [] : [device(LAPTOP), device(CLASSROOM)] }),
      'POST /api/auth/sign-out-everywhere': () => {
        signedOut = true;
        return nothing();
      },
    });
    await heading(en.account.title);
    await section(en.account.sessionsTitle).findAllByRole('row');

    press(en.account.signOutEverywhere);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('2 other sessions are signed out');
    expect(dialog.textContent).toContain(en.account.signOutEverywhereTrust);
    fireEvent.click(within(dialog).getByRole('button', { name: en.account.signOutEverywhere }));

    expect((await screen.findByText('Signed out of 2 other sessions.')).getAttribute('role')).toBe(
      'status',
    );
    expect(
      calls.filter((call) => call.route === 'POST /api/auth/sign-out-everywhere'),
    ).toHaveLength(1);
    await waitFor(() => {
      expect(section(en.account.sessionsTitle).getAllByRole('row')).toHaveLength(2);
    });
    expect(section(en.account.sessionsTitle).queryByText(en.account.trusted)).toBeNull();
    expect(section(en.account.devicesTitle).getByText(en.account.devicesEmpty)).toBeDefined();
  });

  it('does not name the trust when this device is not trusted, and sends nothing on Cancel', async () => {
    const { calls } = openAccount({
      'GET /api/auth/session': () => json(sessionOf()),
      'GET /api/auth/sessions': () => json({ sessions: [{ ...LAPTOP, trusted: false }, PHONE] }),
    });
    await heading(en.account.title);
    await section(en.account.sessionsTitle).findAllByRole('row');

    press(en.account.signOutEverywhere);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('1 other session is signed out');
    expect(dialog.textContent).not.toContain(en.account.signOutEverywhereTrust);
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(calls.map((call) => call.route)).not.toContain('POST /api/auth/sign-out-everywhere');
  });

  it('shows the failure of "sign out everywhere"', async () => {
    openAccount({ 'POST /api/auth/sign-out-everywhere': () => refusal('internal_error', 500) });
    await heading(en.account.title);
    await section(en.account.sessionsTitle).findAllByRole('row');

    press(en.account.signOutEverywhere);
    await confirmDialog(en.account.signOutEverywhere);

    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.internal_error);
  });

  // "Each can be removed; removing one ends its session at once."
  it('asks before a device is removed, names it, and sends its id', async () => {
    let removed = false;
    const { calls } = openAccount({
      'GET /api/auth/trusted-devices': () =>
        json({ devices: removed ? [device(LAPTOP)] : [device(LAPTOP), device(CLASSROOM)] }),
      'DELETE /api/auth/trusted-devices/0199a000-0000-7000-8000-000000000003': () => {
        removed = true;
        return nothing();
      },
    });
    await heading(en.account.title);
    const devices = section(en.account.devicesTitle);
    await devices.findAllByRole('row');

    fireEvent.click(
      devices.getByRole('button', { name: 'Remove Invented Browser 12 in a classroom' }),
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(en.account.removeText);
    expect(dialog.textContent).toContain('Invented Browser 12 in a classroom');
    fireEvent.click(within(dialog).getByRole('button', { name: en.account.remove }));

    await waitFor(() => {
      expect(section(en.account.devicesTitle).getAllByRole('row')).toHaveLength(2);
    });
    expect(
      calls.filter((call) => call.route.startsWith('DELETE /api/auth/trusted-devices/')),
    ).toEqual([
      {
        route: 'DELETE /api/auth/trusted-devices/0199a000-0000-7000-8000-000000000003',
        body: undefined,
      },
    ]);
    // Still signed in here.
    expect(screen.getByRole('heading', { name: en.account.title })).toBeDefined();
  });

  // Decided by the owner (0.6d): removing the device that asks works like sign-out.
  it('removes this device too, which signs the tab out', async () => {
    const { calls, shell } = openAccount({
      'DELETE /api/auth/trusted-devices/0199a000-0000-7000-8000-000000000001': nothing,
    });
    await heading(en.account.title);
    const devices = section(en.account.devicesTitle);
    await devices.findAllByRole('row');

    fireEvent.click(
      devices.getByRole('button', { name: 'Remove Invented Browser 12 on a laptop' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(en.account.removeThisText);
    fireEvent.click(within(dialog).getByRole('button', { name: en.account.remove }));

    expect(await heading(en.signIn.title)).toBeDefined();
    expect(shell.queryClient.getQueryData(['session'])).toBeNull();
    expect(calls.map((call) => call.route)).toContain(
      'DELETE /api/auth/trusted-devices/0199a000-0000-7000-8000-000000000001',
    );
  });

  it('shows the failure of the devices and of the second step, and asks again on "Try again"', async () => {
    let up = false;
    openAccount({
      'GET /api/auth/trusted-devices': () =>
        up ? json({ devices: [] }) : refusal('internal_error', 500),
      'GET /api/auth/second-step': () => (up ? json(ON) : refusal('internal_error', 500)),
    });
    await heading(en.account.title);
    const devices = section(en.account.devicesTitle);
    const step = section(en.account.secondStepTitle);
    expect((await devices.findByRole('alert')).textContent).toBe(en.errors.internal_error);
    expect((await step.findByRole('alert')).textContent).toBe(en.errors.internal_error);

    up = true;
    fireEvent.click(devices.getByRole('button', { name: en.problems.retry }));
    fireEvent.click(step.getByRole('button', { name: en.problems.retry }));

    expect(await devices.findByText(en.account.devicesEmpty)).toBeDefined();
    expect(await step.findByText(en.account.secondStepOn)).toBeDefined();
  });

  it('says that no device is trusted', async () => {
    openAccount({ 'GET /api/auth/trusted-devices': () => json({ devices: [] }) });
    await heading(en.account.title);

    expect(await screen.findByText(en.account.devicesEmpty)).toBeDefined();
  });

  it('shows the failure of a list and asks again on "Try again"', async () => {
    let up = false;
    openAccount({
      'GET /api/auth/sessions': () =>
        up ? json({ sessions: [LAPTOP] }) : new Response('', { status: 502 }),
    });
    await heading(en.account.title);
    const sessions = section(en.account.sessionsTitle);
    expect((await sessions.findByRole('alert')).textContent).toBe(en.problems.noAnswer);

    up = true;
    fireEvent.click(sessions.getByRole('button', { name: en.problems.retry }));

    expect(await sessions.findAllByRole('row')).toHaveLength(2);
  });
});

// `02`, Rules: two-step verification is optional for most roles. Turning it
// off takes a code and nothing more (owner); where it is required there is no
// button, and the server refuses.
describe('the second step on the account page', () => {
  const recoveryCodes = Array.from({ length: 10 }, (_, index) => `code-${String(index)}-abcd`);
  const setUp = {
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    address: 'otpauth://totp/Sodiq%20School:m.ergasheva?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  };

  it('is turned off with a code: a wrong one is refused, a right one turns it off', async () => {
    let on = true;
    const { calls } = openAccount({
      'GET /api/auth/second-step': () => json(on ? ON : OFF),
      'POST /api/auth/second-step/turn-off': (body) => {
        if ((body as { code: string }).code !== '123456') {
          return refusal('second_step_code_wrong', 403);
        }
        on = false;
        return nothing();
      },
    });
    await heading(en.account.title);
    const step = section(en.account.secondStepTitle);
    expect(await step.findByText(en.account.secondStepOn)).toBeDefined();
    expect(step.getByText('7 recovery codes left.')).toBeDefined();
    expect(step.queryByRole('button', { name: en.account.turnOn })).toBeNull();

    fireEvent.click(step.getByRole('button', { name: en.account.turnOff }));
    expect(step.getByText(en.account.turnOffText)).toBeDefined();
    // Nothing is sent for an empty code.
    fireEvent.click(step.getByRole('button', { name: en.account.turnOff }));
    expect(step.getByText(en.setUp.codeMissing)).toBeDefined();
    expect(calls.map((call) => call.route)).not.toContain('POST /api/auth/second-step/turn-off');

    type(en.setUp.code, '000000');
    fireEvent.click(step.getByRole('button', { name: en.account.turnOff }));
    expect((await step.findByRole('alert')).textContent).toBe(en.errors.second_step_code_wrong);

    type(en.setUp.code, '123456');
    fireEvent.click(step.getByRole('button', { name: en.account.turnOff }));

    expect(await step.findByText(en.account.turnedOff)).toBeDefined();
    expect(await step.findByText(en.account.secondStepOff)).toBeDefined();
    expect(step.getByRole('button', { name: en.account.turnOn })).toBeDefined();
    expect(
      calls
        .filter((call) => call.route === 'POST /api/auth/second-step/turn-off')
        .map((call) => call.body),
    ).toEqual([{ code: '000000' }, { code: '123456' }]);
  });

  // Edge cases, "Accounts and sign-in": after five failures each further attempt is delayed.
  it('keeps the "Turn off" button off while the wait after too many attempts lasts', async () => {
    openAccount({
      'GET /api/auth/second-step': () => json(ON),
      'POST /api/auth/second-step/turn-off': () => refusal('too_many_attempts', 429, 1),
    });
    await heading(en.account.title);
    const step = section(en.account.secondStepTitle);
    await step.findByText(en.account.secondStepOn);
    fireEvent.click(step.getByRole('button', { name: en.account.turnOff }));
    type(en.setUp.code, '000000');

    fireEvent.click(step.getByRole('button', { name: en.account.turnOff }));

    expect((await step.findByRole('alert')).textContent).toBe(
      'Too many failed attempts. Try again in 1 second.',
    );
    expect(step.getByRole<HTMLButtonElement>('button', { name: en.account.turnOff }).disabled).toBe(
      true,
    );
    await waitFor(
      () => {
        expect(
          step.getByRole<HTMLButtonElement>('button', { name: en.account.turnOff }).disabled,
        ).toBe(false);
      },
      { timeout: 3000 },
    );
  });

  it('cannot be turned off where the role requires it: the state and the reason, no button', async () => {
    openAccount({
      'GET /api/auth/second-step': () => json({ on: true, required: true, recoveryCodesLeft: 10 }),
    });
    await heading(en.account.title);
    const step = section(en.account.secondStepTitle);

    expect(await step.findByText(en.account.secondStepOn)).toBeDefined();
    expect(step.getByText(en.account.secondStepRequired)).toBeDefined();
    expect(step.queryByRole('button', { name: en.account.turnOff })).toBeNull();
    expect(step.queryByRole('button', { name: en.account.turnOn })).toBeNull();
  });

  it('is turned on through the set-up stages, and the codes stay until they are saved', async () => {
    let on = false;
    const { calls, shell } = openAccount({
      'GET /api/auth/second-step': () => json(on ? { ...ON, recoveryCodesLeft: 10 } : OFF),
      'POST /api/auth/second-step/set-up': () => json(setUp),
      'POST /api/auth/second-step/confirm': () => {
        on = true;
        return json({ recoveryCodes });
      },
    });
    await heading(en.account.title);
    const step = section(en.account.secondStepTitle);
    await step.findByText(en.account.secondStepOff);

    fireEvent.click(step.getByRole('button', { name: en.account.turnOn }));
    expect(step.getByText(en.account.setUpIntro)).toBeDefined();
    // Nothing is started by opening the stage: every start makes a new key.
    expect(calls.map((call) => call.route)).not.toContain('POST /api/auth/second-step/set-up');

    press(en.setUp.start);
    expect(await step.findByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeDefined();
    expect(step.getByRole('img', { name: en.setUp.qr })).toBeDefined();

    type(en.setUp.code, '123456');
    press(en.setUp.confirm);

    expect(await step.findByRole('heading', { name: en.setUp.codesTitle })).toBeDefined();
    expect(step.getAllByRole('listitem').map((item) => item.textContent)).toEqual(recoveryCodes);
    // Not left before "I have saved the codes": a move away is refused.
    void shell.router.navigate({ to: '/' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(shell.router.state.location.pathname).toBe('/account');
    expect(step.getByRole<HTMLButtonElement>('button', { name: en.setUp.continue }).disabled).toBe(
      true,
    );

    fireEvent.click(step.getByRole('checkbox', { name: en.setUp.saved }));
    press(en.setUp.continue);

    expect(await step.findByText(en.account.turnedOn)).toBeDefined();
    expect(step.getByText(en.account.secondStepOn)).toBeDefined();
    expect(step.getByText('10 recovery codes left.')).toBeDefined();
    expect(step.getByRole('button', { name: en.account.turnOff })).toBeDefined();
  });

  it('shows "on" when the set-up says the second step is on already, as from another tab', async () => {
    let on = false;
    openAccount({
      'GET /api/auth/second-step': () => json(on ? ON : OFF),
      'POST /api/auth/second-step/set-up': () => {
        on = true;
        return refusal('second_step_already_on', 409);
      },
    });
    await heading(en.account.title);
    const step = section(en.account.secondStepTitle);
    await step.findByText(en.account.secondStepOff);

    fireEvent.click(step.getByRole('button', { name: en.account.turnOn }));
    press(en.setUp.start);

    expect(await step.findByText(en.account.secondStepOn)).toBeDefined();
    expect(step.queryByText(en.account.setUpIntro)).toBeNull();
  });

  it('begins again when the started set-up is gone on the server', async () => {
    openAccount({
      'POST /api/auth/second-step/set-up': () => json(setUp),
      'POST /api/auth/second-step/confirm': () => refusal('second_step_not_on', 409),
    });
    await heading(en.account.title);
    const step = section(en.account.secondStepTitle);
    await step.findByText(en.account.secondStepOff);
    fireEvent.click(step.getByRole('button', { name: en.account.turnOn }));
    press(en.setUp.start);
    await step.findByLabelText(en.setUp.code);

    type(en.setUp.code, '123456');
    press(en.setUp.confirm);

    expect((await step.findByRole('alert')).textContent).toBe(en.errors.second_step_not_on);
    expect(step.getByRole('button', { name: en.setUp.start })).toBeDefined();
  });

  it('can be left with Cancel before anything is started', async () => {
    openAccount();
    await heading(en.account.title);
    const step = section(en.account.secondStepTitle);
    await step.findByText(en.account.secondStepOff);

    fireEvent.click(step.getByRole('button', { name: en.account.turnOn }));
    fireEvent.click(step.getByRole('button', { name: en.confirm.cancel }));

    expect(step.getByRole('button', { name: en.account.turnOn })).toBeDefined();
  });
});

// `12`, Language: the choice is remembered. Decided by the owner (task 0.8d):
// signed in, the chooser saves to the account.
describe('the language on the account page', () => {
  it('is changed by the field: the page switches at once and the account is told', async () => {
    const { calls } = openAccount({ 'PUT /api/auth/language': nothing });
    await heading(en.account.title);

    fireEvent.change(section(en.account.languageTitle).getByLabelText(en.language.label), {
      target: { value: 'ru' },
    });

    expect(await heading(ru.account.title)).toBeDefined();
    expect(
      section(ru.account.languageTitle).getByLabelText<HTMLSelectElement>(ru.language.label).value,
    ).toBe('ru');
    await waitFor(() => {
      expect(calls.filter((call) => call.route === 'PUT /api/auth/language')).toEqual([
        { route: 'PUT /api/auth/language', body: { language: 'ru' } },
      ]);
    });
  });

  it('shows the failure of the save', async () => {
    openAccount({ 'PUT /api/auth/language': () => refusal('internal_error', 500) });
    await heading(en.account.title);

    fireEvent.change(section(en.account.languageTitle).getByLabelText(en.language.label), {
      target: { value: 'ru' },
    });

    expect((await screen.findByRole('alert')).textContent).toBe(ru.errors.internal_error);
  });
});

// Task 2.3c-2, pull request #66, decision 18: the own photo
// (`edge/people-roles-accounts`: "Staff can change their own ... photo").
describe('the own photo on the account page', () => {
  // A PNG of one pixel; the page shows it as a data: address.
  const PIXEL = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
    ),
    (char) => char.charCodeAt(0),
  );
  const photoAnswer = () =>
    new Response(new Blob([PIXEL], { type: 'image/png' }), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  const named = () => json(sessionOf({ name: { firstName: 'Nodira', lastName: 'Saidova' } }));

  it('shows the initials and "Add photo" while there is no photo', async () => {
    openAccount({
      'GET /api/auth/session': named,
      'GET /api/auth/photo': () => refusal('not_found', 404),
    });
    await heading(en.account.title);
    const photo = section(en.account.photoTitle);
    expect(await photo.findByRole('button', { name: en.account.photoAdd })).toBeDefined();
    expect(photo.getByText('NS')).toBeDefined();
    expect(photo.queryByRole('img')).toBeNull();
    expect(photo.queryByRole('button', { name: en.account.photoRemove })).toBeNull();
  });

  it('shows the photo, and removes it after asking', async () => {
    let removed = false;
    const { calls } = openAccount({
      'GET /api/auth/session': named,
      'GET /api/auth/photo': () => (removed ? refusal('not_found', 404) : photoAnswer()),
      'DELETE /api/auth/photo': () => {
        removed = true;
        return nothing();
      },
    });
    await heading(en.account.title);
    const photo = section(en.account.photoTitle);
    const image = await photo.findByRole('img', { name: 'Nodira Saidova' });
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);

    fireEvent.click(photo.getByRole('button', { name: en.account.photoRemove }));
    await confirmDialog(en.account.photoRemove);
    expect(await photo.findByRole('button', { name: en.account.photoAdd })).toBeDefined();
    expect(calls.some((call) => call.route === 'DELETE /api/auth/photo')).toBe(true);
    expect(photo.queryByRole('img')).toBeNull();
  });

  it('refuses a file that is not a JPEG or PNG before sending it', async () => {
    const { calls } = openAccount({
      'GET /api/auth/session': named,
      'GET /api/auth/photo': () => refusal('not_found', 404),
    });
    await heading(en.account.title);
    const photo = section(en.account.photoTitle);
    await photo.findByRole('button', { name: en.account.photoAdd });
    fireEvent.change(photo.getByLabelText(en.account.photoAdd), {
      target: { files: [new File(['GIF89a'], 'photo.gif', { type: 'image/gif' })] },
    });
    expect(await photo.findByText(en.errors.photo_invalid)).toBeDefined();
    expect(calls.some((call) => call.route === 'PUT /api/auth/photo')).toBe(false);
  });

  it('is not shown to an account without a staff record', async () => {
    const { calls } = openAccount({
      'GET /api/auth/session': () => json(sessionOf({ name: null })),
    });
    await heading(en.account.title);
    await screen.findByRole('region', { name: en.account.languageTitle });
    expect(screen.queryByRole('region', { name: en.account.photoTitle })).toBeNull();
    expect(calls.some((call) => call.route === 'GET /api/auth/photo')).toBe(false);
  });
});
