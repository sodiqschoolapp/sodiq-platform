import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Written by the seed of the API (`PATTERN_IMPORT_FILE` of apps/api/src/testing/e2e/import-file.ts),
// for the seeded draft of the branch.
const FILE = path.join(tmpdir(), 'sodiq-e2e-pattern-import.xlsx');

// Task 5.14 (`06`, Importing the load and the timetable): an Academic Vice Principal opens the
// import from step 7 of the builder, downloads the template of the draft, uploads a filled file of
// three lessons, confirms that the two lessons placed by hand are removed, and finds the file's
// lessons on the board.
test('an Academic Vice Principal imports the timetable of a draft', async ({ page }) => {
  const account = accountOf('patternImportVice');
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

  await page.goto('/timetable/builder');
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  await page.locator('[data-step="grid"] button').click();
  await expect(page.locator('[data-board]')).toBeVisible();
  await page.getByRole('link', { name: en.timetable.patternImport.open, exact: true }).click();
  await expect(heading(page, en.timetable.patternImport.title)).toBeVisible();

  const texts = en.people.import;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: texts.template, exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Timetable import.xlsx');

  await page.getByLabel(texts.upload, { exact: true }).setInputFiles(FILE);
  await expect(page.getByText('3 rows, 0 with problems.')).toBeVisible();
  await expect(
    page.getByText('The draft holds 2 placed lessons; confirming removes them.'),
  ).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Place all 3 lessons', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Remove 2 placed lessons of this draft?')).toBeVisible();
  await dialog
    .getByRole('button', { name: en.timetable.patternImport.replaceAction, exact: true })
    .click();
  await expect(page.getByText('3 lessons placed.')).toBeVisible();

  await page.getByRole('link', { name: en.timetable.patternImport.toGrid, exact: true }).click();
  const board = page.locator('[data-board]');
  await expect(board).toBeVisible();
  const cell = (weekday: number, position: number) =>
    page.locator(`[data-cell="${String(weekday)}:${String(position)}"]`);
  // 7 Oxford: the lesson placed by hand on Monday is gone; the file's are on Tuesday.
  await expect(cell(1, 1).locator('[data-block]')).toHaveCount(0);
  await expect(cell(2, 1).locator('[data-block]')).toContainText('Geometry');
  await expect(cell(2, 2).locator('[data-block]')).toContainText('Geometry');
});
