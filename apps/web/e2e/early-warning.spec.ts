import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/08-results-rating-analytics.md, Early-warning list (task 9.4a): the Tutor of 7 Bristol
// of the "Plans in the journal browser test branch" opens the list, finds Nodir Qosimov listed in
// Geodesy for a low result and low attendance, opens the entry and marks the attendance handled
// with a staff-only note; the attendance reason leaves the list and the low result stays. The
// scope, the five-works gate and the return of a handled reason are tested by the route tests.
// All names are invented.
test('a Tutor finds a student on the early-warning list and marks a reason handled with a note', async ({
  page,
}) => {
  const account = accountOf('earlyTutor');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  // The rating links to the list.
  await page.goto('/results/rating');
  await page.getByRole('link', { name: en.results.earlyWarning.link, exact: true }).click();
  await expect(heading(page, en.results.earlyWarning.title)).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: 'Qosimov Nodir' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Geodesy');
  await expect(row.locator('[data-reason="low_result"]')).toHaveText('Result 7, below 50');
  await expect(row.locator('[data-reason="low_attendance"]')).toHaveText(
    'Attendance 0%, below 80%',
  );

  await row.getByText('Qosimov Nodir', { exact: true }).click();
  await page
    .getByLabel(en.results.earlyWarning.which, { exact: true })
    .selectOption('low_attendance');
  await page
    .getByLabel(en.results.earlyWarning.note, { exact: true })
    .fill('Spoke to the parents.');
  await page.getByRole('button', { name: en.results.earlyWarning.handle, exact: true }).click();

  await expect(row.locator('[data-reason="low_attendance"]')).toHaveCount(0);
  await expect(row.locator('[data-reason="low_result"]')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
