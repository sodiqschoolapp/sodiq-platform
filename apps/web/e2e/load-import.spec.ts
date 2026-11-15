import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, headerLink, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Written by the seed of the API (`LOAD_IMPORT_FILE` of apps/api/src/testing/e2e/import-file.ts),
// for the seeded draft of the branch.
const FILE = path.join(tmpdir(), 'sodiq-e2e-load-import.xlsx');

// Task 5.13 (`06`, Importing the load and the timetable): an Academic Vice Principal opens the
// import from the load page of a draft, downloads the template of the draft, uploads a filled
// file of one row (7 Seeded, Geometry, an open vacancy), sees the preview clean, adds the row and
// finds it on the load page.
test('an Academic Vice Principal imports the teaching load of a draft', async ({ page }) => {
  const account = accountOf('loadImportVice');
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

  await page.goto('/timetable/load');
  await expect(heading(page, en.timetable.load.title)).toBeVisible();
  await headerLink(page, en.timetable.loadImport.open).click();
  await expect(heading(page, en.timetable.loadImport.title)).toBeVisible();

  const texts = en.people.import;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: texts.template, exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Load import.xlsx');

  await page.getByLabel(texts.upload, { exact: true }).setInputFiles(FILE);
  await expect(page.getByText('1 row, 0 with problems.')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(texts.rowClean);
  await page.getByRole('button', { name: 'Add 1 row', exact: true }).click();
  await expect(page.getByText('1 row added to the load.')).toBeVisible();

  await page.getByRole('link', { name: en.timetable.loadImport.toLoad, exact: true }).click();
  await expect(heading(page, en.timetable.load.title)).toBeVisible();
  const list = page.locator('tbody tr');
  // The row of the load, and the vacancy with its 3 lessons in the totals.
  // The class also has a line in the totals, which names no subject.
  await expect(list.filter({ hasText: '7 Seeded' }).filter({ hasText: 'Geometry' })).toHaveCount(1);
  await expect(
    list.filter({ hasText: 'Geometry wanted (vacancy)' }).filter({ hasNotText: 'Seeded' }),
  ).toContainText('3');
});
