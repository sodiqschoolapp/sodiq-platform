import { mkdirSync } from 'node:fs';
import path from 'node:path';
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

/** The three views of a page in the check of task 2.7c-1. */
const VIEWS = [
  { name: 'light', width: 1440, height: 900, colorScheme: 'light' },
  { name: 'dark', width: 1440, height: 900, colorScheme: 'dark' },
  { name: 'phone', width: 390, height: 844, colorScheme: 'light' },
] as const;

/** Where `checkPage` saves its screenshots with SCREENSHOTS=1, for the report. */
const PAGE_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.7c-1');

interface Measured {
  h1: number;
  scrollWidth: number;
  innerWidth: number;
  /** The innermost elements that reach past the right edge, for a readable failure. */
  outside: string[];
  /** Each visible button of the Button part: its height and its words. */
  buttons: { height: number; text: string }[];
}

/**
 * Task 2.7c-1 (pull request #80): a page against docs/design-system.md, in
 * light and dark at 1440 x 900 and in light at 390 x 844. One page title; the
 * page never scrolls sideways (Layout shell, phone width); every visible
 * button is one of the sizes of Buttons: 32 or 40 high on a desktop, 44 at
 * phone width, and 48 only on the sign-in frame. The theme follows the
 * device (the account never chose one), so the dark view is the device's.
 * With SCREENSHOTS=1 it saves docs/screens/2.7c-1/<name>-<view>.png. The page
 * is left in light at 1440 x 900.
 */
export async function checkPage(
  page: Page,
  name: string,
  { signInFrame = false }: { signInFrame?: boolean } = {},
): Promise<void> {
  for (const view of VIEWS) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.emulateMedia({ colorScheme: view.colorScheme });
    await expect(page.locator('html')).toHaveClass(
      view.colorScheme === 'dark' ? /dark/ : /^(?!.*dark)/,
    );
    // A string, as the other browser tests: the e2e files have no DOM types.
    const measured = await page.evaluate<Measured>(`(() => {
      const visible = (element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
      };
      return {
        h1: [...document.querySelectorAll('h1')].filter(visible).length,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: document.documentElement.clientWidth,
        outside: [...document.querySelectorAll('body *')]
          .filter((element) => visible(element) && element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
          .filter((element) => ![...element.children].some((child) => child.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5))
          .slice(0, 5)
          .map((element) => element.tagName.toLowerCase() + ' "' + (element.textContent ?? '').trim().slice(0, 40) + '" ' + String(element.className).slice(0, 80)),
        buttons: [...document.querySelectorAll('[data-slot="button"]')].filter(visible).map((button) => ({
          height: Math.round(button.getBoundingClientRect().height),
          text: (button.getAttribute('aria-label') ?? button.textContent ?? '').trim(),
        })),
      };
    })()`);
    const where = `${name}, ${view.name}`;
    expect(measured.h1, `${where}: one page title`).toBe(1);
    expect(
      measured.scrollWidth,
      `${where}: no sideways scroll (${measured.outside.join('; ')})`,
    ).toBeLessThanOrEqual(measured.innerWidth);
    // Below 640 px every size is 44 (button.tsx); 32 and 40 on a desktop.
    const allowed = view.name === 'phone' ? [44] : [32, 40];
    if (signInFrame) {
      allowed.push(48);
    }
    const wrong = measured.buttons.filter((button) => !allowed.includes(button.height));
    expect(wrong, `${where}: buttons of the sizes of the design system`).toEqual([]);
    if (process.env.SCREENSHOTS === '1') {
      mkdirSync(PAGE_SCREENS, { recursive: true });
      await page.screenshot({ path: path.join(PAGE_SCREENS, `${name}-${view.name}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}
