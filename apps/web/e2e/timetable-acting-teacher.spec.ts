import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// edge/timetable, After publishing, "A vacancy lasts a quarter: who writes
// the plan and grades?": "The Academic Vice Principal names an acting teacher
// for the journal for a period". Task 5.7a-3c. The vacancy fill's scene: both
// Geometry rows under "Geometry vacancy 2". The Academic Vice Principal
// publishes, which opens the journals, names Aliyeva the acting teacher of
// 7 Oxford's Geometry journal from the vacancy's record, and finds the period
// there, with 7 Princeton's journal still without a teacher. All names are
// invented.
test('an Academic Vice Principal names an acting teacher for a journal of a vacancy', async ({
  page,
}) => {
  const account = accountOf('actingTeacher');
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

  // Publish the draft from its default start: the journals open.
  const builder = en.timetable.builder;
  const publish = en.timetable.publish;
  await page.goto('/timetable/builder');
  await expect(heading(page, builder.title)).toBeVisible();
  await page.getByRole('button', { name: builder.confirm, exact: true }).click();
  await expect(page.getByText(builder.confirmed, { exact: true })).toBeVisible();
  await page.locator('[data-step="publish"] button').click();
  await expect(page.locator('[data-can-publish]')).toHaveText(publish.nothingRefused);
  await page.getByRole('button', { name: publish.action, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: publish.action, exact: true })
    .click();
  await expect(page.locator('[data-published]')).toBeVisible();

  const texts = en.people.vacancies.acting;
  const vacancy = 'Geometry vacancy 2';
  await page.goto('/people/vacancies');
  await expect(heading(page, en.people.vacancies.title)).toBeVisible();
  await page.getByRole('button', { name: vacancy, exact: true }).click();
  const panel = page.getByRole('complementary', { name: vacancy });
  const section = panel.locator('[data-vacancy-acting]');
  await expect(section.locator('[data-acting-journal]')).toHaveCount(2);

  await section.getByRole('button', { name: texts.open, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: texts.dialogTitle.replace('{{name}}', vacancy) });
  await dialog
    .getByLabel(texts.journal, { exact: true })
    .selectOption({ label: '7 Oxford, Geometry' });
  await dialog.getByLabel(texts.person, { exact: true }).selectOption({ label: 'Aliyeva Zarina' });
  // The first day defaults to the journal's first day under the vacancy.
  const name = dialog.getByRole('button', { name: texts.name, exact: true });
  await expect(name).toBeEnabled();
  await name.click();
  await expect(dialog).toHaveCount(0);

  const journals = section.locator('[data-acting-journal]');
  const oxford = journals.filter({ hasText: '7 Oxford, Geometry' });
  await expect(oxford.locator('[data-acting-period] > span')).toHaveText(
    /^Aliyeva Zarina, from .+, open-ended, (planned|in force)$/,
  );
  await expect(journals.filter({ hasText: '7 Princeton, Geometry' })).toContainText(
    texts.noTeacher,
  );
});
