import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

/** How far the page scrolls sideways; e2e code has no DOM types, so it is a text. */
const SIDEWAYS = 'document.documentElement.scrollWidth - document.documentElement.clientWidth';

// Task 2.7a: findings of the owner's hand test of 13 October 2026 (issue #39)
// that only a real browser can show.

// Finding 1: the sign-in page scrolled sideways on laptop and tablet widths
// (732 → 844, 1024 → 1126, 1280 → 1326).
test('the sign-in page is never wider than the window', async ({ page }) => {
  await page.goto('/sign-in');
  // The chooser is named in the language the page is in now.
  let shown: typeof en = en;
  await languageChooser(page, shown).selectOption('en');
  for (const [language, texts] of [
    ['uz', uz],
    ['ru', ru],
    ['en', en],
  ] as const) {
    await languageChooser(page, shown).selectOption(language);
    shown = texts;
    await expect(heading(page, texts.signIn.title)).toBeVisible();
    for (const width of [732, 1024, 1280, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const slogan = page.getByText(texts.brand.slogan, { exact: true });
      await expect(slogan).toBeVisible();
      const scrolled = await page.evaluate<number>(SIDEWAYS);
      expect(scrolled, `${language} at ${String(width)} px`).toBe(0);
    }
    // The hexagon column of the brand book's cover stays on a laptop.
    await page.setViewportSize({ width: 1366, height: 900 });
    const column = page.locator('.bg-sidebar > svg');
    await expect(column).toBeVisible();
    // The slogan keeps its size where its longest word fits.
    await page.setViewportSize({ width: 1440, height: 900 });
    if (language === 'en') {
      await expect(page.getByText(texts.brand.slogan, { exact: true })).toHaveCSS(
        'font-size',
        '56px',
      );
    }
  }
});

// Finding 8: at phone width the People tabs wrapped, and "Accounts never used"
// was off screen with no way to reach it.
test('the People tabs scroll in their row at phone width', async ({ page }) => {
  const account = accountOf('peopleTabs');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/people/staff');
  const tabs = page.getByRole('navigation', { name: en.people.sections, exact: true });
  await expect(tabs).toBeVisible();
  // One row: every tab on the line of the first.
  const tops: number[] = [];
  for (const link of await tabs.getByRole('link').all()) {
    const box = await link.boundingBox();
    tops.push(Math.round(box?.y ?? -1));
  }
  expect(new Set(tops).size).toBe(1);
  // The page itself does not scroll sideways; the row does.
  expect(await page.evaluate<number>(SIDEWAYS)).toBe(0);
  const last = tabs.getByRole('link', { name: en.people.neverUsed.title, exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await last.click();
  await expect(page).toHaveURL(/\/people\/never-used/);
  await expect(
    page
      .getByRole('navigation', { name: en.people.sections, exact: true })
      .getByRole('link', { name: en.people.neverUsed.title, exact: true }),
  ).toBeInViewport();
});
