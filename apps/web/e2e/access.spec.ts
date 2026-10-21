import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// Task 5.9b: the Tutor's and the Teacher's home show the own lessons under "Today".
const todayOf = (page: Parameters<typeof heading>[0]) =>
  page.getByRole('heading', { name: new RegExp(`^${en.home.lessons.today}, `) });

const roleButton = (role: 'tutor' | 'teacher') =>
  en.switcher.roleButton.replace('{{role}}', en.roles[role]);

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
  // Issue #105, H11b: a menu button that says what it changes, its menu the hint.
  const roles = page.getByRole('button', { name: roleButton('tutor'), exact: true });
  await expect(todayOf(page)).toBeVisible();
  await expect(roles).toHaveText(`${en.switcher.rolePrefix}${en.roles.tutor}`);
  // The keyboard: Enter opens the menu with its hint, Escape closes it, the
  // arrows move between the roles and Enter chooses one.
  await roles.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(en.switcher.roleHint, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(en.switcher.roleHint, { exact: true })).toBeHidden();
  await expect(roles).toBeFocused();
  // The Tutor holds one branch: no branch switcher.
  const branches = page.getByRole('combobox', { name: en.switcher.branch, exact: true });
  await expect(branches).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: en.roles.tutor })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: en.roles.teacher })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(todayOf(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: roleButton('teacher'), exact: true }),
  ).toBeVisible();
  await expect(branches).toHaveCount(1);
  await expect(branches.locator('option')).toHaveCount(2);

  // The choice is kept by the tab, not by the account.
  await page.reload();
  await expect(todayOf(page)).toBeVisible();

  // The next call names the chosen branch.
  const second = await branches.locator('option').nth(1).getAttribute('value');
  await branches.selectOption(second);
  const sent = page.waitForRequest((request) => request.url().endsWith('/api/feedback'));
  await page.getByRole('button', { name: en.feedback.button, exact: true }).click();
  await page.getByLabel(en.feedback.message, { exact: true }).fill('A test of the branch header.');
  await page.getByRole('button', { name: en.feedback.send, exact: true }).click();
  expect((await sent).headers()['x-branch-id']).toBe(second);
});
