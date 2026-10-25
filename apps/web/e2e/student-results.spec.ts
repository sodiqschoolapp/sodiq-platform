import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/08-results-rating-analytics.md, Student results: "A student's page shows, for each
// subject and quarter: attendance average, classwork average, homework average, rating exam,
// quarter result and grade. Clicking a figure opens the lessons behind it" (task 9.1). A
// Principal of the "Plans in the journal browser test branch" opens Sardor Alimov's profile,
// the Results tab, and the lessons behind the Geodesy result. All names are invented.
test('a Principal opens a student’s results and the lessons behind a result', async ({ page }) => {
  const account = accountOf('resultsPrincipal');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/people/students');
  await expect(heading(page, en.people.students.title)).toBeVisible();
  await page.getByRole('button', { name: 'Alimov Sardor', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Sardor Alimov' });
  const tabs = panel.getByRole('radiogroup', { name: en.people.students.tabs.label });
  await tabs.getByText(en.people.students.tabs.results, { exact: true }).click();
  const row = panel.locator('tbody tr').filter({ hasText: 'Geodesy' });
  await expect(row).toBeVisible();
  await row
    .getByRole('button', {
      name: en.results.openLessons
        .replace('{{part}}', en.results.parts.result)
        .replace('{{subject}}', 'Geodesy'),
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toContainText('Geodesy');
  await expect(dialog.locator('tbody tr').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await tabs.getByText(en.people.students.tabs.attendance, { exact: true }).click();
  await expect(panel.locator('tbody tr').filter({ hasText: 'Geodesy' })).toBeVisible();
});
