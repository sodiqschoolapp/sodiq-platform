import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/06-timetable.md, Building a timetable, step 8 ("Reads the impact
// preview, confirms or changes the start date, publishes"); Editing in the
// grid ("A draft with errors cannot be published"); task 5.5a-1, pull request
// #139. The grid scene with one lesson a week per row, each placed, four
// dated quarters and Geometry's distributions: the Academic Vice Principal
// confirms step 1, finds nothing that stops the publish in step 8, publishes
// after the confirmation and sees the version read only. Task 5.5a-2a: the
// teacher's later availability entry shows warnings by date that do not stop
// the publish. All names are invented.
test('an Academic Vice Principal publishes a draft from step 8 and sees it read only', async ({
  page,
}) => {
  const account = accountOf('draftPublish');
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

  const builder = en.timetable.builder;
  const texts = en.timetable.publish;
  await page.goto('/timetable/builder');
  await expect(heading(page, builder.title)).toBeVisible();
  await page.getByRole('button', { name: builder.confirm, exact: true }).click();
  await expect(page.getByText(builder.confirmed, { exact: true })).toBeVisible();

  await page.locator('[data-step="publish"] button').click();
  await expect(page.locator('[data-step="publish"]')).toContainText(builder.notPublished);
  await expect(page.locator('[data-can-publish]')).toHaveText(texts.nothingRefused);
  // Task 5.5a-2a: the teacher's later hours from quarter 3 are warnings by date.
  await expect(page.locator('li span[data-date]').first()).toContainText(
    en.timetable.rule.teacher_unavailable_later,
  );
  await page.getByRole('button', { name: texts.action, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Publish version 1?');
  await dialog.getByRole('button', { name: texts.action, exact: true }).click();

  await expect(page.locator('[data-published]')).toBeVisible();
  await expect(page.locator('[data-step="publish"]')).toContainText(
    en.timetable.load.statuses.published,
  );
  // Read only: the grid has no editing left.
  await page.locator('[data-step="grid"] button').click();
  await expect(page.locator('[data-board]')).toBeVisible();
  await expect(page.getByRole('button', { name: builder.confirm, exact: true })).toHaveCount(0);
});
