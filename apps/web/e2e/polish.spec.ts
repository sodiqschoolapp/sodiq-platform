import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

/** How far the page scrolls sideways; e2e code has no DOM types, so it is a text. */
const SIDEWAYS = 'document.documentElement.scrollWidth - document.documentElement.clientWidth';

/** How far the slogan's longest word runs out of its own box. */
const SLOGAN_OVERFLOW =
  '(() => { const slogan = document.querySelector(".bg-sidebar p"); return slogan.scrollWidth - slogan.clientWidth; })()';

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
    ['en', en],
    // Russian last: its longest word is the widest (the check after the loop).
    ['ru', ru],
  ] as const) {
    await languageChooser(page, shown).selectOption(language);
    shown = texts;
    await expect(heading(page, texts.signIn.title)).toBeVisible();
    const slogan = page.getByText(texts.brand.slogan, { exact: true });
    const column = page.locator('.bg-sidebar > svg');
    for (const width of [640, 700, 732, 768, 1024, 1280, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(slogan).toBeVisible();
      const scrolled = await page.evaluate<number>(SIDEWAYS);
      expect(scrolled, `${language} at ${String(width)} px`).toBe(0);
      expect(
        await page.evaluate<number>(SLOGAN_OVERFLOW),
        `${language} at ${String(width)} px`,
      ).toBe(0);
      // Only sizes of the type table: 28 / 34, 40 / 44, 56 / 58.
      await expect(slogan, `${language} at ${String(width)} px`).toHaveCSS(
        'font-size',
        /^(28|40|56)px$/,
      );
      // The hexagon column of the brand book's cover from 768 px on.
      if (width >= 768) {
        await expect(column).toBeVisible();
      } else {
        await expect(column).toBeHidden();
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(slogan).toHaveCSS('font-size', '56px');
    await expect(slogan).toHaveCSS('line-height', '58px');
  }
  // Below 768 px the column leaves the Russian slogan no room: drawn there, it
  // would run into it (correction 2 of the review).
  await page.setViewportSize({ width: 700, height: 900 });
  await page.addStyleTag({ content: '.bg-sidebar > svg { display: block !important; }' });
  expect(await page.evaluate<number>(SLOGAN_OVERFLOW)).toBeGreaterThan(0);
});

// Finding 32: "Trust this device" was announced as "on". The browser's
// accessibility tree names the checkbox by its words.
test('the "Trust this device" switch is named by its words', async ({ page }) => {
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  const trust = page.getByRole('checkbox', { name: en.signIn.trust, exact: true });
  await expect(trust).toBeVisible();
  await expect(page.locator('form')).toMatchAriaSnapshot(`- checkbox "${en.signIn.trust}"`);
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
