import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, chooseTheme, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/design-system.md (task 2.2d-1, pull request #60): the tokens, the font
// and the parts in a real browser, in both themes. With SCREENSHOTS=1 the
// test also saves its screenshots for the report under docs/screens/2.2d-1/.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.2d-1');

async function screenshot(page: Page, name: string, folder = SCREENS): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, `${name}.png`) });
}

/** The screenshots of task 2.7b-2, for its report. */
const SCREENS_27B2 = path.join(import.meta.dirname, '../../../docs/screens/2.7b-2');

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
  await row.getByRole('button', { name: 'Qoʻchqorov Oybek' }).click();
  await expect(page.getByRole('complementary', { name: 'Oybek Qoʻchqorov' })).toBeVisible();

  const body = page.locator('body');

  // The theme is chosen in the person menu since task 2.2d-2 (pull request #61, decision 3).
  await chooseTheme(page, en, 'light');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  // The brand grey #ECECEC.
  await expect(body).toHaveCSS('background-color', /0\.9431/);
  await screenshot(page, 'staff-list-light');

  // The segmented control is a radio group: the arrows move the choice. Since
  // task 2.2d-2 it is the theme choice of "More" at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('navigation', { name: en.menu.tabs })
    .getByRole('button', { name: en.menu.more, exact: true })
    .click();
  const more = page.getByRole('dialog', { name: en.menu.more });
  const theme = more.getByRole('radiogroup', { name: en.theme.label, exact: true });
  await theme.getByRole('radio', { name: en.theme.light }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(theme.getByRole('radio', { name: en.theme.dark })).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
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
  await chooseTheme(page, en, 'light');
  await screenshot(page, 'sample-list-light');

  expect(fontHosts).toEqual([]);
});

/** The top bar and the page: their height and whether either scrolls sideways. */
const widths = (page: Page) =>
  page.evaluate<{ bar: number; barFits: boolean; pageFits: boolean }>(`(() => {
    const bar = document.querySelector('header');
    const root = document.documentElement;
    return {
      bar: Math.round(bar.getBoundingClientRect().height),
      barFits: bar.scrollWidth <= bar.clientWidth,
      pageFits: root.scrollWidth <= root.clientWidth,
    };
  })()`);

// Issue #39, hand test of 13 October 2026, findings 14 and 31 (task 2.7b-2):
// the top bar is one row from 1024 px with both switchers, the Rooms list fits
// a 1047 px window, and on a phone "Send feedback" shows its word in "More".
// The alerts line of finding 30 needs a Super Admin with an alert; the seed
// has its three Super Admins for other tests, so the unit tests prove it.
test('the top bar is one row at laptop width, Rooms fits, and More shows Send feedback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1047, height: 800 });
  const account = accountOf('topBar');
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

  // The Teacher's two branches: the role and the branch are both selects.
  const bar = page.getByRole('banner', { name: en.layout.topBar });
  const role = bar.getByLabel(en.switcher.role);
  await role.selectOption({ label: en.roles.teacher });
  const branch = bar.getByLabel(en.switcher.branch);
  await expect(branch).toBeVisible();
  await branch.selectOption({ label: 'Top bar browser test branch' });
  // Below 1280 px the search and feedback are icon buttons named by their words.
  await expect(bar.getByRole('button', { name: en.search.label })).toBeVisible();
  await expect(bar.getByRole('button', { name: en.feedback.button })).toBeVisible();

  for (const [width, height] of [
    [1047, 800],
    [1024, 768],
  ] as const) {
    await page.setViewportSize({ width, height });
    const measured = await widths(page);
    // One row: no taller than a row of 44 px controls and its padding.
    expect(measured.bar, `top bar at ${String(width)} px`).toBeLessThanOrEqual(69);
    expect(measured.barFits).toBe(true);
    expect(measured.pageFits).toBe(true);
    await screenshot(page, `top-bar-${String(width)}`, SCREENS_27B2);
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  expect((await widths(page)).pageFits).toBe(true);
  expect((await widths(page)).barFits).toBe(true);

  await page.setViewportSize({ width: 1047, height: 800 });
  await role.selectOption({ label: en.roles.academic_vice_principal });
  await page.goto('/setup/rooms');
  await expect(heading(page, en.setup.rooms.title)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.getByRole('columnheader', { name: en.setup.rooms.building })).toHaveCount(0);
  const rooms = await widths(page);
  expect(rooms.pageFits).toBe(true);
  // Nothing in the list scrolls sideways either.
  const tableFits = await page.evaluate<boolean>(`(() => {
    const table = document.querySelector('table');
    let box = table.parentElement;
    while (box !== null && box !== document.body) {
      if (box.scrollWidth > box.clientWidth) return false;
      box = box.parentElement;
    }
    return true;
  })()`);
  expect(tableFits).toBe(true);
  await screenshot(page, 'rooms-1047', SCREENS_27B2);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(heading(page, en.home.title)).toBeVisible();
  expect((await widths(page)).pageFits).toBe(true);

  await page
    .getByRole('navigation', { name: en.menu.tabs })
    .getByRole('button', { name: en.menu.more, exact: true })
    .click();
  const more = page.getByRole('dialog', { name: en.menu.more });
  await expect(more.getByText(en.feedback.button, { exact: true })).toBeVisible();
  await screenshot(page, 'more-390', SCREENS_27B2);
});
