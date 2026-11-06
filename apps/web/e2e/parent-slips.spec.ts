import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Task 11.1, pull request #292 (`10`, Signing in; `edge/close-relatives`, first passwords): an
// Academic Vice Principal prints the slips of "7 Seeded", one per parent of its two students,
// then one parent signs in with the slip, chooses a password and lands in the portal (task
// 11.2), with no staff menu. All names are invented.
test('an Academic Vice Principal prints the parent slips of a class, and a parent signs in', async ({
  page,
}) => {
  const account = accountOf('parentSlips');
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

  // The class panel leads to the slips of its parents.
  await page.goto('/classes');
  await page
    .locator('tbody tr')
    .filter({ hasText: '7 Seeded' })
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('link', { name: en.people.parentSlips.open, exact: true }).click();
  await expect(heading(page, 'Parent slips: 7 Seeded')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Nigora Yoqubova' })).toContainText(
    en.people.parentSlips.to_print,
  );

  // One slip per parent of the class, in the language chosen.
  await page
    .getByRole('combobox', { name: en.people.parentSlips.language, exact: true })
    .selectOption('en');
  await page.getByRole('button', { name: en.people.parentSlips.printSlips, exact: true }).click();
  const sheet = page.getByRole('region', { name: '2 slips' });
  await expect(sheet).toBeVisible();
  const slip = sheet.locator('[data-slip]').filter({ hasText: 'Nigora Yoqubova' });
  const values = slip.locator('dd');
  const login = await values.nth(0).innerText();
  const password = await values.nth(1).innerText();
  expect(login).toMatch(/^n\.yoqubova[0-9]*$/);

  // Back to the list: listed with the slip, and nothing more to print.
  await page.getByRole('button', { name: en.people.parentSlips.back, exact: true }).click();
  await expect(rows.filter({ hasText: 'Nigora Yoqubova' })).toContainText(
    en.people.parentSlips.valid_slip,
  );

  // The parent signs in with the slip, in another browser.
  const parent = await page.context().browser()?.newPage();
  if (parent === undefined) throw new Error('No second page.');
  await parent.goto('/sign-in');
  await languageChooser(parent).selectOption('en');
  await signIn(parent, en, login, password);
  await changeFirstPassword(parent, en, { login, password });
  // Task 11.2: a parent lands on the portal, on the child's timetable.
  const child = parent.getByRole('combobox', { name: en.portal.child, exact: true });
  await expect(child).toBeVisible();
  await expect(child.locator('option:checked')).toHaveText('Laylo Yoqubova, 7 Seeded');
  await expect(parent.getByRole('navigation', { name: en.layout.menu })).toHaveCount(0);
  await parent.getByRole('link', { name: en.portal.account, exact: true }).click();
  await expect(heading(parent, en.parent.title)).toBeVisible();
  await expect(parent.getByText('Nigora Yoqubova')).toBeVisible();
  // A staff page sends the parent back to the portal.
  await parent.goto('/people/staff');
  await expect(child).toBeVisible();
  await parent.close();
});
