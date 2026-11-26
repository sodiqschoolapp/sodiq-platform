import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { currentPage, changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/07-journal.md, Homework column: "A homework is graded at the lesson where it was
// given (owner, 25 November 2026). Each homework of a lesson's plan item is a homework column of
// that lesson ... No other lesson has a column for it." docs/spec/09-lesson-plans.md, In the
// journal: "The lesson card lists the homeworks of this lesson's plan item, which are this
// lesson's homework columns." (task 11.24, Done when; task 8.8 before it.)
// The "Plans in the journal browser test branch" holds a lesson yesterday and one today at
// 00:05, with the homework "Read the map" given yesterday. All names are invented.
test('a homework is a column of the lesson where it was given: listed once on its card, added, typed and saved there', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const account = accountOf('deliveryTeacher');
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

  // The header shows the number and topic of yesterday's lesson; its homework is its own column.
  const yesterday = page
    .locator('.ag-header-group-cell')
    .filter({ hasText: 'No. 1 · Contour lines' });
  await expect(yesterday).toHaveCount(1);
  const firstLesson = await page
    .locator('.ag-header-cell[col-id$=":a"]')
    .first()
    .getAttribute('col-id');
  const lessonId = (firstLesson ?? '').split(':')[0] ?? '';
  expect(lessonId).not.toBe('');
  const read = page.getByRole('button', { name: 'Work: Read the map' });
  await expect(read).toHaveCount(1);
  const readColumn = await read.locator('xpath=ancestor::*[@col-id][1]').getAttribute('col-id');
  expect(readColumn?.startsWith(`${lessonId}:`)).toBe(true);

  // Yesterday's lesson in the lesson editor: one Homework section, which holds the homework.
  const card = page
    .locator(`.ag-header-cell[col-id="${firstLesson ?? ''}"]`)
    .getByRole('button', { name: en.journal.card.open, exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(en.journal.card.topic, { exact: true })).toHaveValue(
    'Contour lines',
  );
  const homework = dialog.getByRole('region', { name: en.journal.card.homeworks, exact: true });
  await expect(homework).toHaveCount(1);
  await expect(homework).toContainText('Read the map');
  await expect(dialog.getByText('Homework checked today')).toHaveCount(0);

  // A homework added here, with its total, is a column of this lesson.
  await homework.getByRole('button', { name: en.journal.editor.addHomework, exact: true }).click();
  await dialog.getByLabel(en.journal.works.homeworkTitle, { exact: true }).fill('Draw the river');
  await dialog.getByRole('button', { name: en.journal.works.add, exact: true }).click();
  await expect(homework).toContainText('Draw the river');
  const total = dialog.getByLabel(en.journal.editor.totalOf.replace('{{name}}', 'Draw the river'), {
    exact: true,
  });
  await total.fill('10');
  await total.press('Enter');
  await dialog.getByRole('button', { name: en.journal.entry.close, exact: true }).click();

  // The header of the new column; its col-id names the stored work once the total made its row
  // (before, the plan work), so it is read after the total shows.
  const header = page.locator('.ag-header-cell').filter({
    has: page.getByRole('button', { name: /^Work: Draw the river/ }),
  });
  await expect(header).toHaveCount(1);
  await expect(header).toContainText(en.journal.grid.total.replace('{{total}}', '10'));
  const column = await header.getAttribute('col-id');
  expect(column?.startsWith(`${lessonId}:`)).toBe(true);

  // A number typed in that column is saved at that lesson, with its percent from the server.
  const student = await page
    .locator('[row-id]:not([row-id="bottom"])')
    .first()
    .getAttribute('row-id');
  const cell = page.locator(`[row-id="${student ?? ''}"] [col-id="${column ?? ''}"]`).last();
  await cell.click();
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  await expect(cell).toContainText('8');
  await expect(cell).toContainText('80%');

  // After a reload the number is still there: it was saved, at this lesson.
  await page.reload();
  await expect(currentPage(page)).toHaveText(en.journal.sheet);
  await expect(
    page.locator(`[row-id="${student ?? ''}"] [col-id="${column ?? ''}"]`).last(),
  ).toContainText('80%');
});
