import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/09-lesson-plans.md, What a plan contains: "The form shows one row for
// every dated lesson of the quarter, with number and date already filled; the
// teacher fills in the rest" (task 7.1a). The "Plans browser test branch" holds
// 7 Harvard with two lessons of Planning, tomorrow and in eight days. All names
// are invented.
test('the teacher fills the two rows of a plan, and they stay on the dates of the lessons', async ({
  page,
}) => {
  const account = accountOf('plansTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/plans');
  await expect(heading(page, en.plans.page.title)).toBeVisible();
  await page
    .locator('tbody tr')
    .filter({ hasText: '7 Harvard' })
    .getByRole('button')
    .first()
    .click();
  await expect(heading(page, '7 Harvard · Planning')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);

  for (const [index, topic] of [
    [0, 'Collecting data'],
    [1, 'Bar charts'],
  ] as const) {
    await rows.nth(index).getByRole('button').first().click();
    await page.getByRole('button', { name: en.plans.panel.fill }).click();
    const form = page.getByRole('form', { name: `Row ${String(index + 1)}` });
    await form.getByRole('textbox', { name: en.plans.plan.topic }).fill(topic);
    await form.getByRole('button', { name: en.plans.panel.addClasswork }).click();
    await form.getByRole('textbox', { name: 'Classwork 1' }).fill(`Survey ${String(index + 1)}`);
    await form.getByRole('button', { name: en.form.save }).click();
    await expect(rows.nth(index)).toContainText(topic);
  }

  await page.reload();
  await expect(rows.nth(0)).toContainText('Collecting data');
  await expect(rows.nth(0)).toContainText('Survey 1');
  await expect(rows.nth(1)).toContainText('Bar charts');
  await page.goto('/plans');
  await expect(page.locator('tbody tr').filter({ hasText: '7 Harvard' })).toContainText(
    en.plans.state.complete,
  );
});
