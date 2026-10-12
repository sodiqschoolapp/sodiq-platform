import { expect, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import type { ru } from '../src/i18n/locales/ru';
import type { uz } from '../src/i18n/locales/uz';
import { NEW_PASSWORD, type Credentials } from './accounts';

/** The texts every language has; the page is checked against the chosen one. */
export type PageTexts = typeof uz | typeof ru | typeof en;

export const heading = (page: Page, name: string) =>
  page.getByRole('heading', { name, exact: true });

/** The language chooser of the page, named in the language the page is in now. */
export const languageChooser = (page: Page, t: PageTexts = en) =>
  page.getByRole('combobox', { name: t.language.label, exact: true });

export async function signIn(
  page: Page,
  t: PageTexts,
  login: string,
  password: string,
): Promise<void> {
  await page.getByLabel(t.signIn.login, { exact: true }).fill(login);
  await page.getByLabel(t.signIn.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: t.signIn.submit, exact: true }).click();
}

/** The forced change of a first password. */
export async function changeFirstPassword(
  page: Page,
  t: PageTexts,
  account: Credentials,
): Promise<void> {
  await expect(heading(page, t.password.titleForced)).toBeVisible();
  await page.getByLabel(t.password.currentOneTime, { exact: true }).fill(account.password);
  await page.getByLabel(t.password.new, { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel(t.password.repeat, { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: t.password.submit, exact: true }).click();
}

/**
 * The person at the foot of the navy menu (docs/design-system.md, Layout
 * shell; pull request #61, decision 3): the own account, the password, the
 * theme and the language. From 640 px up.
 */
export async function openPersonMenu(page: Page, t: PageTexts = en): Promise<void> {
  await page.getByRole('button', { name: t.layout.account, exact: true }).click();
}

/** Sign-out from the foot of the menu, back to the sign-in page. */
export async function signOutFromMenu(page: Page, t: PageTexts = en): Promise<void> {
  await page.getByRole('button', { name: t.layout.signOut, exact: true }).click();
  await expect(heading(page, t.signIn.title)).toBeVisible();
}

/** A theme chosen in the person menu. */
export async function chooseTheme(
  page: Page,
  t: PageTexts,
  theme: 'device' | 'light' | 'dark',
): Promise<void> {
  await openPersonMenu(page, t);
  await page.getByRole('menuitemradio', { name: t.theme[theme], exact: true }).click();
}
