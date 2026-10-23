import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/07-journal.md, Opening a journal: "From the teacher's timetable:
// clicking a lesson opens the journal already scrolled sideways to that date";
// 06, Views and outputs: "Teacher home page: today's lessons as a list (...
// button to open the journal)"; 12, Speed targets: "Open a journal for a
// quarter: under 1 second" (task 6.2). The seeded journal of the "Journal
// browser test branch" holds a quarter of lessons with marks and a classwork.
// All names are invented.
test('a teacher opens the journal from today’s lesson on the home page and reads the grid', async ({
  page,
}, testInfo) => {
  const account = accountOf('journalTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  const today = page.locator('[data-home-today]');
  const open = today.getByRole('button', { name: en.journal.open, exact: true });
  await expect(open).toBeVisible();
  const started = Date.now();
  await open.click();
  await expect(heading(page, en.journal.sheet)).toBeVisible();
  const zokirova = page.locator('.ag-row').filter({ hasText: 'Zokirova Nodira' }).first();
  await expect(zokirova).toBeVisible();
  const opened = Date.now() - started;
  // Decision 18: the time is recorded for the report, not asserted (CI machines vary).
  testInfo.annotations.push({ type: 'journal-open-ms', description: String(opened) });

  await expect(page.locator('[data-journal-header]')).toContainText('7 Oxford · Geography');
  await expect(page.locator('[data-journal-header]')).toContainText('Teacher: Qodirov Sanjar');
  // The students in the one fixed order: A, Z, then oʻ after z.
  const names = page.locator('[row-id]:not([row-id="bottom"]) [col-id="name"]');
  await expect(names).toHaveText(['Abdullayeva Lola', 'Zokirova Nodira', 'Oʻktamov Bekzod']);
  // Figures from packages/calc in the pinned columns, and the bottom row.
  await expect(page.locator('[row-id="bottom"] [col-id="name"]')).toHaveText(
    en.journal.grid.classAverage,
  );
  await expect(page.locator('[data-journal-legend]')).toContainText(
    'Quarter result: attendance 20 · classwork 40 · homework 40',
  );

  // The student search, by another apostrophe.
  await page.getByLabel(en.journal.page.search, { exact: true }).fill("O'ktamov");
  await expect(names).toHaveText(['Oʻktamov Bekzod']);
  await page.getByLabel(en.journal.page.search, { exact: true }).fill('');

  // Task 8.1: the classwork of yesterday's lesson (seeded with a total of 10 and numbers):
  // its total changes to 20 after the confirmation, and a number typed in a cell shows its
  // percent from the server (07, The total).
  const work = page.getByRole('button', { name: /^Work: / }).last();
  await expect(work).toBeVisible();
  const column = await work.locator('xpath=ancestor::*[@col-id][1]').getAttribute('col-id');
  await work.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.journal.works.total, { exact: true }).fill('20');
  await dialog.getByRole('button', { name: en.journal.works.saveTotal, exact: true }).click();
  const question = page.getByRole('alertdialog');
  await expect(question).toContainText(en.journal.works.confirmTotalTitle);
  await question
    .getByRole('button', { name: en.journal.works.confirmTotalAction, exact: true })
    .click();
  await dialog.getByRole('button', { name: en.journal.entry.close, exact: true }).click();
  await expect(page.locator(`.ag-header-cell[col-id="${column ?? ''}"]`)).toContainText(
    `${en.journal.grid.soni} 20`,
  );
  const oktamov = await page
    .locator('.ag-row')
    .filter({ hasText: 'Oʻktamov Bekzod' })
    .first()
    .getAttribute('row-id');
  const cell = page.locator(`[row-id="${oktamov ?? ''}"] [col-id="${column ?? ''}"]`).last();
  await cell.click();
  await page.keyboard.type('15');
  await page.keyboard.press('Enter');
  await expect(cell).toContainText('15');
  await expect(cell).toContainText('75%');
  // The lesson has no plan item ("No plan"): a classwork is added by hand.
  const before = await page.getByRole('button', { name: /^Work: / }).count();
  await page.getByRole('button', { name: en.journal.works.button, exact: true }).last().click();
  const works = page.getByRole('dialog');
  await expect(works).toContainText(en.journal.works.noPlan);
  await works.getByRole('button', { name: en.journal.works.addClasswork, exact: true }).click();
  await works.getByRole('button', { name: en.journal.entry.close, exact: true }).click();
  await expect(page.getByRole('button', { name: /^Work: / })).toHaveCount(before + 1);

  // Lesson mode for today's lesson.
  await page
    .getByRole('radio', { name: en.journal.page.lessonMode, exact: true })
    .check({ force: true });
  await expect(page.locator('[data-lesson-mode] [data-student]')).toHaveCount(3);
});
