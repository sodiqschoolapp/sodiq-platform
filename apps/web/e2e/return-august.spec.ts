import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// edge/students-classes-groups, "A student returns": a student can be brought
// back in August, dated the first day of the next planned year, and the return
// can be cancelled until its date. Task 3.6b-2, owner's answer L170. An
// Academic Vice Principal records a leaving of a student of 7 Oxford, returns
// the student on the first day of next year into 7 Cambridge, sees the student
// still inactive with the return planned, cancels it, and returns the student
// again. All names are invented.
test('a student is returned on the first day of next year, cancelled, and returned again', async ({
  page,
}) => {
  const account = accountOf('returnAugust');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.setUp.title)).toBeVisible();
  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  const key = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  const texts = en.people.students;
  const dayMs = 24 * 60 * 60 * 1000;
  const tashkent = (moment: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(moment);
  const dayBeforeYesterday = tashkent(Date.now() - 2 * dayMs);
  const today = tashkent(Date.now());

  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: 'Ergasheva Madina', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Madina Ergasheva' });
  const row = page.locator('tbody tr').filter({ hasText: '9999971' });

  // The leaving, its last day the day before yesterday.
  await panel.getByRole('button', { name: texts.leaveTitle, exact: true }).click();
  const leaving = panel.getByRole('form', { name: texts.leaveTitle });
  await leaving.getByLabel(texts.lastDay, { exact: true }).fill(dayBeforeYesterday);
  await leaving.getByLabel(texts.reason, { exact: true }).fill('The family moved to Bukhara.');
  await leaving.getByRole('button', { name: en.form.save, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.leaveConfirmTitle })
    .getByRole('button', { name: texts.leaveAction, exact: true })
    .click();
  await expect(row).toContainText(texts.statuses.inactive);

  // The return on the first day of next year, picked with the button the form offers.
  const giveBack = async (contract: string) => {
    await panel.getByRole('button', { name: texts.returnTitle, exact: true }).click();
    const back = panel.getByRole('form', { name: texts.returnTitle });
    await back.getByRole('button', { name: /^First day of next year/ }).click();
    await back.getByLabel(texts.class, { exact: true }).selectOption({ label: '7 Cambridge' });
    await back.getByLabel(texts.contractNumber, { exact: true }).fill(contract);
    await back.getByLabel(texts.contractSignedOn, { exact: true }).fill(today);
    await back.getByRole('button', { name: en.form.save, exact: true }).click();
    await page
      .getByRole('alertdialog', { name: texts.returnConfirmTitle })
      .getByRole('button', { name: texts.returnTitle, exact: true })
      .click();
  };
  await giveBack('E2E-AUGUST-1');

  // Still inactive until the date; the return can be cancelled, Return is gone.
  await expect(row).toContainText(texts.statuses.inactive);
  await expect(panel.getByRole('button', { name: texts.returnTitle, exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: texts.cancelReturn, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.cancelReturnConfirmTitle })
    .getByRole('button', { name: texts.cancelReturn, exact: true })
    .click();
  await expect(panel.getByRole('button', { name: texts.cancelReturn, exact: true })).toHaveCount(0);
  await expect(row).toContainText(texts.statuses.inactive);

  // Returned again after the cancel.
  await giveBack('E2E-AUGUST-2');
  await expect(panel.getByRole('button', { name: texts.cancelReturn, exact: true })).toBeVisible();
});
