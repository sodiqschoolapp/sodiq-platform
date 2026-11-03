import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Written by the seed of the API (`STUDENT_IMPORT_FILE` of apps/api/src/testing/e2e/import-file.ts).
const FILE = path.join(tmpdir(), 'sodiq-e2e-student-import.xlsx');

// docs/spec/04-people.md, Student record: Excel import; task 9.4g, pull request
// #278. An Academic Vice Principal downloads the system's template, uploads a
// filled file of two invented students, sees the preview clean and saves both,
// who are then in the student list in "7 Seeded".
test('an Academic Vice Principal imports students from the template', async ({ page }) => {
  const account = accountOf('importVice');
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

  await page.goto('/people/students');
  await expect(heading(page, en.people.students.title)).toBeVisible();
  await page.getByRole('link', { name: en.people.import.open, exact: true }).click();
  await expect(heading(page, en.people.import.title)).toBeVisible();

  const texts = en.people.import;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: texts.template, exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Student import.xlsx');

  await page.getByLabel(texts.upload, { exact: true }).setInputFiles(FILE);
  await expect(page.getByText('2 rows, 0 with problems.')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'IMPORT-E2E-1' })).toContainText(texts.rowClean);
  await page.getByRole('button', { name: 'Save all 2 students', exact: true }).click();
  await expect(page.getByText('2 students saved.')).toBeVisible();

  await page.getByRole('link', { name: texts.toList, exact: true }).click();
  await expect(heading(page, en.people.students.title)).toBeVisible();
  const list = page.locator('tbody tr');
  await expect(list.filter({ hasText: 'IMPORT-E2E-1' })).toContainText('7 Seeded');
  await expect(list.filter({ hasText: 'IMPORT-E2E-2' })).toContainText('7 Seeded');
});
