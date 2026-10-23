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

// docs/spec/09-lesson-plans.md, Editing after the window: "The teacher sends an
// edit request ... The Head Teacher of the subject in that branch approves or
// refuses it ... the approver sets how many days the chosen lessons stay open"
// (task 7.2). The "Plan requests browser test branch" holds 7 Harvard with two
// lessons of Planning B; the window of quarter 1 ended yesterday. All names are
// invented.
test('after the window the teacher asks to edit, the Head Teacher approves, and the row opens', async ({
  page,
  browser,
}) => {
  const teacher = accountOf('requestsTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, teacher.login, teacher.password);
  await changeFirstPassword(page, en, teacher);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/plans');
  const line = page.locator('tbody tr').filter({ hasText: '7 Harvard' });
  await expect(line).toContainText(en.plans.flag.overdue);
  await line.getByRole('button').first().click();
  await expect(heading(page, '7 Harvard · Planning B')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).getByRole('button').first().click();
  await expect(page.getByRole('button', { name: en.plans.panel.fill })).toHaveCount(0);

  await page.getByRole('button', { name: en.plans.requests.ask }).click();
  const ask = page.getByRole('form', { name: en.plans.requests.askTitle });
  await ask.getByRole('combobox', { name: en.plans.requests.kindLabel }).selectOption('replan');
  await ask.getByRole('textbox', { name: en.plans.requests.reasonLabel }).fill('New teacher notes');
  await ask.getByRole('button', { name: en.plans.requests.send }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator('[data-plan-request]')).toContainText(en.plans.requests.status.sent);

  const other = await browser.newContext();
  const headPage = await other.newPage();
  const head = accountOf('requestsHead');
  await headPage.goto('/sign-in');
  await languageChooser(headPage).selectOption('en');
  await signIn(headPage, en, head.login, head.password);
  await changeFirstPassword(headPage, en, head);
  await headPage.goto('/plans/requests');
  await expect(heading(headPage, en.plans.requests.pageTitle)).toBeVisible();
  await headPage
    .locator('tbody tr')
    .filter({ hasText: '7 Harvard' })
    .getByRole('button')
    .first()
    .click();
  await headPage.getByRole('button', { name: en.plans.requests.decide }).click();
  const decide = headPage.getByRole('form', { name: en.plans.requests.decideTitle });
  await decide.getByRole('textbox', { name: en.plans.requests.daysLabel }).fill('2');
  await decide.getByRole('button', { name: en.plans.requests.approve }).click();
  await expect(decide).toHaveCount(0);
  await other.close();

  await page.reload();
  await rows.nth(0).getByRole('button').first().click();
  await page.getByRole('button', { name: en.plans.panel.fill }).click();
  const form = page.getByRole('form', { name: 'Row 1' });
  await form.getByRole('textbox', { name: en.plans.plan.topic }).fill('Pie charts');
  await form.getByRole('button', { name: en.form.save }).click();
  await expect(rows.nth(0)).toContainText('Pie charts');
});
