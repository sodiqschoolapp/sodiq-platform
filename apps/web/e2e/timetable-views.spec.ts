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

// docs/spec/06-timetable.md, Views and outputs: "Views by class, by teacher,
// by room and the whole school; by day and by week"; How surprises are
// prevented: "Changed lessons carry a 'changed' mark on every timetable view
// for a week" (task 5.9a, pull request #197). The publishable grid scene:
// the Academic Vice Principal publishes, cancels 7 Oxford's Monday lesson for
// the day, and finds it in the class's week and on the school view. All names
// are invented.
test('an Academic Vice Principal reads a cancelled lesson in the class’s week and the school view', async ({
  page,
}) => {
  const account = accountOf('timetableViews');
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
  const texts = en.timetable.publish;
  await page.goto('/timetable/builder');
  await expect(heading(page, builder.title)).toBeVisible();
  await page.getByRole('button', { name: builder.confirm, exact: true }).click();
  await expect(page.getByText(builder.confirmed, { exact: true })).toBeVisible();
  await page.locator('[data-step="publish"] button').click();
  await expect(page.locator('[data-can-publish]')).toHaveText(texts.nothingRefused);
  await page.getByRole('button', { name: texts.action, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: texts.action, exact: true })
    .click();
  await expect(page.locator('[data-published]')).toBeVisible();

  // Cancel 7 Oxford's first Monday lesson for the day.
  const day = en.timetable.day;
  await page.goto('/timetable/day');
  await expect(heading(page, day.title)).toBeVisible();
  const cancelButton = page.getByRole('button', { name: day.cancel, exact: true }).first();
  let date = '';
  for (const monday of mondaysAhead(6)) {
    const answered = page.waitForResponse(
      (response) =>
        response.url().includes('/api/timetable/day') && response.url().includes(monday),
    );
    await page.getByLabel(day.date, { exact: true }).fill(monday);
    await answered;
    await expect(page.locator('tbody tr').or(page.getByText(day.empty)).first()).toBeVisible();
    if ((await cancelButton.count()) > 0) {
      date = monday;
      break;
    }
  }
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(day.reason, { exact: true }).fill('Excursion to the museum');
  await dialog.getByRole('button', { name: day.cancelSend, exact: true }).click();
  await expect(page.getByText(day.cancelled, { exact: true })).toBeVisible();

  // Timetable views, from the Timetable page: the class's week.
  const views = en.timetable.views;
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.viewsLink, exact: true }).click();
  await expect(heading(page, views.title)).toBeVisible();
  await page.getByRole('radio', { name: views.kind_class }).check({ force: true });
  await page.getByLabel(views.kind_class, { exact: true }).selectOption({ label: '7 Oxford' });
  await page.getByLabel(views.date, { exact: true }).fill(date);
  await page.getByRole('radio', { name: views.span_week }).check({ force: true });
  await expect(page.locator('[data-axis="slots"]')).toBeVisible();
  await expect(page.locator('[data-version-line]')).toContainText('Version 1, valid from');
  const cell = page.locator('tbody tr').first().locator('td').nth(1);
  await expect(cell).toContainText('Cancelled: Excursion to the museum');
  await expect(cell).toContainText(day.changed);

  // The school view of that day lists 7 Oxford with the same lesson.
  await page.getByRole('radio', { name: views.kind_branch }).check({ force: true });
  await page.getByRole('radio', { name: views.span_day }).check({ force: true });
  const oxford = page.locator('tbody tr').filter({ hasText: '7 Oxford' });
  await expect(oxford).toContainText('Cancelled: Excursion to the museum');
});
