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
  // Kamron's Biology, every day of the seeded fortnight, at 08:00.
  await expect(page.getByText('Biology').first()).toBeVisible();
  await expect(page.getByText('08:00–08:45').first()).toBeVisible();
  // No page wider than the phone.
  const wide = await page.evaluate<boolean>(
    '(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)()',
  );
  expect(wide).toBe(false);

  await page.getByRole('link', { name: en.portal.homework.title, exact: true }).click();
  await expect(page).toHaveURL(/\/homework$/);
  // The homework given two days ago: this week, or the week before on a Monday or Tuesday.
  const homework = page.getByText('Read pages 20 to 24', { exact: true });
  await expect(
    homework.or(page.getByText(en.portal.homework.empty, { exact: true })),
  ).toBeVisible();
  if (!(await homework.isVisible())) {
    await page.getByRole('button', { name: en.portal.previousWeek, exact: true }).click();
  }
  await expect(homework).toBeVisible();

  // The other child, on the same page; then its timetable.
  await child.selectOption({ label: 'Nilufar Usmonova, 8 Seeded' });
  await expect(child.locator('option:checked')).toHaveText('Nilufar Usmonova, 8 Seeded');
  await expect(page).toHaveURL(/\/homework$/);
  await page.getByRole('link', { name: en.portal.timetable.title, exact: true }).click();
  await expect(page).toHaveURL(/\/timetable$/);
  // Nilufar's class has no lesson: her week shows none of Kamron's.
  await expect(page.getByRole('button', { name: en.portal.nextWeek, exact: true })).toBeVisible();
  await expect(page.getByText('Biology')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: en.layout.menu })).toHaveCount(0);
});
