import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/09-lesson-plans.md, In the journal: "The lesson card is a second way into the plan
// item of its lesson. The plan's owner can change the topic ... and the works there"; What a plan
// contains: a homework "can carry its own files", attached "while a row is being written" (task
// 10.8, Done when: "a browser test adds a homework with a file from the lesson card and sees it in
// the plan"). The "Lesson card plan browser test branch" holds a lesson yesterday ("Map scales")
// and one today at 00:05 with no plan item, and the plan window is open. All names are invented.
test('the owner adds a homework with a file from the lesson card and finds both in the plan', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const account = accountOf('cardPlanTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page
    .locator('[data-home-today]')
    .getByRole('button', { name: en.journal.open, exact: true })
    .click();
  await expect(heading(page, en.journal.sheet)).toBeVisible();
  const journalId = /\/journal\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? '';
  expect(journalId).not.toBe('');

  // Today's lesson card: its row has no item yet, and the window is open for its owner.
  const today = await page.locator('.ag-header-cell[col-id$=":a"]').last().getAttribute('col-id');
  await page
    .locator(`.ag-header-cell[col-id="${today ?? ''}"]`)
    .getByRole('button', { name: en.journal.card.open, exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: en.journal.card.editPlan, exact: true }).click();
  await dialog.getByLabel(en.plans.plan.topic, { exact: true }).fill('Scale bars');
  await dialog.getByRole('button', { name: en.plans.panel.addHomework, exact: true }).click();
  await dialog.getByLabel('Homework 1', { exact: true }).fill('Measure the route');
  await dialog
    .getByLabel(en.plans.files.attachTo.replace('{{name}}', 'Measure the route'), { exact: true })
    .setInputFiles({
      name: 'route.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]),
    });
  await expect(dialog.getByText(en.plans.files.pending)).toBeVisible();
  await dialog.getByRole('button', { name: en.form.save, exact: true }).click();

  // The card shows the topic, the homework given today and its file.
  await expect(dialog.locator('[data-card-topic]')).toHaveText('Scale bars');
  const given = dialog.locator('[data-given-today]');
  await expect(given).toContainText('Measure the route');
  await expect(given.getByRole('button', { name: 'route.pdf', exact: true })).toBeVisible();
  await expect(dialog.getByText(en.plans.files.notUploaded)).toHaveCount(0);
  await dialog.getByRole('button', { name: en.journal.entry.close, exact: true }).click();

  // The plan holds the same item: its topic, the homework and the file under it.
  await page.goto(`/plans/${journalId}`);
  const row = page.locator('tbody tr').filter({ hasText: 'Scale bars' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button').first().click();
  const panel = page.getByRole('complementary', { name: 'Row' });
  await expect(panel.getByText('Measure the route', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'route.pdf', exact: true })).toBeVisible();
});
