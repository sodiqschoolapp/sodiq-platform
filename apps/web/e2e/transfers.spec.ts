import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

async function signedIn(page: Page, key: 'transfersTeacher' | 'transfersVice') {
  const account = accountOf(key);
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  if (key === 'transfersVice') {
    // The role requires a second step at sign-in (task 0.7b): set up as audit.spec.ts does.
    await expect(heading(page, en.setUp.title)).toBeVisible();
    await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
    const secret = await page.locator('dd').innerText();
    await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(secret));
    await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
    await page.getByRole('checkbox', { name: en.setUp.saved }).check();
    await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  }
  await expect(heading(page, en.home.title)).toBeVisible();
}

/** The school date `days` ago in Tashkent, as the seed dates the lessons. */
function daysAgo(days: number): string {
  const tashkent = new Date(Date.now() + 5 * 3_600_000);
  return new Date(tashkent.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

// docs/spec/edge-cases/students-classes-groups.md, "A transfer is recorded a week late":
// "Entries in the old journals on or after the date are listed; he either moves the date past
// them or voids them with a reason ... In the new journal, cells of lessons already held open as
// optional"; docs/spec/07-journal.md, Transfers: "The new journal shows the carried-in averages
// with a marker" (task 8.6). The "Transfers browser test branch" holds 7 Kent and 7 Leeds, each
// with a journal of "Measures T"; Qodirova of 7 Kent is marked present in a Kent lesson five
// days ago, and 7 Leeds has a lesson four days ago. All names are invented.
test('the Academic Vice Principal records a late class move, voids the old journal entry, and the new journal shows the carried-in figures and the optional cell', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signedIn(page, 'transfersVice');
  const texts = en.people.students;
  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: 'Qodirova Dilfuza', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Dilfuza Qodirova' });
  await panel.getByRole('button', { name: texts.moves.moveClass, exact: true }).click();
  const form = panel.getByRole('form', { name: texts.moves.moveClass });
  await form.getByLabel(texts.moves.toClass, { exact: true }).selectOption({ label: '7 Leeds' });
  await form.getByLabel(texts.moves.from, { exact: true }).fill(daysAgo(6));
  await form.getByRole('button', { name: en.form.save, exact: true }).click();

  // The Kent entry is listed, with the first date past it, and voided with a reason.
  const dialog = page.getByRole('dialog', {
    name: texts.journalEntries.title_one.replace('{{count}}', '1'),
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('listitem').first()).toContainText('7 Kent');
  await dialog
    .getByLabel(texts.journalEntries.reason, { exact: true })
    .fill('Marked in the old class after the move');
  await dialog
    .getByRole('button', {
      name: texts.journalEntries.void_one.replace('{{count}}', '1'),
      exact: true,
    })
    .click();
  await expect(panel.getByText(/From 7 Kent,/)).toBeVisible();

  // The teacher opens 7 Leeds: the result is carried in from 7 Kent, the held lesson is optional.
  const context = await browser.newContext();
  const teacher = await context.newPage();
  await signedIn(teacher, 'transfersTeacher');
  await teacher.goto('/journal');
  await teacher
    .locator('tbody tr')
    .filter({ hasText: '7 Leeds' })
    .getByRole('button')
    .first()
    .click();
  await expect(heading(teacher, en.journal.sheet)).toBeVisible();
  const row = teacher.locator('.ag-row').filter({ hasText: 'Qodirova Dilfuza' });
  await expect(row.locator('[data-carried-in="true"]').first()).toBeVisible();
  await expect(row.locator('[data-marker="optional"]').first()).toBeVisible();
  await context.close();
});
