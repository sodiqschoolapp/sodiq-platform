import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/build-plan.md, task 0.8c: a role switcher and a branch switcher in the top
// bar change the menu and the home page (docs/spec/02-roles-and-access.md); every
// request names its one branch (docs/decisions.md, task 0.4b).
test('the role switcher changes the home page and the branch switcher the branch of the calls', async ({
  page,
}) => {
  const account = accountOf('switchers');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  // The first role of the table of 02: Tutor.
  const roles = page.getByRole('combobox', { name: en.switcher.role, exact: true });
  await expect(page.getByText(en.home.tutor)).toBeVisible();
  await expect(roles).toHaveValue('tutor');
  // The Tutor holds one branch: no branch switcher.
  const branches = page.getByRole('combobox', { name: en.switcher.branch, exact: true });
  await expect(branches).toHaveCount(0);

  await roles.selectOption('teacher');
  await expect(page.getByText(en.home.teaching)).toBeVisible();
  await expect(branches).toHaveCount(1);
  await expect(branches.locator('option')).toHaveCount(2);

  // The choice is kept by the tab, not by the account.
  await page.reload();
  await expect(page.getByText(en.home.teaching)).toBeVisible();

  // The next call names the chosen branch.
  const second = await branches.locator('option').nth(1).getAttribute('value');
  await branches.selectOption(second);
  const sent = page.waitForRequest((request) => request.url().endsWith('/api/feedback'));
  await page.getByRole('button', { name: en.feedback.button, exact: true }).click();
  await page.getByLabel(en.feedback.message, { exact: true }).fill('A test of the branch header.');
  await page.getByRole('button', { name: en.feedback.send, exact: true }).click();
  expect((await sent).headers()['x-branch-id']).toBe(second);
});
