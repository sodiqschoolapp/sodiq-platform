import { expect, test, type Locator } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

/**
 * The second Monday after today in Tashkent, as a school date: always after
 * the scene's version, which starts a week from today, so the fill publishes
 * from a Monday and has no transition week, whatever day the test runs.
 */
function fillMonday(): string {
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()),
  );
  const days = ((8 - today.getUTCDay()) % 7 || 7) + 7;
  return new Date(today.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// docs/spec/06-timetable.md, Changes after publishing, "Filling a vacancy":
// "a row with a blocked date stays with the vacancy and is listed, and the
// fill goes ahead for the rest ... A vacancy with no load left is closed."
// Task 5.7a-3b. The publishable grid scene with both Geometry rows under
// "Geometry vacancy 2" and 7 Princeton taught in Russian: the Academic Vice
// Principal publishes, fills the vacancy from its record with Aliyeva, who
// speaks Uzbek only (7 Princeton's row is left, the vacancy stays open), then
// with Aliyev (the vacancy is closed from that date), and finds both fills in
// the vacancy's history. All names are invented.
test('an Academic Vice Principal fills a vacancy, sees a row left, then fills the rest and the vacancy closes', async ({
  page,
}) => {
  const account = accountOf('vacancyFill');
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

  // Publish the draft from its default start, as the publish test does.
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

  const texts = en.people.vacancies.fill;
  const vacancy = 'Geometry vacancy 2';
  await page.goto('/people/vacancies');
  await expect(heading(page, en.people.vacancies.title)).toBeVisible();
  await page.getByRole('button', { name: vacancy, exact: true }).click();
  const panel = page.getByRole('complementary', { name: vacancy });

  const date = fillMonday();
  /** One fill from `date`, with the person named; answers the dialog. */
  const fillWith = async (person: string, check: (dialog: Locator) => Promise<void>) => {
    await panel.getByRole('button', { name: texts.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: texts.title.replace('{{name}}', vacancy) });
    await dialog.getByLabel(texts.person, { exact: true }).selectOption({ label: person });
    await dialog.getByLabel(texts.startsOn, { exact: true }).fill(date);
    await expect(dialog.locator('[data-fill-check]')).toBeVisible();
    await check(dialog);
    // From a Monday: no transition week to tick.
    await expect(dialog.getByRole('checkbox', { name: publish.transition.tick })).toHaveCount(0);
    await dialog.getByRole('button', { name: texts.action, exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: texts.action, exact: true })
      .click();
    await expect(dialog.locator('[data-fill-done]')).toBeVisible();
    return dialog;
  };

  // Aliyeva speaks Uzbek only: 7 Princeton's row stays, and so does the vacancy.
  const first = await fillWith('Aliyeva Zarina', async (dialog) => {
    await expect(dialog.locator('[data-rows-filled] li')).toHaveText([
      '7 Oxford, Geometry: goes to the person',
    ]);
    await expect(dialog.locator('[data-rows-left] li')).toHaveText([
      '7 Princeton, Geometry: the person does not teach this subject, grade or language',
    ]);
    // The row left is what keeps the vacancy open: no version or lesson is listed.
    await expect(dialog.locator('[data-closes]')).toHaveText(texts.staysOpen);
    await expect(dialog.locator('[data-holders]')).toHaveCount(0);
  });
  // The result names its rows (spec review of the code, must-fix 1).
  await expect(first.locator('[data-fill-done] li')).toHaveText([
    '7 Oxford, Geometry: goes to the person',
    '7 Princeton, Geometry: the person does not teach this subject, grade or language',
  ]);
  await expect(first.locator('[data-closed]')).toHaveText(texts.staysOpen);
  await first.getByRole('button', { name: texts.close, exact: true }).click();

  // Aliyev takes 7 Princeton's row, the last one: the vacancy is closed from the date.
  const second = await fillWith('Aliyev Bekzod', async (dialog) => {
    await expect(dialog.locator('[data-rows-filled] li')).toHaveText([
      '7 Princeton, Geometry: goes to the person',
    ]);
    await expect(dialog.locator('[data-closes]')).toHaveText(/^The vacancy will be closed from /);
  });
  await expect(second.locator('[data-fill-done] li')).toHaveText([
    '7 Princeton, Geometry: goes to the person',
  ]);
  await expect(second.locator('[data-closed]')).toHaveText(/^The vacancy is closed from /);
  await second.getByRole('button', { name: texts.close, exact: true }).click();

  // The record: the close planned from the date, and both fills.
  await expect(panel.locator('[data-vacancy-status]')).toHaveText(/^Open, closes on /);
  await expect(panel.getByRole('button', { name: texts.open, exact: true })).toHaveCount(0);
  const fills = panel.locator('[data-vacancy-fills] li');
  await expect(fills).toHaveCount(2);
  await expect(fills.nth(0)).toContainText('Aliyev Bekzod');
  await expect(fills.nth(0)).toContainText('7 Princeton, Geometry');
  await expect(fills.nth(1)).toContainText('Aliyeva Zarina');
  await expect(fills.nth(1)).toContainText('7 Oxford, Geometry');
});
