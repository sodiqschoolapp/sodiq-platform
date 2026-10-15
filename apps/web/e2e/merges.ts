import { expect, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { heading } from './steps';

/**
 * edge/students-classes-groups, "A student who left in 2025 is created again
 * as new": "The Super Admin can merge two records; the older UID survives."
 * Task 3.3d, pull request #98. The Super Admin opens the record created
 * again (UID 9999962), merges the record of the student who left (UID
 * 9999961) into it, and sees the older UID stay, "Also UID" with the other
 * one, and the merge on the History tab. The seed holds no fourth Super
 * Admin (correction 1 of the review of #87), so this runs at the end of the
 * divisions test's session. All names are invented.
 */
export async function mergeRecords(page: Page): Promise<void> {
  const texts = en.people.students;
  const merge = texts.merge;
  const bar = page.getByRole('banner', { name: en.layout.topBar });

  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await bar.getByLabel(en.switcher.branch).selectOption({ label: 'Merges browser test branch' });
  const again = page.locator('tbody tr').filter({ hasText: '9999962' });
  await again.getByRole('button', { name: 'Karimova Dilnoza', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Dilnoza Karimova' });
  await panel.getByRole('button', { name: merge.action, exact: true }).click();
  const form = panel.getByRole('form', { name: merge.action });
  await form.getByLabel(merge.uid, { exact: true }).fill('9999961');
  await form.getByRole('button', { name: merge.show, exact: true }).click();
  // The older UID stays: the record of the student who left.
  await expect(form.getByText(/UID 9999961/).first()).toBeVisible();
  await expect(form.getByText(merge.kept, { exact: true })).toBeVisible();
  await form.getByLabel(merge.reason, { exact: true }).fill('Created again after leaving');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: merge.confirmTitle })
    .getByRole('button', { name: merge.submit, exact: true })
    .click();

  // The panel shows the kept record: the older UID, "Also UID" the other.
  const kept = page.getByRole('complementary', { name: 'Dilnoza Karimova' });
  await expect(kept.getByText('9999961', { exact: true })).toBeVisible();
  await expect(kept.getByText(merge.alsoUid, { exact: true })).toBeVisible();
  await expect(kept.getByText('9999962', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: '9999961' })).toContainText('7 Oxford');
  await kept
    .getByRole('radiogroup', { name: texts.tabs.label })
    .getByText(texts.tabs.history, { exact: true })
    .click();
  await expect(
    kept.getByText(
      merge.historyLine
        .replace('{{uid}}', '9999962')
        .replace('{{reason}}', 'Created again after leaving'),
    ),
  ).toBeVisible();
}
