import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/design-system.md (task 2.2d-1, pull request #60): the tokens, the font
// and the parts in a real browser, in both themes. With SCREENSHOTS=1 the
// test also saves its screenshots for the report under docs/screens/2.2d-1/.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.2d-1');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

/** The letters the design system names: Uzbek Latin with U+02BB, and Cyrillic. */
const LETTERS = ['oʻ', 'gʻ', 'Ў', 'Қ', 'Ғ', 'Ҳ'];

test('the staff list and its side panel are drawn with the design system in light and dark', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fontHosts: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host.endsWith('googleapis.com') || host.endsWith('gstatic.com')) {
      fontHosts.push(host);
    }
  });

  const account = accountOf('design');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.setUp.title)).toBeVisible();
  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  const key = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  // Golos Text from our own files, with every letter of the three languages.
  // A string, as the other browser tests: the e2e files have no DOM types.
  const covered = await page.evaluate<Record<string, boolean>>(`(async () => {
    await document.fonts.ready;
    const found = {};
    for (const letter of ${JSON.stringify(LETTERS)}) {
      const faces = await document.fonts.load('16px "Golos Text Variable"', letter);
      found[letter] = faces.some((face) => face.status === 'loaded');
    }
    return found;
  })()`);
  expect(covered).toEqual(Object.fromEntries(LETTERS.map((letter) => [letter, true])));
  await expect(page.locator('body')).toHaveCSS('font-family', /Golos Text Variable/);

  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.people) })
    .click();
  await page.getByRole('link', { name: en.people.staffLink, exact: true }).click();
  await expect(heading(page, en.people.staff.title)).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: 'Qoʻchqorov' });
  await row.getByRole('button', { name: 'Oybek Qoʻchqorov' }).click();
  await expect(page.getByRole('complementary', { name: 'Oybek Qoʻchqorov' })).toBeVisible();

  const theme = page.getByRole('radiogroup', { name: en.theme.label, exact: true });
  const body = page.locator('body');

  await theme.getByText(en.theme.light, { exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  // The brand grey #ECECEC.
  await expect(body).toHaveCSS('background-color', /0\.9431/);
  await screenshot(page, 'staff-list-light');

  await theme.getByText(en.theme.dark, { exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  // The dark navy #040920.
  await expect(body).toHaveCSS('background-color', /0\.1509/);
  await screenshot(page, 'staff-list-dark');

  // A list with checkboxes, one row ticked and the others not, so the dark
  // screenshot shows both (review of pull request #60, correction 6): the
  // sample list of the patterns, in development only.
  await page.goto('/dev/patterns');
  await expect(heading(page, en.sample.title)).toBeVisible();
  const ticked = page.locator('tbody tr').nth(1).getByRole('checkbox');
  await ticked.check();
  await expect(ticked).toBeChecked();
  await expect(page.locator('tbody tr').nth(2).getByRole('checkbox')).not.toBeChecked();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await screenshot(page, 'sample-list-dark');
  await theme.getByText(en.theme.light, { exact: true }).click();
  await screenshot(page, 'sample-list-light');

  expect(fontHosts).toEqual([]);
});
