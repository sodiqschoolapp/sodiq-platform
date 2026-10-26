import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

const roleButton = (role: 'principal' | 'head_tutor') =>
  en.switcher.roleButton.replace('{{role}}', en.roles[role]);

// docs/spec/08-results-rating-analytics.md, Home pages by role (task 9.4b): the Principal of the
// "Journal browser test branch", also its Head Tutor, opens the branch summary (students, staff,
// attendance today, results by grade) and, as Head Tutor, the attendance of all classes today.
// The figures are tested by the route tests. All names are invented.
test('the Principal sees the branch summary and, as Head Tutor, the attendance of all classes today', async ({
  page,
}) => {
  const account = accountOf('homeLeader');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  // The first role of the table of 02: Principal.
  for (const title of [en.home.summary.students, en.home.summary.staff]) {
    const tile = page.getByRole('region', { name: title, exact: true });
    await expect(tile.locator('[data-count]')).toHaveText(/^[1-9][\d\s\u00a0,]*$/);
  }
  await expect(
    page.getByRole('region', { name: en.home.summary.attendance, exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-card="grades"]')).toBeVisible();
  await expect(page.getByRole('button', { name: en.problems.retry })).toHaveCount(0);

  await page.getByRole('button', { name: roleButton('principal'), exact: true }).click();
  await page.getByRole('menuitemradio', { name: en.roles.head_tutor }).click();
  await expect(
    page.getByRole('button', { name: roleButton('head_tutor'), exact: true }),
  ).toBeVisible();
  const card = page.getByRole('region', { name: en.home.attendance.allClasses, exact: true });
  await expect(card).toBeVisible();
  await expect(
    card
      .getByText(en.home.attendance.branch, { exact: false })
      .or(card.getByText(en.home.attendance.noClasses, { exact: true })),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: en.problems.retry })).toHaveCount(0);
});
