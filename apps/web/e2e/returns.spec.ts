import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/04-people.md, Movements, "Coming back": the student "is placed in
// a class from the return date"; edge/students-classes-groups, "A student
// returns": "Into another class: handled like a transfer"; 05, Language of
// instruction: moving between an Uzbek and a Russian class asks for
// confirmation. Task 3.3b, pull request #96. An Academic Vice Principal
// records a leaving of a student of 7 Oxford (Uzbek) with the day before
// yesterday as the last day, returns the student today into 7 Yale
// (Russian), confirms the language, and sees 7 Yale in the Academic block and
// the return on the History tab. All names are invented.
test('an Academic Vice Principal returns a student into a class of another language', async ({
  page,
}) => {
  const account = accountOf('returns');
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
  const today = tashkent(Date.now());
  const dayBeforeYesterday = tashkent(Date.now() - 2 * dayMs);

  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: 'Hamroyeva Muxlisa', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Muxlisa Hamroyeva' });

  // The leaving, its last day the day before yesterday: inactive since yesterday.
  await panel.getByRole('button', { name: texts.leaveTitle, exact: true }).click();
  const leaving = panel.getByRole('form', { name: texts.leaveTitle });
  await leaving.getByLabel(texts.lastDay, { exact: true }).fill(dayBeforeYesterday);
  await leaving.getByLabel(texts.reason, { exact: true }).fill('The family moved to Bukhara.');
  await leaving.getByRole('button', { name: en.form.save, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.leaveConfirmTitle })
    .getByRole('button', { name: texts.leaveAction, exact: true })
    .click();
  const row = page.locator('tbody tr').filter({ hasText: '9999941' });
  await expect(row).toContainText(texts.statuses.inactive);

  // Back today: the class left is offered first; 7 Yale is chosen instead.
  await panel.getByRole('button', { name: texts.returnTitle, exact: true }).click();
  const back = panel.getByRole('form', { name: texts.returnTitle });
  await back.getByLabel(texts.returnFrom, { exact: true }).fill(today);
  const classField = back.getByLabel(texts.class, { exact: true });
  await expect(classField.locator('option:checked')).toHaveText('7 Oxford');
  await classField.selectOption({ label: '7 Yale' });
  await back.getByLabel(texts.contractNumber, { exact: true }).fill('E2E-RETURN-1');
  await back.getByLabel(texts.contractSignedOn, { exact: true }).fill(today);
  await back.getByRole('button', { name: en.form.save, exact: true }).click();
  const confirmReturn = page.getByRole('alertdialog', { name: texts.returnConfirmTitle });
  await expect(confirmReturn.getByText('7 Yale', { exact: true })).toBeVisible();
  await confirmReturn.getByRole('button', { name: texts.returnTitle, exact: true }).click();
  // Another language than the class left: asked, naming both classes.
  const language = page.getByRole('alertdialog', { name: texts.returnLanguageTitle });
  await expect(language.getByText('7 Oxford', { exact: true })).toBeVisible();
  await expect(language.getByText('7 Yale', { exact: true })).toBeVisible();
  await language.getByRole('button', { name: texts.returnTitle, exact: true }).click();

  await expect(row).toContainText(texts.statuses.active);
  await expect(row).toContainText('7 Yale');
  await expect(panel.getByText('7 Yale').first()).toBeVisible();

  await panel
    .getByRole('radiogroup', { name: texts.tabs.label })
    .getByText(texts.tabs.history, { exact: true })
    .click();
  await expect(panel.getByText(/7 Yale/).first()).toBeVisible();
  await expect(panel.getByText(texts.causes.return).first()).toBeVisible();
});
