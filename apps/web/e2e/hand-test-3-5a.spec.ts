import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { accountOf, type AccountKey } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn, type PageTexts } from './steps';
import { codeNow } from './totp';

// Task 3.5a (issue #105, Parts A and B): the Students list, a student panel,
// the Classes page, the Parents list and the teaching load at 375 px and
// 1440 px, in Uzbek and in Russian, each with an account of its own (seeded
// in "Hand test 3.5a branch"). With SCREENSHOTS=1 the pages are saved to
// docs/screens/3.5a for the report. All names are invented.

const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.5a');
const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(300);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

/** The page never scrolls sideways. */
async function fitsSideways(page: Page): Promise<void> {
  // The elements that reach past the window, named for the failure message.
  const wide = await page.evaluate<string[]>(`(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth) return [];
    return [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((element) => element.tagName + '.' + String(element.className).slice(0, 80) + ' ' + Math.round(element.getBoundingClientRect().right));
  })()`);
  expect(wide).toEqual([]);
}

/** Whether an element's content is wider than its box. */
const cut = (page: Page, selector: string) =>
  page.evaluate<boolean[]>(
    `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].map((element) => element.scrollWidth > element.clientWidth + 1))()`,
  );

/**
 * H16: every short label of the phone tab bar, of every menu item (so of
 * every role's bar) and in the three languages, drawn at 360 px in a tab of
 * the bar with its own font and size: none is cut.
 */
async function shortLabelsFit(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: uz.menu.tabs })).toBeVisible();
  const labels = [en, uz, ru].flatMap((texts) => Object.values(texts.menu.short));
  const cutLabels = await page.evaluate<string[]>(`(() => {
    const tab = document.querySelector(${JSON.stringify(`nav[aria-label="${uz.menu.tabs}"] a span`)});
    if (tab === null) return ['no tab bar'];
    const original = tab.textContent;
    const cut = ${JSON.stringify(labels)}.filter((label) => {
      tab.textContent = label;
      return tab.scrollWidth > tab.clientWidth + 1;
    });
    tab.textContent = original;
    return cut;
  })()`);
  expect(cutLabels).toEqual([]);
}

async function signedIn(page: Page, key: AccountKey, t: PageTexts, language: 'uz' | 'ru') {
  const account = accountOf(key);
  await page.goto('/sign-in');
  await languageChooser(page).selectOption(language);
  await signIn(page, t, account.login, account.password);
  await changeFirstPassword(page, t, account);
  await page.getByRole('button', { name: t.setUp.start, exact: true }).click();
  const secret = await page.locator('dd').innerText();
  await page.getByLabel(t.setUp.code, { exact: true }).fill(codeNow(secret));
  await page.getByRole('button', { name: t.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: t.setUp.saved }).check();
  await page.getByRole('button', { name: t.setUp.continue, exact: true }).click();
  await expect(heading(page, t.home.title)).toBeVisible();
}

async function walk(page: Page, t: PageTexts, language: 'uz' | 'ru'): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const phone = size.width < 640;
    const at = `${language}-${String(size.width)}`;

    // The Students list (H6, H13, H15, H16, H17).
    await page.goto('/people/students');
    await expect(heading(page, t.people.students.title)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rasulova Nodira', exact: true })).toBeVisible();
    await fitsSideways(page);
    const tabs = page.getByRole('navigation', { name: t.people.sections });
    if (phone) {
      // H17: the filters fold behind one button; search stays.
      await expect(page.getByRole('button', { name: t.list.filters, exact: true })).toBeVisible();
      // The selects of the filters are in the page but hidden until opened.
      await expect(page.locator('main select').first()).toBeHidden();
      await expect(page.getByLabel(t.list.search, { exact: true })).toBeVisible();
      // H16: no label of the tab bar is cut.
      expect(await cut(page, `nav[aria-label="${t.menu.tabs}"] a span`)).not.toContain(true);
      // H15: the People tabs scroll inside their row, the cut edge marked.
      await expect(tabs).toHaveAttribute('data-cut', /end|both/);
    } else {
      await expect(page.getByRole('button', { name: t.list.filters, exact: true })).toHaveCount(0);
      await expect(page.locator('main select').first()).toBeVisible();
      // H15: the six tabs fit, no scrollbar, nothing cut.
      expect(await cut(page, `nav[aria-label="${t.people.sections}"]`)).toEqual([false]);
      await expect(tabs).not.toHaveAttribute('data-cut', /.+/);
      await expect(page.getByRole('columnheader', { name: t.people.students.name })).toBeVisible();
      const later = page.locator('tbody tr').filter({ hasText: 'Rasulova Nodira' });
      const [before, after] = t.people.students.startsFrom.split('{{date}}');
      await expect(later).toContainText((before ?? '').trim() || (after ?? '').trim());
      await expect(later).not.toContainText(t.people.students.statuses.active);
    }
    await expect(tabs).toHaveCSS('scrollbar-width', 'none');
    await screenshot(page, `students-${at}`);

    // A student panel (H3, H14): the scheduled leaving reads in the future.
    await page.getByRole('button', { name: 'Karimova Malika', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Malika Karimova' });
    const [start] = t.people.students.plannedCauses.leaving.split('{{lastDay}}');
    await expect(panel.getByText(start ?? '', { exact: false })).toBeVisible();
    await expect(panel.getByRole('link', { name: t.audit.history, exact: true })).toBeVisible();
    await fitsSideways(page);
    await screenshot(page, `student-panel-${at}`);

    // The Classes page (H10, H11).
    await page.goto('/classes');
    await expect(heading(page, t.classes.title)).toBeVisible();
    await expect(page.getByText('7 Princeton').first()).toBeVisible();
    await fitsSideways(page);
    await screenshot(page, `classes-${at}`);

    // The Parents list (H7): surname first, the header says so.
    await page.goto('/people/parents');
    await expect(heading(page, t.people.relatives.title)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aliyeva Zarina', exact: true })).toBeVisible();
    if (!phone) {
      await expect(
        page.getByRole('columnheader', { name: t.people.relatives.listName }),
      ).toBeVisible();
    }
    await fitsSideways(page);
    await screenshot(page, `parents-${at}`);

    // The teaching load (H21): cards at phone width, never a wide table.
    await page.goto('/timetable/load');
    await expect(heading(page, t.timetable.load.title)).toBeVisible();
    if (phone) {
      await expect(page.locator('[data-load-card]')).toHaveCount(1);
      await expect(page.locator('[data-load-card]')).toContainText('7 Oxford');
      await expect(page.locator('table')).toHaveCount(0);
    } else {
      await expect(
        page.locator('table:not([data-totals]) tbody tr').filter({ hasText: '7 Oxford' }),
      ).toHaveCount(1);
    }
    await fitsSideways(page);
    await screenshot(page, `load-${at}`);
  }
}

test('the hand test pages of task 3.5a in Uzbek at 375 and 1440 px', async ({ page }) => {
  test.setTimeout(180_000);
  await signedIn(page, 'handTestUz', uz, 'uz');
  await shortLabelsFit(page);
  // H11b: the role switch is shown only with several roles; this account has one.
  await walk(page, uz, 'uz');
});

test('the hand test pages of task 3.5a in Russian at 375 and 1440 px', async ({ page }) => {
  test.setTimeout(180_000);
  await signedIn(page, 'handTestRu', ru, 'ru');
  await walk(page, ru, 'ru');
});
