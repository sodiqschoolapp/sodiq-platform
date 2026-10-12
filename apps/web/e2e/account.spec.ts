import { expect, test, type Browser, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { accountOf, NEW_PASSWORD, type Credentials } from './accounts';
import { LANGUAGE_NAMES } from '../src/i18n/languages';
import {
  changeFirstPassword,
  heading,
  languageChooser,
  openPersonMenu,
  signIn,
  signOutFromMenu,
  type PageTexts,
} from './steps';
import { codeNow } from './totp';

async function signOut(page: Page, t: PageTexts): Promise<void> {
  // The sign-out button at the foot of the menu (docs/design-system.md, Layout shell).
  await signOutFromMenu(page, t);
}

/** The account page from the person menu, in the language the page is in. */
async function openAccount(page: Page, t: PageTexts): Promise<void> {
  await openPersonMenu(page, t);
  await page.getByRole('menuitem', { name: t.account.title, exact: true }).click();
  await expect(heading(page, t.account.title)).toBeVisible();
}

/** A browser of its own: another device of the same person. */
async function newBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** The first sign-in of a seeded account: the forced change, then a sign-in with the chosen password. */
async function firstSignIn(page: Page, account: Credentials): Promise<void> {
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();
}

// docs/build-plan.md, task 0.8d, done when: Playwright removes a trusted
// device, signs out everywhere, and a language chosen in one browser is in
// use after sign-in in another. Edge cases, "Accounts and sign-in": the
// profile lists the sessions with "sign out everywhere" and the trusted
// devices, each removable; removing one ends its session at once. Decided by
// the owner: "sign out everywhere" keeps the session that asks.
test('removes a trusted device, signs out everywhere, and the language follows the account', async ({
  page: laptop,
  browser,
}) => {
  // Three browsers and five sign-ins: more than the usual half minute.
  test.setTimeout(120_000);
  const account = accountOf('account');

  // The laptop: the first sign-in, then a sign-in with "Trust this device".
  await firstSignIn(laptop, account);
  await signOut(laptop, en);
  await laptop.getByRole('checkbox', { name: en.signIn.trust }).check();
  await signIn(laptop, en, account.login, NEW_PASSWORD);
  await expect(heading(laptop, en.home.title)).toBeVisible();

  // The phone: signs in and chooses Russian in the person menu, which the account keeps.
  const phone = await newBrowser(browser);
  await phone.goto('/sign-in');
  await languageChooser(phone).selectOption('en');
  await signIn(phone, en, account.login, NEW_PASSWORD);
  await expect(heading(phone, en.home.title)).toBeVisible();
  const saved = phone.waitForResponse(
    (response) => response.url().endsWith('/api/auth/language') && response.status() === 204,
  );
  await openPersonMenu(phone, en);
  await phone.getByRole('menuitemradio', { name: LANGUAGE_NAMES.ru, exact: true }).click();
  await expect(heading(phone, ru.home.title)).toBeVisible();
  await saved;

  // A classroom computer: nothing chosen there, so the account's language applies at sign-in.
  const classroom = await newBrowser(browser);
  await classroom.goto('/sign-in');
  await expect(heading(classroom, en.signIn.title)).toBeVisible();
  await signIn(classroom, en, account.login, NEW_PASSWORD);
  await expect(heading(classroom, ru.home.title)).toBeVisible();
  await expect(classroom.locator('html')).toHaveAttribute('lang', 'ru');

  // The account page on the phone: three sessions, one trusted device (the laptop).
  await openAccount(phone, ru);
  const sessions = phone.getByRole('region', { name: ru.account.sessionsTitle });
  await expect(sessions.getByRole('row')).toHaveCount(4);
  await expect(sessions.getByText(ru.account.thisDevice)).toHaveCount(1);
  await expect(sessions.getByText(ru.account.trusted, { exact: true })).toHaveCount(1);
  const devices = phone.getByRole('region', { name: ru.account.devicesTitle });
  await expect(devices.getByRole('row')).toHaveCount(2);

  // Removing the laptop's device signs the laptop out at once.
  // The button names the device for a screen reader: "Remove <device>".
  await devices.getByRole('button', { name: new RegExp(`^${ru.account.remove} `) }).click();
  const removal = phone.getByRole('alertdialog');
  await expect(removal).toContainText(ru.account.removeText);
  await removal.getByRole('button', { name: ru.account.remove, exact: true }).click();
  await expect(devices.getByText(ru.account.devicesEmpty)).toBeVisible();
  await expect(sessions.getByRole('row')).toHaveCount(3);
  await laptop.goto('/');
  await expect(laptop).toHaveURL(/\/sign-in/);
  await expect(heading(laptop, en.signIn.title)).toBeVisible();

  // "Sign out everywhere" from the phone: the classroom is signed out, the phone stays.
  await sessions.getByRole('button', { name: ru.account.signOutEverywhere, exact: true }).click();
  const question = phone.getByRole('alertdialog');
  await expect(question).toContainText(ru.account.signOutEverywhereTitle);
  await question.getByRole('button', { name: ru.account.signOutEverywhere, exact: true }).click();
  await expect(sessions.getByRole('status')).toHaveText(
    ru.account.signedOutEverywhere_one.replace('{{count}}', '1'),
  );
  await expect(sessions.getByRole('row')).toHaveCount(2);
  await classroom.goto('/');
  await expect(classroom).toHaveURL(/\/sign-in/);
  await phone.goto('/');
  await expect(heading(phone, ru.home.title)).toBeVisible();

  await signOut(phone, ru);
});

// docs/spec/02-roles-and-access.md, Rules: two-step verification is optional
// for most roles. Decided by the owner (task 0.8d): on and off from the
// account page, off with the code of the app and nothing more.
test('turns the optional second step on and off from the account page', async ({ page }) => {
  const account = accountOf('accountSecondStep');
  await firstSignIn(page, account);
  await openAccount(page, en);

  const step = page.getByRole('region', { name: en.account.secondStepTitle });
  await expect(step.getByText(en.account.secondStepOff)).toBeVisible();
  await step.getByRole('button', { name: en.account.turnOn, exact: true }).click();
  await step.getByRole('button', { name: en.setUp.start, exact: true }).click();
  await expect(step.getByRole('img', { name: en.setUp.qr })).toBeVisible();
  const key = await step.locator('dd').innerText();
  await step.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
  await step.getByRole('button', { name: en.setUp.confirm, exact: true }).click();

  await expect(step.getByRole('heading', { name: en.setUp.codesTitle })).toBeVisible();
  const recoveryCodes = await step.getByRole('listitem').allInnerTexts();
  expect(recoveryCodes).toHaveLength(10);
  await step.getByRole('checkbox', { name: en.setUp.saved }).check();
  await step.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(step.getByRole('status')).toHaveText(en.account.turnedOn);
  await expect(step.getByText(en.account.secondStepOn)).toBeVisible();

  // The next sign-in asks for the code. The code of this half minute was just
  // used to confirm the set-up and counts once: a recovery code goes into the same field.
  await signOut(page, en);
  await signIn(page, en, account.login, NEW_PASSWORD);
  await expect(heading(page, en.code.title)).toBeVisible();
  await page.getByLabel(en.code.label, { exact: true }).fill(recoveryCodes[0] ?? '');
  await page.getByRole('button', { name: en.code.submit, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  // Off again, with another recovery code.
  await openAccount(page, en);
  await step.getByRole('button', { name: en.account.turnOff, exact: true }).click();
  await step.getByLabel(en.setUp.code, { exact: true }).fill(recoveryCodes[1] ?? '');
  await step.getByRole('button', { name: en.account.turnOff, exact: true }).click();
  await expect(step.getByRole('status')).toHaveText(en.account.turnedOff);
  await expect(step.getByText(en.account.secondStepOff)).toBeVisible();

  // Sign-in needs the password alone.
  await signOut(page, en);
  await signIn(page, en, account.login, NEW_PASSWORD);
  await expect(heading(page, en.home.title)).toBeVisible();
  await signOut(page, en);
});
