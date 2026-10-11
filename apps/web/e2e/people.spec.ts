import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/04-people.md, Teacher and staff record; task 2.2a. An Academic
// Vice Principal opens a teacher of the branch, changes the phone and gives
// the teacher a subject with its grades and a language of instruction (edge,
// Who can act). The Super Admin's create is proved by the API and page tests:
// no fourth Super Admin can be seeded. All names are invented.
test('an Academic Vice Principal gives a teacher of the branch a subject', async ({ page }) => {
  const account = accountOf('staff');
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

  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.people) })
    .click();
  await expect(heading(page, en.people.title)).toBeVisible();
  await page.getByRole('link', { name: en.people.staffLink, exact: true }).click();
  await expect(heading(page, en.people.staff.title)).toBeVisible();

  const texts = en.people.staff;
  // The Academic Vice Principal does not add people.
  await expect(page.getByRole('button', { name: texts.add, exact: true })).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: 'Qoʻchqorov' });
  await expect(row).toContainText('S-269001');
  await expect(row).toContainText(texts.statuses.active);

  await row.getByRole('button', { name: 'Oybek Qoʻchqorov' }).click();
  const panel = page.getByRole('complementary', { name: 'Oybek Qoʻchqorov' });
  const record = panel.getByRole('form', { name: 'Oybek Qoʻchqorov', exact: true });
  await expect(record.getByLabel(texts.sex, { exact: true })).toBeDisabled();
  await record.getByLabel(texts.phone, { exact: true }).fill('+998 93 555 44 34');
  await record.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(row).toContainText('+998935554434');

  const teaching = panel.getByRole('form', {
    name: texts.teachingOf.replace('{{name}}', 'Oybek Qoʻchqorov'),
  });
  await teaching.getByLabel('Geometry', { exact: true }).check();
  await teaching
    .getByLabel(en.setup.subjects.grade.replace('{{grade}}', '8'), { exact: true })
    .check();
  await teaching.getByLabel(texts.languages.uz, { exact: true }).check();
  await teaching.getByRole('button', { name: en.form.save, exact: true }).click();

  await expect(row).toContainText('Geometry');
  await expect(row).toContainText(en.setup.subjects.grade.replace('{{grade}}', '8'));
});
