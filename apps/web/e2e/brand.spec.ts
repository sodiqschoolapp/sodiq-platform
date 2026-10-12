import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LANGUAGE_NAMES } from '../src/i18n/languages';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { accountOf } from './accounts';
import {
  changeFirstPassword,
  chooseTheme,
  heading,
  languageChooser,
  openPersonMenu,
  signIn,
} from './steps';
import { codeNow } from './totp';

// docs/design-system.md (task 2.2d-2, pull request #61): the layout shell and
// the brand moments in a real browser. With SCREENSHOTS=1 the test also saves
// its screenshots for the report under docs/screens/2.2d-2/.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.2d-2');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  // A click into the opening person menu may have scrolled the page; colours
  // change in 120 ms and menus close in 160 ms (docs/design-system.md, Motion).
  await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

/**
 * docs/design-system.md, Type: "If Bitter lacks a letter of a language
 * (checked in the browser test with \"Oʻgʻil, Ўзбекистон, Қашқадарё, Ғулом,
 * Ҳамид\"), that language's slab titles use Golos Text bold."
 */
const CHECK = 'Oʻgʻil, Ўзбекистон, Қашқадарё, Ғулом, Ҳамид';

/**
 * Each letter of the check drawn in Bitter differs in width from the same
 * letter in two different fallback families: a letter Bitter lacks is drawn
 * by the fallback and has its width. `document.fonts.check` alone cannot
 * fail: it is true when no face covers the letters (plan review of #61, 3).
 */
async function lettersBitterLacks(page: Page): Promise<string[]> {
  // A string, as the other browser tests: the e2e files have no DOM types.
  return page.evaluate<string[]>(`(async () => {
    const text = ${JSON.stringify(CHECK)};
    await document.fonts.load('700 40px "Bitter Variable"', text);
    const context = document.createElement('canvas').getContext('2d');
    const width = (family, letter) => {
      context.font = '700 40px ' + family;
      return context.measureText(letter).width;
    };
    const letters = [...new Set([...text].filter((letter) => /\\p{L}|\\u02BB/u.test(letter)))];
    return letters.filter(
      (letter) =>
        width('"Bitter Variable", monospace', letter) === width('monospace', letter) ||
        width('"Bitter Variable", cursive', letter) === width('cursive', letter),
    );
  })()`);
}

test('the shell and the brand moments: sign-in, a list with its side panel and an empty page, in light and dark, in uz and ru', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fontHosts: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host.endsWith('googleapis.com') || host.endsWith('gstatic.com')) {
      fontHosts.push(host);
    }
  });
  const html = page.locator('html');
  const account = accountOf('brand');

  // The sign-in page, in Uzbek: the colour logo, the Bitter title, the slogan
  // on the navy panel.
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('uz');
  const title = heading(page, uz.signIn.title);
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS('font-family', /Bitter Variable/);
  // The colour logo on white, the on-dark one in the dark theme (Logo).
  const logo = page.getByRole('img', { name: uz.app.name });
  await expect(logo).toHaveAttribute('src', '/brand/sodiq-logo-horizontal.svg');
  const slogan = page.getByText(uz.brand.slogan, { exact: true });
  await expect(slogan).toBeVisible();
  await expect(slogan).toHaveCSS('text-transform', 'uppercase');
  await expect(page.getByLabel(uz.signIn.login, { exact: true })).toHaveCSS('height', '48px');
  await screenshot(page, 'sign-in-light');

  // The letter check, for the slab titles of every language.
  expect(await lettersBitterLacks(page)).toEqual([]);

  await page.getByRole('button', { name: uz.theme.toDark, exact: true }).click();
  await expect(html).toHaveClass(/dark/);
  await expect(logo).toHaveAttribute('src', '/brand/sodiq-logo-horizontal-on-dark.svg');
  await screenshot(page, 'sign-in-dark');
  await page.getByRole('button', { name: uz.theme.toLight, exact: true }).click();
  await expect(html).not.toHaveClass(/dark/);

  // At phone width the navy panel is hidden.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(slogan).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });

  // The steps of sign-in in the same frame.
  await signIn(page, uz, account.login, account.password);
  await changeFirstPassword(page, uz, account);
  await expect(heading(page, uz.setUp.title)).toHaveCSS('font-family', /Bitter Variable/);
  await page.getByRole('button', { name: uz.setUp.start, exact: true }).click();
  const key = await page.locator('dd').innerText();
  await page.getByLabel(uz.setUp.code, { exact: true }).fill(codeNow(key));
  await page.getByRole('button', { name: uz.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: uz.setUp.saved }).check();
  await page.getByRole('button', { name: uz.setUp.continue, exact: true }).click();
  await expect(heading(page, uz.home.title)).toBeVisible();

  // The navy menu with the current page in orange; page titles stay Golos Text.
  const menu = page.getByRole('navigation', { name: uz.layout.menu });
  await expect(menu.getByRole('link', { name: uz.menu.home })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(heading(page, uz.home.title)).toHaveCSS('font-family', /Golos Text Variable/);

  // A list with its side panel, in light and dark.
  await page.goto('/people/staff');
  await expect(heading(page, uz.people.staff.title)).toBeVisible();
  // The item of the section is the current one on its inner pages.
  await expect(menu.getByRole('link', { name: uz.menu.people })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const row = page.getByRole('row').filter({ hasText: 'Oʻrinboyev' });
  await row.getByRole('button', { name: 'Gʻayrat Oʻrinboyev' }).click();
  await expect(page.getByRole('complementary', { name: 'Gʻayrat Oʻrinboyev' })).toBeVisible();
  await screenshot(page, 'staff-list-light');
  await chooseTheme(page, uz, 'dark');
  await expect(html).toHaveClass(/dark/);
  await expect(page.getByRole('complementary', { name: 'Gʻayrat Oʻrinboyev' })).toBeVisible();
  await screenshot(page, 'staff-list-dark');

  // An empty page as a brand moment: the vacancies of a branch that has none.
  await page.goto('/people/vacancies');
  const empty = heading(page, uz.people.vacancies.emptyTitle);
  await expect(empty).toBeVisible();
  await expect(empty).toHaveCSS('font-family', /Bitter Variable/);
  await screenshot(page, 'empty-page-uz-dark');
  await chooseTheme(page, uz, 'light');
  await expect(html).not.toHaveClass(/dark/);
  await screenshot(page, 'empty-page-uz-light');

  // The same in Russian, chosen in the person menu.
  await openPersonMenu(page, uz);
  await page.getByRole('menuitemradio', { name: LANGUAGE_NAMES.ru, exact: true }).click();
  const emptyRu = heading(page, ru.people.vacancies.emptyTitle);
  await expect(emptyRu).toBeVisible();
  await expect(emptyRu).toHaveCSS('font-family', /Bitter Variable/);
  await screenshot(page, 'empty-page-ru-light');

  // The menu collapses to the rail and stays so after a reload.
  await page.getByRole('button', { name: ru.menu.collapse, exact: true }).click();
  await page.reload();
  await expect(emptyRu).toBeVisible();
  await expect(page.getByRole('button', { name: ru.menu.expand, exact: true })).toBeVisible();
  await screenshot(page, 'rail-ru');
  await page.getByRole('button', { name: ru.menu.expand, exact: true }).click();

  // At phone width the menu is the tab bar with "More".
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByRole('navigation', { name: ru.menu.tabs });
  await expect(tabs).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(tabs.getByRole('button', { name: ru.menu.more, exact: true })).toBeVisible();
  await screenshot(page, 'phone-ru');

  expect(fontHosts).toEqual([]);
});
