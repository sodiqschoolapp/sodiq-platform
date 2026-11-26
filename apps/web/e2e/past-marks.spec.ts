import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Written by the seed of the API (`PAST_MARKS_*` of apps/api/src/testing/e2e/import-file.ts).
const BAD_FILE = path.join(tmpdir(), 'sodiq-e2e-past-marks-bad.xlsx');
const FILE = path.join(tmpdir(), 'sodiq-e2e-past-marks.xlsx');
const DATE_FILE = path.join(tmpdir(), 'sodiq-e2e-past-marks-date.txt');

// Task 11.26 (`10`, Past marks from before go-live): an Academic Vice Principal downloads the
// template, uploads a file with a comma in a score and sees the problem on its row, uploads the
// corrected file and saves it; the upload is listed. The child's mother then sees the past mark
// on the Attendance page by its lesson number, and the past score on the Grades page, with no
// label. All names are invented.
test('an Academic Vice Principal imports past marks and a parent sees them', async ({ page }) => {
  const texts = en.setup.pastMarks;
  const vice = accountOf('pastMarksVice');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, vice.login, vice.password);
  await changeFirstPassword(page, en, vice);
  await expect(heading(page, en.setUp.title)).toBeVisible();
  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  const key = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/setup');
  await page.getByRole('link', { name: en.setup.pastMarksLink, exact: true }).click();
  await expect(heading(page, texts.title)).toBeVisible();
  await expect(page.getByText(texts.emptyTitle)).toBeVisible();
  await page.getByRole('link', { name: texts.import, exact: true }).click();
  await expect(heading(page, texts.importTitle)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en.people.import.template, exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Past marks import.xlsx');

  await page.getByLabel(en.people.import.upload, { exact: true }).setInputFiles(BAD_FILE);
  await expect(page.getByText('1 row, 1 with problems.')).toBeVisible();
  await expect(page.locator('tbody tr')).toContainText(
    `Classwork: score: ${texts.problems.amount_comma}`,
  );
  await expect(page.getByRole('button', { name: 'Save 1 row', exact: true })).toBeDisabled();

  await page.getByLabel(en.people.import.upload, { exact: true }).setInputFiles(FILE);
  await expect(page.getByText('1 row, 0 with problems.')).toBeVisible();
  await page.getByRole('button', { name: 'Save 1 row', exact: true }).click();
  await expect(page.getByText('1 row saved.')).toBeVisible();
  await page.getByRole('link', { name: texts.toList, exact: true }).click();
  await expect(
    page.locator('tbody tr').filter({ hasText: 'sodiq-e2e-past-marks.xlsx' }),
  ).toContainText(texts.standing);

  // The mother, in a fresh session.
  await page.context().clearCookies();
  const parent = accountOf('pastMarksParent');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, parent.login, parent.password);
  await changeFirstPassword(page, en, parent);
  await expect(page).toHaveURL(/\/portal\/[0-9a-f-]+\/today$/);
  const date = readFileSync(DATE_FILE, 'utf8').trim();
  const base = page.url().replace(/\/today$/, '');
  await page.goto(`${base}/attendance?date=${date}`);
  const lesson = page.locator('li').filter({ hasText: 'Past history' });
  await expect(lesson).toContainText('Lesson 1');
  await expect(lesson).toContainText(en.portal.attendance.marks.late);

  await page.goto(`${base}/grades`);
  // The past score lies in quarter 1; the page opens on the current quarter.
  await page.getByRole('radio', { name: 'Quarter 1', exact: true }).click();
  const score = page.locator('[data-score-row]').filter({ hasText: 'Dictation' });
  await expect(score).toContainText('Past history');
  await expect(score.locator('[data-score]')).toHaveText('7.5/1075%');
});
