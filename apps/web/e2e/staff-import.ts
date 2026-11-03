import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { heading } from './steps';

// Written by the seed of the API (`STAFF_IMPORT_FILE` of apps/api/src/testing/e2e/import-file.ts).
const FILE = path.join(tmpdir(), 'sodiq-e2e-staff-import.xlsx');

/**
 * docs/spec/04-people.md, Teacher and staff record: the import; task 9.4h,
 * pull request #279. The Super Admin downloads the staff template, uploads a
 * filled file of two invented teachers (one a Tutor), sees the preview clean
 * with the logins, saves both and gets two first-password slips with a Print
 * button; the two are then in the staff list. The seed holds no fourth Super
 * Admin, so this runs at the end of the years test's session, in its branch.
 */
export async function importStaff(page: Page): Promise<void> {
  await page.goto('/people/staff');
  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Years browser test branch' });
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  await page.getByRole('link', { name: en.people.staffImport.open, exact: true }).click();
  await expect(heading(page, en.people.staffImport.title)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en.people.import.template, exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Staff import.xlsx');

  await page.getByLabel(en.people.import.upload, { exact: true }).setInputFiles(FILE);
  await expect(page.getByText('2 rows, 0 with problems.')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Qodirova' })).toContainText(en.roles.tutor);
  await expect(rows.filter({ hasText: 'Qodirov Anvar' })).toContainText('a.qodirov');
  await page.getByRole('button', { name: 'Save all 2 people', exact: true }).click();
  await expect(page.getByText('2 staff records saved.')).toBeVisible();

  const slips = page.getByRole('region', { name: 'First-password slips (2)' });
  await expect(slips.locator('[data-slip]')).toHaveCount(2);
  await expect(slips.getByRole('button', { name: en.people.staffImport.print })).toBeVisible();

  await page.getByRole('link', { name: en.people.staffImport.toList, exact: true }).click();
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  const list = page.locator('tbody tr');
  await expect(list.filter({ hasText: 'Qodirov Anvar' })).toHaveCount(1);
  await expect(list.filter({ hasText: 'Qodirova Mohira' })).toHaveCount(1);
}
