import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, NEW_PASSWORD } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

async function signedIn(page: Page, key: 'attendanceTeacher' | 'attendanceTutor') {
  const account = accountOf(key);
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();
}

// docs/spec/07-journal.md, Entering data: "'All present' marks 1 for every
// student who is not yet marked ... the teacher then types the exceptions";
// docs/spec/edge-cases/journal.md, "A Tutor records why a student was absent"
// (task 6.3). The "Attendance browser test branch" holds a class of three
// students with one lesson yesterday at 08:00 and the class's Tutor. All names
// are invented.
test('a teacher marks all present and an absence, and the Tutor records its reason', async ({
  page,
  browser,
}) => {
  await signedIn(page, 'attendanceTeacher');
  await page.goto('/journal');
  await page
    .locator('tbody tr')
    .filter({ hasText: '7 Cambridge' })
    .getByRole('button')
    .first()
    .click();
  await expect(heading(page, en.journal.sheet)).toBeVisible();
  await expect(
    page.locator('.ag-row').filter({ hasText: 'Ergasheva Kamola' }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: en.journal.entry.allPresent, exact: true }).click();
  await expect(page.locator('[data-all-present]')).toContainText('3 students marked present.');
  const marks = page.locator('[row-id]:not([row-id="bottom"]) [col-id$=":a"] [data-mark]');
  await expect(marks).toHaveText(['1', '1', '1']);

  // The exception: Toshmatov is absent from school (0), typed in his A cell.
  const toshmatov = page
    .locator('.ag-row')
    .filter({ hasText: 'Toshmatov Jasur' })
    .first()
    .locator('[col-id$=":a"]')
    .last();
  await toshmatov.click();
  await page.keyboard.press('0');
  await expect(toshmatov.locator('[data-mark]')).toHaveText('0');
  await expect(toshmatov.locator('[data-saved]')).toBeVisible();

  // The Tutor of the class, in a browser of their own.
  const context = await browser.newContext();
  const tutor = await context.newPage();
  await signedIn(tutor, 'attendanceTutor');
  // Yesterday and today in branch time: the seeded lesson was yesterday.
  const day = (offset: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(
      Date.now() + offset * 86_400_000,
    );
  await tutor.goto(`/journal/student-absences?from=${day(-1)}&to=${day(0)}`);
  await expect(heading(tutor, en.journal.absences.title)).toBeVisible();
  const row = tutor.locator('tbody tr').filter({ hasText: 'Toshmatov' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(en.journal.absences.none);
  await row.getByRole('button', { name: /Toshmatov/ }).click();
  await tutor.getByRole('button', { name: en.journal.absences.setReason, exact: true }).click();
  const form = tutor.getByRole('form', { name: en.journal.absences.setReason, exact: true });
  await form
    .getByRole('combobox', { name: en.journal.absences.category, exact: true })
    .selectOption('illness');
  await form.getByRole('textbox', { name: en.journal.absences.note, exact: true }).fill('Fever');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(row).toContainText(en.journal.absences.categories.illness);
  await expect(row).toContainText('Fever');
  await context.close();

  // The teacher sees the category on the 0, never the note.
  await page.reload();
  await expect(toshmatov.locator('[data-reason="illness"]')).toBeVisible();
  await expect(page.getByText('Fever')).toHaveCount(0);

  // Task 8.3a, the Done when: two saves of one cell from two sessions. The same teacher on a
  // second device saves Toshmatov's cell first; this page, read before, types on the old
  // version, is told and sees both values (edge/journal, Saving and working together).
  const second = await browser.newContext();
  const phone = await second.newPage();
  await phone.goto('/sign-in');
  await languageChooser(phone).selectOption('en');
  await signIn(phone, en, accountOf('attendanceTeacher').login, NEW_PASSWORD);
  await expect(heading(phone, en.home.title)).toBeVisible();
  await phone.goto(page.url());
  const phoneCell = phone
    .locator('.ag-row')
    .filter({ hasText: 'Toshmatov Jasur' })
    .first()
    .locator('[col-id$=":a"]')
    .last();
  await phoneCell.click();
  await phone.keyboard.press('2');
  await expect(phoneCell.locator('[data-save-state="saved"]')).toBeVisible();
  await second.close();

  await toshmatov.click();
  await page.keyboard.press('3');
  const dialog = page.getByRole('dialog', { name: en.journal.saving.staleTitle });
  await expect(dialog.locator('[data-stale-stored]')).toContainText('2 (Late)');
  await expect(dialog.locator('[data-stale-mine]')).toContainText('3 (');
  await dialog.getByRole('button', { name: en.journal.saving.useMine, exact: true }).click();
  await expect(toshmatov.locator('[data-mark]')).toHaveText('3');
  await expect(toshmatov.locator('[data-save-state="saved"]')).toBeVisible();
});
