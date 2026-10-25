import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { xlsxTexts } from './xlsx-text';

/** The file a click saves, read back. */
async function saved(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const started = page.waitForEvent('download');
  await click();
  const file = await started;
  return readFile(await file.path());
}

// docs/spec/07-journal.md, last paragraph: "Export to Excel and PDF, and print, for a month or a
// quarter"; docs/spec/edge-cases/system-behaviour.md: "A large export is a background job ...
// The link works for 24 hours and access is checked again at download" (task 8.9). The
// Principal of the "Plans in the journal browser test branch" exports its Geodesy
// journal from the journal page, then asks for the export of the branch, which the worker of
// the browser tests makes, and downloads it. All names are invented.
test('a Principal exports a journal to Excel and downloads the export of the branch', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const account = accountOf('exportsPrincipal');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/journal');
  await expect(heading(page, en.journal.page.title)).toBeVisible();
  await page.locator('tbody tr').filter({ hasText: 'Geodesy' }).getByRole('button').first().click();
  await expect(heading(page, en.journal.sheet)).toBeVisible();
  const journal = await saved(page, () =>
    page.getByRole('button', { name: en.timetable.views.excel, exact: true }).click(),
  );
  const texts = xlsxTexts(journal);
  expect(texts).toContain('Class journal');
  expect(texts.some((text) => text.startsWith('Provisional · '))).toBe(true);

  await page.goto('/journal');
  await page.getByRole('link', { name: en.journal.exports.title, exact: true }).click();
  await expect(heading(page, en.journal.exports.title)).toBeVisible();
  await page.getByRole('button', { name: en.journal.exports.ask, exact: true }).click();
  await expect(page.getByText(en.journal.exports.asked)).toBeVisible();
  // The worker makes the file; the list is read again until it is ready.
  const downloadButton = page.getByRole('button', {
    name: en.journal.exports.download,
    exact: true,
  });
  await expect(async () => {
    await page.getByRole('button', { name: en.journal.exports.refresh, exact: true }).click();
    await expect(downloadButton).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  const branch = await saved(page, () => downloadButton.click());
  const branchTexts = xlsxTexts(branch);
  expect(branchTexts).toContain('Class journal');
  expect(branchTexts.some((text) => text.includes('Geodesy'))).toBe(true);
});
