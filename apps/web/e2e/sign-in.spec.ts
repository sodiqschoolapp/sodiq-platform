import { expect, test, type Page } from '@playwright/test';
import { LANGUAGES } from '../src/i18n/languages';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { accountOf, NEW_PASSWORD } from './accounts';
import {
  changeFirstPassword,
  heading,
  languageChooser,
  signIn,
  signOutFromMenu,
  type PageTexts,
} from './steps';
import { codeNow } from './totp';

const TEXTS = { uz, ru, en };

async function signOut(page: Page, t: PageTexts): Promise<void> {
  // The sign-out button at the foot of the menu (docs/design-system.md, Layout shell).
  await signOutFromMenu(page, t);
}

// docs/build-plan.md, task 0.8a: Playwright signs in and out in each language.
// docs/spec/12-ux-standards.md, Language: each person chooses a language; the
// choice is remembered. docs/spec/02-roles-and-access.md, Rules: staff sign in
// with login and password and must change the password at first sign-in.
for (const language of LANGUAGES) {
  test(`signs in and out in ${language}`, async ({ page }) => {
    const t = TEXTS[language];
    const account = accountOf(language);

    // Every address leads a visitor who is not signed in to the sign-in page.
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);

    await languageChooser(page).selectOption(language);
    await expect(heading(page, t.signIn.title)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', language);

    await signIn(page, t, account.login, account.password);
    await changeFirstPassword(page, t, account);

    await expect(heading(page, t.home.title)).toBeVisible();
    await expect(page.getByRole('button', { name: t.layout.account })).toContainText(account.login);

    // The session and the language survive a reload.
    await page.reload();
    await expect(heading(page, t.home.title)).toBeVisible();
    await expect(page.getByRole('navigation', { name: t.layout.menu })).toBeAttached();

    await signOut(page, t);
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(heading(page, t.signIn.title)).toBeVisible();

    // The new password works, and no step is owed any more.
    await signIn(page, t, account.login, NEW_PASSWORD);
    await expect(heading(page, t.home.title)).toBeVisible();
    await signOut(page, t);
  });
}

// Edge cases, "Accounts and sign-in": an unknown login and a wrong password
// get the same answer.
test('refuses an unknown login and a wrong password with the same text', async ({ page }) => {
  const account = accountOf('wrongPassword');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');

  await signIn(page, en, 'n.nobody', 'a-wrong-password');
  await expect(page.getByRole('alert')).toHaveText(en.errors.sign_in_failed);

  await signIn(page, en, account.login, 'a-wrong-password');
  await expect(page.getByRole('alert')).toHaveText(en.errors.sign_in_failed);
  await expect(page).toHaveURL(/\/sign-in$/);
});

// docs/spec/02-roles-and-access.md, Rules: two-step verification is required
// for the Academic Vice Principal. Edge cases: a code from an authenticator
// app, with ten single-use recovery codes shown at set-up.
test('sets up the required second step, and signs in again with a recovery code', async ({
  page,
}) => {
  const account = accountOf('vicePrincipal');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);

  await expect(heading(page, en.setUp.title)).toBeVisible();
  // Nothing else opens before the set-up.
  await page.goto('/');
  await expect(page).toHaveURL(/\/second-step\/set-up$/);

  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  await expect(page.getByRole('img', { name: en.setUp.qr })).toBeVisible();
  const key = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();

  await expect(heading(page, en.setUp.codesTitle)).toBeVisible();
  const recoveryCodes = await page.getByRole('listitem').allInnerTexts();
  expect(recoveryCodes).toHaveLength(10);
  const recoveryCode = recoveryCodes[0] ?? '';
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  await signOut(page, en);

  // The next sign-in asks for the second step; a recovery code goes into the same field.
  await signIn(page, en, account.login, NEW_PASSWORD);
  await expect(heading(page, en.code.title)).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in\/code$/);

  await page.getByLabel(en.code.label, { exact: true }).fill('000000');
  await page.getByRole('button', { name: en.code.submit, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(en.errors.second_step_code_wrong);

  await page.getByLabel(en.code.label, { exact: true }).fill(recoveryCode);
  await page.getByRole('button', { name: en.code.submit, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();
  await signOut(page, en);
});

// Edge cases, "Trust this device": the switch is off by default; trust never
// begins with a first password. docs/decisions.md (0.6a): the session cookie
// is `__Host-`, `Secure`, `HttpOnly` and `SameSite=Strict`, also on localhost.
test('keeps the session in a cookie scripts cannot read, and says when a device was not trusted', async ({
  page,
  context,
}) => {
  const account = accountOf('trust');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  const trust = page.getByRole('checkbox', { name: en.signIn.trust });
  await expect(trust).not.toBeChecked();
  await trust.check();

  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await expect(page.getByText(en.layout.notTrusted)).toBeVisible();
  await page.getByRole('button', { name: en.layout.dismiss }).click();
  await expect(page.getByText(en.layout.notTrusted)).toBeHidden();

  const cookie = (await context.cookies()).find((one) => one.name === '__Host-sodiq_session');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
  // Not trusted: the cookie ends with the browser.
  expect(cookie?.expires).toBe(-1);
  // What a script of the page can read of the cookies.
  expect(await page.evaluate<string>('document.cookie')).not.toContain('sodiq_session');

  // The password change by choice, from the person menu at the foot of the menu.
  await page.getByRole('button', { name: en.layout.account, exact: true }).click();
  await page.getByRole('menuitem', { name: en.layout.changePassword, exact: true }).click();
  await expect(heading(page, en.password.titleOwn)).toBeVisible();
  await page.getByLabel(en.password.current, { exact: true }).fill('not-the-password');
  await page.getByLabel(en.password.new, { exact: true }).fill('another-password-74');
  await page.getByLabel(en.password.repeat, { exact: true }).fill('another-password-74');
  await page.getByRole('button', { name: en.password.submit, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(en.errors.current_password_wrong);

  await page.getByLabel(en.password.current, { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: en.password.submit, exact: true }).click();
  await expect(page.getByText(en.password.changed)).toBeVisible();

  await page.getByRole('link', { name: en.password.back }).click();
  await signOut(page, en);

  // With a password of the person's own the switch works: the cookie is kept
  // for 7 days, and nothing is said about trust.
  await page.getByRole('checkbox', { name: en.signIn.trust }).check();
  await signIn(page, en, account.login, 'another-password-74');
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(page.getByText(en.layout.notTrusted)).toBeHidden();
  const trusted = (await context.cookies()).find((one) => one.name === '__Host-sodiq_session');
  const days = ((trusted?.expires ?? 0) - Date.now() / 1000) / (24 * 60 * 60);
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThanOrEqual(7);
  await signOut(page, en);
});
