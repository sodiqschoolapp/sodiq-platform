import type { DemoClockState, Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import { quickMoves } from './demo-clock-page';

// Task 10.5 (pull request #280): School setup → Demo time, on the test environment, for the
// Super Admin alone. All names are invented.

const sessionAs = (role: Role) =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  });

const ON: DemoClockState = {
  enabled: true,
  realNow: '2026-11-04T05:00:00.000Z',
  demoNow: '2026-11-04T05:00:00.000Z',
  offsetMs: 0,
  effectiveAt: null,
  changedAt: null,
};

const refusal = (code: string) =>
  json({ error: { code, message: code, requestId: '0199b000-0000-7000-8000-0000000000aa' } }, 409);

describe('the quick moves of the demo time', () => {
  it('are an hour on, tomorrow at 07:05 and next Monday at 09:05 in branch time', () => {
    // Wednesday 4 November 2026, 10:00:05 in Tashkent.
    const moves = quickMoves(Date.parse('2026-11-04T05:00:05Z'), 'Asia/Tashkent');

    expect(moves).toEqual([
      { key: 'hour', to: '2026-11-04T06:00:05.000Z' },
      { key: 'tomorrow', to: '2026-11-05T02:05:00.000Z' },
      { key: 'monday', to: '2026-11-09T04:05:00.000Z' },
    ]);
  });

  it('take a Monday to the Monday after', () => {
    const moves = quickMoves(Date.parse('2026-11-09T05:00:00Z'), 'Asia/Tashkent');

    expect(moves.find((move) => move.key === 'monday')?.to).toBe('2026-11-16T04:05:00.000Z');
  });
});

describe('the Demo time page', () => {
  it('moves demo time forward after asking, with the time it moves to', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('super_admin')),
      'GET /api/setup/demo-clock': () => json(ON),
      'POST /api/setup/demo-clock/jumps': (body) =>
        json({ ...ON, demoNow: (body as { to: string }).to, offsetMs: 1 }),
    });
    renderApp('/setup/demo-clock');

    fireEvent.click(await screen.findByRole('button', { name: en.setup.demoClock.quick.tomorrow }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(en.setup.demoClock.confirmText);
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.demoClock.confirmAction }));

    await waitFor(() => {
      expect(
        calls.filter((call) => call.route === 'POST /api/setup/demo-clock/jumps'),
      ).toHaveLength(1);
    });
    const jump = calls.find((call) => call.route === 'POST /api/setup/demo-clock/jumps');
    expect(jump?.body).toEqual({ to: expect.stringMatching(/T02:05:00\.000Z$/) as unknown });
  });

  it('moves nothing when the question is answered no', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('super_admin')),
      'GET /api/setup/demo-clock': () => json(ON),
    });
    renderApp('/setup/demo-clock');

    fireEvent.click(await screen.findByRole('button', { name: en.setup.demoClock.quick.hour }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(calls.some((call) => call.route === 'POST /api/setup/demo-clock/jumps')).toBe(false);
  });

  it.each([
    ['demo_clock_backwards', en.errors.demo_clock_backwards],
    ['demo_clock_too_far', en.errors.demo_clock_too_far],
  ])('says why a move is refused (%s)', async (code, text) => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('super_admin')),
      'GET /api/setup/demo-clock': () => json(ON),
      'POST /api/setup/demo-clock/jumps': () => refusal(code),
    });
    renderApp('/setup/demo-clock');

    fireEvent.click(await screen.findByRole('button', { name: en.setup.demoClock.quick.monday }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.setup.demoClock.confirmAction }));

    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('says it is off where the demo clock does not run', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('super_admin')),
      'GET /api/setup/demo-clock': () => json({ ...ON, enabled: false }),
    });
    renderApp('/setup/demo-clock');

    expect(await screen.findByText(en.setup.demoClock.offTitle)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.setup.demoClock.quick.hour })).toBeNull();
  });
});
