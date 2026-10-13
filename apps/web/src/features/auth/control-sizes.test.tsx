import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, renderApp, sessionOf } from '@/testing/render-app';

const heading = (name: string) => screen.findByRole('heading', { name });
const button = (name: string, scope: HTMLElement = document.body) =>
  within(scope).getByRole('button', { name });

/** Large: 48 high (h-12); the default: 40, 44 at phone width (h-10). */
const isLarge = (element: HTMLElement) => /(^|\s)h-12(\s|$)/.test(element.className);
const isDefault = (element: HTMLElement) => /(^|\s)h-10(\s|$)/.test(element.className);

const setUp = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  address: 'otpauth://totp/Sodiq%20School:a.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
};

// docs/design-system.md, Buttons: "Large 48: sign-in"; Medium "everywhere
// else". The password page and the set-up of the second step are drawn on the
// sign-in frame and inside the layout, and take the size from where they are
// drawn (pull request #80, decision 13). On the frame the fields are 48 high
// as on sign-in, and a quiet button under the large one has its size.
describe('the size of the controls of a page drawn on the sign-in frame and in the layout', () => {
  it('is large on the forced password change', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ mustChangePassword: true })) });
    renderApp('/password');
    await heading(en.password.titleForced);
    expect(isLarge(button(en.password.submit))).toBe(true);
    expect(isLarge(button(en.layout.signOut))).toBe(true);
    expect(isLarge(screen.getByLabelText(en.password.currentOneTime))).toBe(true);
    expect(isLarge(screen.getByLabelText(en.password.new))).toBe(true);
  });

  it('is the default on the change by choice inside the layout', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/account/password');
    await heading(en.password.titleOwn);
    expect(isDefault(button(en.password.submit))).toBe(true);
    expect(isLarge(screen.getByLabelText(en.password.current))).toBe(false);
  });

  it('is large on the set-up step of sign-in, at every stage', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ secondStep: 'set_up_required' })),
      'POST /api/auth/second-step/set-up': () => json(setUp),
    });
    renderApp('/second-step/set-up');
    await heading(en.setUp.title);
    expect(isLarge(button(en.setUp.start))).toBe(true);
    expect(isLarge(button(en.layout.signOut))).toBe(true);
    fireEvent.click(button(en.setUp.start));
    expect(isLarge(await screen.findByLabelText(en.setUp.code))).toBe(true);
    expect(isLarge(button(en.setUp.confirm))).toBe(true);
  });

  it('is the default when the second step is turned on from the account page', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'GET /api/auth/sessions': () => json({ sessions: [] }),
      'GET /api/auth/trusted-devices': () => json({ devices: [] }),
      'GET /api/auth/second-step': () => json({ on: false, required: false, recoveryCodesLeft: 0 }),
      'GET /api/auth/sign-in-history': () => json({ events: [], next: null }),
      'POST /api/auth/second-step/set-up': () => json(setUp),
    });
    renderApp('/account');
    await heading(en.account.title);
    const step = screen.getByRole('region', { name: en.account.secondStepTitle });
    fireEvent.click(await within(step).findByRole('button', { name: en.account.turnOn }));
    expect(isDefault(button(en.setUp.start, step))).toBe(true);
    fireEvent.click(button(en.setUp.start, step));
    expect(isLarge(await within(step).findByLabelText(en.setUp.code))).toBe(false);
    expect(isDefault(button(en.setUp.confirm, step))).toBe(true);
  });

  it('is large on the code step of sign-in, the sign-out under it too', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ secondStep: 'pending' })) });
    renderApp('/sign-in/code');
    await heading(en.code.title);
    expect(isLarge(button(en.code.submit))).toBe(true);
    expect(isLarge(button(en.layout.signOut))).toBe(true);
    expect(isLarge(screen.getByLabelText(en.code.label))).toBe(true);
  });
});
