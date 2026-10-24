import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

async function signedIn(page: Page, key: 'exemptionsTeacher' | 'exemptionsVice') {
  const account = accountOf(key);
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  if (key === 'exemptionsVice') {
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

/** The school date five days ago in Tashkent, as the seed dates the lesson. */
function lessonDay(): string {
  const tashkent = new Date(Date.now() + 5 * 3_600_000);
  return new Date(tashkent.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
}

// docs/spec/07-journal.md, Exemptions, Problem cases: "The exemption is entered after the fact
// ... Each lesson with a 'present' or 'late' mark, or any number, needs a choice by the Academic
// Vice Principal"; docs/spec/edge-cases/exemptions.md, row 5: "The change is made by the Academic
// Vice Principal through the lock" (task 8.5). The "Exemptions browser test branch" holds a class
// of three students with one locked lesson five days ago in which Alimova is marked present. All
// names are invented.
test('the Academic Vice Principal enters a late exemption over a locked lesson, chooses "Exempt and clear", and the teacher sees 4', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signedIn(page, 'exemptionsVice');
  await page.goto('/journal/exemptions');
  await expect(heading(page, en.journal.exemptions.title)).toBeVisible();
  await page.getByRole('button', { name: en.journal.exemptions.new, exact: true }).click();
  const form = page.getByRole('form', { name: en.journal.exemptions.new });
  await form
    .getByRole('combobox', { name: en.journal.exemptions.class, exact: true })
    .selectOption({ label: '7 Kent' });
  await form.getByRole('checkbox', { name: 'Alimova Sevara' }).check();
  const day = lessonDay();
  await form.getByLabel(en.journal.exemptions.startDate, { exact: true }).fill(day);
  await form.getByLabel(en.journal.exemptions.endDate, { exact: true }).fill(day);
  await form
    .getByLabel(en.journal.exemptions.detail, { exact: true })
    .fill('A certificate from the clinic');
  await form.getByRole('button', { name: en.journal.exemptions.check, exact: true }).click();
  await form
    .getByRole('radio', { name: en.journal.exemptions.choice.exempt, exact: true })
    .check();
  await form.getByRole('button', { name: en.journal.exemptions.save, exact: true }).click();
  await expect(page.getByText(en.journal.exemptions.created)).toBeVisible();

  const context = await browser.newContext();
  const teacher = await context.newPage();
  await signedIn(teacher, 'exemptionsTeacher');
  await teacher.goto('/journal');
  await teacher
    .locator('tbody tr')
    .filter({ hasText: '7 Kent' })
    .getByRole('button')
    .first()
    .click();
  await expect(heading(teacher, en.journal.sheet)).toBeVisible();
  // Every lesson on screen is exempt: Alimova is in the folded "Exempt" section.
  await teacher.getByRole('button', { name: 'Exempt: 1 student' }).click();
  const cell = teacher
    .locator('.ag-row')
    .filter({ hasText: 'Alimova Sevara' })
    .first()
    .locator('[col-id$=":a"]')
    .last();
  await expect(cell.locator('[data-exempt="temporary"]')).toHaveText('4');
  await context.close();
});
