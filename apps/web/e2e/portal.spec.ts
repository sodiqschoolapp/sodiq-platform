import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, languageChooser, signIn } from './steps';

// Task 11.2, pull request #294 (`10`, What parents see; `12`, Devices: "Phone: ... the portal"):
// at phone width a mother of two children signs in, sees the first child's week, opens the
// homework, and switches to the other child. All names are invented.
test.use({ viewport: { width: 390, height: 844 } });

test('a parent opens the timetable and the homework of both children at phone width', async ({
  page,
}) => {
  const account = accountOf('portal');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);

  const child = page.getByRole('combobox', { name: en.portal.child, exact: true });
  await expect(child).toBeVisible();
  await expect(child.locator('option')).toHaveText([
    'Kamron Usmonov, 7 Seeded',
    'Nilufar Usmonova, 8 Seeded',
  ]);
  await expect(page).toHaveURL(/\/portal\/[0-9a-f-]+\/timetable$/);
  await expect(page.getByRole('button', { name: en.portal.thisWeek, exact: true })).toBeVisible();
  // No page wider than the phone.
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);

  await page.getByRole('link', { name: en.portal.homework.title, exact: true }).click();
  await expect(page).toHaveURL(/\/homework$/);
  await expect(page.getByText(en.portal.homework.empty, { exact: true })).toBeVisible();

  // The other child, on the same page; then its timetable.
  await child.selectOption({ label: 'Nilufar Usmonova, 8 Seeded' });
  await expect(child.locator('option:checked')).toHaveText('Nilufar Usmonova, 8 Seeded');
  await expect(page).toHaveURL(/\/homework$/);
  await page.getByRole('link', { name: en.portal.timetable.title, exact: true }).click();
  await expect(page).toHaveURL(/\/timetable$/);
  await expect(page.getByRole('button', { name: en.portal.nextWeek, exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: en.layout.menu })).toHaveCount(0);
});
