import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/06-timetable.md, Protection: "Version history shows every version
// in the order of their start dates, names the version in force on the first
// day of each quarter, compares two versions, and can reopen an old one as a
// new draft"; edge/academic-year: "Entries whose teacher, room, subject or
// class is no longer active go to the 'to place' list with the reason"
// (task 5.8a, pull request #194). The seed published version 1 of its own
// branch with 7 Princeton's Geometry in Room 31, then closed Room 31. All
// names are invented.
test('an Academic Vice Principal restores a version as a new draft and compares the two', async ({
  page,
}) => {
  const account = accountOf('versionHistory');
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

  const texts = en.timetable.history;
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.versionsLink, exact: true }).click();
  await expect(heading(page, texts.title)).toBeVisible();
  const first = page.locator('tbody tr').filter({ hasText: 'Version 1' });
  await expect(first).toContainText(en.timetable.load.statuses.published);
  await expect(first).toContainText('the first day of quarter');

  // Restore version 1 as a new draft: the builder opens on its grid.
  await page.getByRole('button', { name: 'Version 1', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Version 1' });
  await panel.getByRole('button', { name: texts.restore, exact: true }).click();
  await panel.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  await expect(page.locator('[data-board]')).toBeVisible();
  const left = page.locator('[data-left-blocks]');
  await expect(left.locator('h4')).toHaveText('Not copied from version 1');
  await expect(left.locator('[data-left-block]')).toHaveText([
    `7 Princeton, Geometry, Monday, slot 2: ${texts.left.copy_room_inactive}`,
  ]);
  // 7 Oxford's Geometry was copied in its place.
  await expect(page.locator('[data-board]')).toContainText('Geometry');

  // Compare the new draft with version 1.
  await page.goto('/timetable/versions');
  await page.getByRole('button', { name: 'Version 2', exact: true }).click();
  const draftPanel = page.getByRole('complementary', { name: 'Version 2' });
  await draftPanel.getByLabel(texts.compareWith).selectOption({ label: 'Version 1' });
  await expect(draftPanel.locator('[data-comparison-of]')).toHaveText(
    'Changes from Version 1 to Version 2',
  );
  await expect(draftPanel.locator('[data-difference="placement_removed"]')).toHaveText([
    'Lesson removed: Monday, slot 2, Room 31',
  ]);
});
