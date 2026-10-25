import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/07-journal.md, Lesson status: "Every lesson that has been held shows a status,
// on the teacher's home page, on the timetable and in the journal header. The home page sums
// it up"; "A present student left without a number keeps the lesson in progress; the teacher
// can set those cells to 'not graded' in one click, which completes the lesson" (task 8.7).
// The "Status browser test branch" holds one lesson today at 00:05 with a classwork of total
// 10 and two students. All names are invented.
test('a teacher completes today’s lesson with "Not graded", and the journal and the home page agree', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const account = accountOf('statusTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  const today = page.locator('[data-home-today]');
  await expect(today.locator('[data-home-summary]')).toHaveText('0 of 1 lesson complete');
  // The seeded total of the classwork is data on the lesson (edge/00-definitions): in progress.
  await expect(today.locator('[data-status]')).toHaveText(en.journal.lessonStatus.in_progress);
  await today.getByRole('button', { name: en.journal.open, exact: true }).click();
  await expect(heading(page, en.journal.sheet)).toBeVisible();

  // Both present, and a number for Alimov only.
  await page.getByRole('button', { name: en.journal.entry.allPresent, exact: true }).click();
  const marks = page.locator('[row-id]:not([row-id="bottom"]) [col-id$=":a"] [data-mark]');
  await expect(marks).toHaveText(['1', '1']);
  const work = page.getByRole('button', { name: /^Work: / }).first();
  const column = await work.locator('xpath=ancestor::*[@col-id][1]').getAttribute('col-id');
  const alimov = await page
    .locator('.ag-row')
    .filter({ hasText: 'Alimov Sardor' })
    .first()
    .getAttribute('row-id');
  const cell = page.locator(`[row-id="${alimov ?? ''}"] [col-id="${column ?? ''}"]`).last();
  await cell.click();
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  await expect(cell).toContainText('70%');
  const header = page
    .locator('.ag-header-group-cell')
    .filter({ hasText: en.journal.lessonStatus.in_progress });
  await expect(header).toHaveCount(1);

  // "Not graded" for Botirova's empty cell, from the works of the lesson.
  const lessonId = (column ?? '').split(':')[0] ?? '';
  const button = page
    .locator(`.ag-header-cell[col-id="${lessonId}:a"]`)
    .getByRole('button', { name: en.journal.card.open, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  // Task 8.8: the works of the lesson open from its lesson card.
  await page
    .getByRole('dialog')
    .getByRole('button', { name: en.journal.works.button, exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: en.journal.notGraded.button, exact: true })
    .click();
  const question = page.getByRole('alertdialog');
  await expect(question).toContainText('1 empty cell of a present student');
  await question
    .getByRole('button', { name: en.journal.notGraded.confirmAction, exact: true })
    .click();
  await expect(page.locator('[data-not-graded-notice]')).toContainText('1 cell set "not graded".');
  await expect(page.locator('[data-not-graded]')).toHaveCount(1);
  await expect(
    page.locator('.ag-header-group-cell').filter({ hasText: en.journal.lessonStatus.complete }),
  ).toHaveCount(1);

  // The home page sums it up the same way.
  await page.goto('/');
  await expect(page.locator('[data-home-today] [data-home-summary]')).toHaveText(
    '1 of 1 lesson complete',
  );
  await expect(page.locator('[data-home-today] [data-status]')).toHaveText(
    en.journal.lessonStatus.complete,
  );
});
