import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

/** The school days of the two weeks from the Monday after today in Tashkent. */
function schoolDaysAhead(): string[] {
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()),
  );
  const days = ((8 - today.getUTCDay()) % 7) + (today.getUTCDay() === 1 ? 7 : 0);
  const monday = today.getTime() + days * 24 * 60 * 60 * 1000;
  return [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((offset) =>
    new Date(monday + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
}

// docs/spec/06-timetable.md, Changes after publishing: "Substitution. The one
// way to put another teacher on a lesson. ... Teachers who cannot teach in
// the class's language are listed last and marked"; 05, Substitution:
// "Choosing one needs a confirmation". Task 5.7b-1, pull request #191. The
// vacancy fill's scene: 7 Oxford's Geometry is under "Geometry vacancy 2".
// The Academic Vice Principal publishes, substitutes the lesson with Aliyev
// (Russian only, so the language asks the tick), finds the lesson marked as
// a substitute for the vacancy, and withdraws the substitution. All names
// are invented.
test('an Academic Vice Principal substitutes a lesson of a vacancy and withdraws it', async ({
  page,
}) => {
  const account = accountOf('substitution');
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

  // Publish the draft from its default start.
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

  // The first school day with 7 Oxford's Geometry lesson.
  const day = en.timetable.day;
  await page.goto('/timetable/day');
  await expect(heading(page, day.title)).toBeVisible();
  const geometry = page.locator('tbody tr').filter({ hasText: 'Geometry' }).first();
  let lessonDate = '';
  for (const date of schoolDaysAhead()) {
    const answered = page.waitForResponse(
      (response) => response.url().includes('/api/timetable/day') && response.url().includes(date),
    );
    await page.getByLabel(day.date, { exact: true }).fill(date);
    await answered;
    await expect(page.locator('tbody tr').or(page.getByText(day.empty)).first()).toBeVisible();
    if ((await geometry.count()) > 0) {
      lessonDate = date;
      break;
    }
  }
  await expect(geometry).toContainText('Geometry vacancy 2');

  await geometry.getByRole('button', { name: day.substitute, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const field = dialog.getByLabel(day.substitute, { exact: true });
  const aliyev = await field.locator('option', { hasText: 'Aliyev Bekzod' }).getAttribute('value');
  expect(aliyev).not.toBeNull();
  await expect(field.locator('option', { hasText: 'Aliyev Bekzod' })).toContainText(
    day.substituteLanguage,
  );
  await field.selectOption(aliyev ?? '');
  await dialog.getByLabel(day.reason, { exact: true }).fill('The vacancy is not filled yet');
  await dialog.getByRole('button', { name: day.substituteSend, exact: true }).click();
  await expect(dialog.getByText(en.errors.substitution_needs_confirm)).toBeVisible();
  await expect(dialog.getByText(en.timetable.rule.substitute_language)).toBeVisible();
  await dialog.getByRole('checkbox', { name: day.substituteConfirm }).check();
  await dialog.getByRole('button', { name: day.substituteSend, exact: true }).click();
  // The message names the language warning after the saved line.
  await expect(page.getByRole('status').filter({ hasText: day.substituted })).toBeVisible();
  await expect(geometry).toContainText('Aliyev Bekzod');
  await expect(geometry).toContainText(day.substituteFor.replace('{{name}}', 'Geometry vacancy 2'));

  // Task 5.7b-3: the question before a withdraw of the version lists the
  // substitution as dropped (no version runs again over its dates); the
  // question is closed without withdrawing.
  await page.goto('/timetable/load');
  await page.getByRole('button', { name: en.timetable.load.withdraw, exact: true }).click();
  const question = page.getByRole('alertdialog');
  await expect(
    question.locator('[data-day-changes="dropped"] [data-kind="substitution"]'),
  ).toContainText('Aliyev Bekzod in place of Geometry vacancy 2');
  await question.getByRole('button', { name: en.confirm.cancel, exact: true }).click();
  await page.goto('/timetable/day');
  await expect(heading(page, day.title)).toBeVisible();
  const again = page.waitForResponse(
    (response) =>
      response.url().includes('/api/timetable/day') && response.url().includes(lessonDate),
  );
  await page.getByLabel(day.date, { exact: true }).fill(lessonDate);
  await again;
  await expect(geometry).toContainText('Aliyev Bekzod');

  await geometry.getByRole('button', { name: day.withdrawSubstitution, exact: true }).click();
  const withdrawing = page.getByRole('dialog');
  await withdrawing.getByLabel(day.reason, { exact: true }).fill('Another plan for the day');
  await withdrawing
    .getByRole('button', { name: day.withdrawSubstitutionSend, exact: true })
    .click();
  await expect(page.getByText(day.substitutionWithdrawn, { exact: true })).toBeVisible();
  await expect(geometry).toContainText('Geometry vacancy 2');
  await expect(geometry).not.toContainText('Aliyev Bekzod');
});
