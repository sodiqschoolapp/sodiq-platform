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

  // Lesson mode for today's lesson.
  await page
    .getByRole('radio', { name: en.journal.page.lessonMode, exact: true })
    .check({ force: true });
  await expect(page.locator('[data-lesson-mode] [data-student]')).toHaveCount(3);
});
