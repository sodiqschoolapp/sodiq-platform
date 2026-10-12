import { statSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/04-people.md, Teacher and staff record; task 2.2a. An Academic
// Vice Principal opens a teacher of the branch, changes the phone and gives
// the teacher a subject with its grades and a language of instruction (edge,
// Who can act); then (task 2.2b) gives the teacher hours on Monday, and adds
// and closes a vacancy in the section of its own (04, Availability, Vacancy). The Super Admin's create is proved by the API and page tests:
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

  // Task 2.2b: the hours of the branch, from today (the first entry).
  const hours = en.people.availability;
  await panel.getByRole('button', { name: hours.change, exact: true }).click();
  const week = panel.getByRole('form', {
    name: hours.changeOf.replace('{{name}}', 'Oybek Qoʻchqorov'),
  });
  await week.getByLabel('Monday', { exact: true }).fill('08:00–13:00');
  await week.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText('08:00–13:00', { exact: true })).toBeVisible();
  await expect(panel.getByText(hours.inForce, { exact: true })).toBeVisible();

  // A vacancy, in the section of its own, added and closed.
  const vacancies = en.people.vacancies;
  await page
    .getByRole('navigation', { name: en.people.sections })
    .getByRole('link', { name: vacancies.title, exact: true })
    .click();
  await expect(heading(page, vacancies.title)).toBeVisible();
  // On an empty list the button stands in the header and on the empty page.
  await page.getByRole('button', { name: vacancies.add, exact: true }).first().click();
  const added = page.getByRole('form', { name: vacancies.newTitle, exact: true });
  await added.getByLabel(vacancies.name, { exact: true }).fill('Geometry vacancy 1');
  await added.getByLabel(vacancies.department, { exact: true }).selectOption({ label: 'STEAM' });
  await added.getByLabel('Geometry', { exact: true }).check();
  await added
    .getByLabel(en.setup.subjects.grade.replace('{{grade}}', '8'), { exact: true })
    .check();
  await added.getByLabel(texts.languages.uz, { exact: true }).check();
  await added.getByRole('button', { name: en.form.save, exact: true }).click();
  const vacancyRow = page.getByRole('row').filter({ hasText: 'Geometry vacancy 1' });
  await expect(vacancyRow).toContainText(vacancies.statuses.open);
  await vacancyRow.getByRole('button', { name: 'Geometry vacancy 1' }).click();
  const vacancyPanel = page.getByRole('complementary', { name: 'Geometry vacancy 1' });
  await vacancyPanel.getByRole('button', { name: vacancies.close, exact: true }).click();
  await expect(vacancyRow).toContainText(vacancies.statuses.closed);
});

// Task 2.2c-1: the Export button of the staff list. The Academic Vice
// Principal searches the list and exports it; the browser saves an Excel file
// named with the list and today. What the file holds, and what each role may
// export, is proved by the API tests, which read the file back. All names are
// invented.
test('an Academic Vice Principal exports the staff list of the branch', async ({ page }) => {
  const account = accountOf('staffExport');
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

  await page.goto('/people/staff');
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  await page.getByRole('searchbox', { name: en.list.search }).fill('Qoʻchqorov');
  await expect(page.locator('tbody tr')).toHaveCount(1);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en.list.export, exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Staff-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(statSync(await file.path()).size).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
