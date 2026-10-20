import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

/** The Mondays from the one after today in Tashkent, as school dates. */
function mondaysAhead(count: number): string[] {
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()),
  );
  const days = ((8 - today.getUTCDay()) % 7) + (today.getUTCDay() === 1 ? 7 : 0);
  return Array.from({ length: count }, (_, index) => {
    const monday = new Date(today.getTime() + (days + index * 7) * 24 * 60 * 60 * 1000);
    return monday.toISOString().slice(0, 10);
  });
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// docs/spec/06-timetable.md, Teachers who work in several branches: "An
// absence is entered once for the person and covers every branch";
// edge/timetable, After publishing: "All lessons in the range go to 'needs a
// teacher'. ... Shortening the absence returns future lessons to the
// teacher." Task 5.7a-1, pull request #185. The publishable grid scene: the
// Academic Vice Principal publishes, enters an absence of the scene's teacher
// from the next Monday, finds her lessons under "Lessons that need a teacher"
// on the home page, then moves the absence to a Sunday, when she has none, and
// the list is gone. All names are invented.
test('an Academic Vice Principal enters an absence, sees its lessons need a teacher, and shortens it', async ({
  page,
}) => {
  const account = accountOf('absences');
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

  // The absence, from the Timetable page.
  const texts = en.timetable.absences;
  const [monday] = mondaysAhead(2);
  if (monday === undefined) throw new Error('No Monday ahead.');
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.absencesLink, exact: true }).click();
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const form = page.getByRole('form', { name: texts.newTitle });
  await form.getByLabel(texts.person, { exact: true }).selectOption({ label: 'Aliyeva Zarina' });
  await form.getByLabel(texts.firstDay, { exact: true }).fill(monday);
  await form.getByLabel(texts.openEnded, { exact: true }).check();
  await form.getByLabel(texts.reason, { exact: true }).fill('Ill');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByRole('table', { name: texts.caption })).toContainText('Aliyeva Zarina');

  // Her lessons need a teacher, on the home page.
  await page.goto('/');
  const needs = page.getByRole('region', { name: en.home.needsTeacher.title });
  await expect(needs).toContainText(
    en.home.attention.absence.replace('{{name}}', 'Aliyeva Zarina'),
  );

  // Moved to a Sunday, the absence holds none of her lessons: the list is gone.
  await page.goto('/timetable/absences');
  await page.getByRole('button', { name: 'Aliyeva Zarina', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Aliyeva Zarina' });
  await panel.getByRole('button', { name: texts.changeDates, exact: true }).click();
  const dates = panel.getByRole('form', { name: texts.changeDates });
  const sunday = addDays(monday, 6);
  await dates.getByLabel(texts.firstDay, { exact: true }).fill(sunday);
  await dates.getByLabel(texts.openEnded, { exact: true }).uncheck();
  await dates.getByLabel(texts.lastDay, { exact: true }).fill(sunday);
  await dates.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText(texts.lessonsEmpty)).toBeVisible();
  await page.goto('/');
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(page.getByRole('region', { name: en.home.needsTeacher.title })).toHaveCount(0);
});
