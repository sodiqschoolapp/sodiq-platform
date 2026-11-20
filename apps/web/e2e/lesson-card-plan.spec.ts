import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { currentPage, changeFirstPassword, heading, languageChooser, signIn } from './steps';

// The owner, 20 November 2026: the lesson is edited in the journal in one lesson editor, its
// topic and its works written into the lesson's plan item (before: the lesson card opened the plan's
// form, task 10.8). The "Lesson card plan browser test branch" holds a lesson yesterday ("Map
// scales") and one today at 00:05 with no plan item. All names are invented.
test('the teacher writes the topic and gives a homework in the lesson editor and finds both in the plan', async ({
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
  await expect(currentPage(page)).toHaveText(en.journal.sheet);
  const journalId = /\/journal\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? '';
  expect(journalId).not.toBe('');

  // Today's lesson: its row has no item yet.
  const today = await page.locator('.ag-header-cell[col-id$=":a"]').last().getAttribute('col-id');
  await page
    .locator(`.ag-header-cell[col-id="${today ?? ''}"]`)
    .getByRole('button', { name: en.journal.card.open, exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.journal.card.topic, { exact: true }).fill('Scale bars');
  await dialog.getByRole('button', { name: en.journal.editor.saveTopic, exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: en.journal.editor.saveTopic, exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: en.journal.editor.addHomework, exact: true }).click();
  await dialog
    .getByLabel(en.journal.works.homeworkTitle, { exact: true })
    .fill('Measure the route');
  await dialog.getByRole('button', { name: en.journal.works.add, exact: true }).click();
  await expect(dialog.locator('[data-editor-given]')).toContainText('Measure the route');
  await dialog.getByRole('button', { name: en.journal.entry.close, exact: true }).click();

  // The plan holds the same item: its topic and the homework.
  await page.goto(`/plans/${journalId}`);
  const row = page.locator('tbody tr').filter({ hasText: 'Scale bars' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button').first().click();
  const panel = page.getByRole('complementary', { name: 'Row' });
  // The work added in the journal is marked so in the row ("· added in the journal").
  const homework = panel.locator('li').filter({ hasText: 'Measure the route' });
  await expect(homework).toHaveCount(1);
  await expect(homework).toContainText(en.plans.plan.addedInJournal);
});
