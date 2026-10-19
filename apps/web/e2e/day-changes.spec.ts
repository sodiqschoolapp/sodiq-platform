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

// docs/spec/06-timetable.md, Changes after publishing: "One-day change. …
// cancel. Every one-day change needs a reason"; edge/timetable, After
// publishing: "A cancelled lesson is restored … Every rule is checked again."
// Task 5.6a-1, pull request #160. The publishable grid scene: the Academic
// Vice Principal publishes from step 8, opens Day changes, cancels 7 Oxford's
// Monday lesson with a reason and restores it, then moves it to another lesson
// slot of the day (task 5.6a-2, pull request #161). All names are invented.
test('an Academic Vice Principal cancels a lesson for one day, restores it and moves it', async ({
  page,
}) => {
  const account = accountOf('dayChanges');
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

  // Day changes, from the Timetable page: the first Monday with 7 Oxford's lesson.
  const day = en.timetable.day;
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.dayLink, exact: true }).click();
  await expect(heading(page, day.title)).toBeVisible();
  const cancelButton = page.getByRole('button', { name: day.cancel, exact: true }).first();
  for (const monday of mondaysAhead(6)) {
    const answered = page.waitForResponse(
      (response) =>
        response.url().includes('/api/timetable/day') && response.url().includes(monday),
    );
    await page.getByLabel(day.date, { exact: true }).fill(monday);
    await answered;
    await expect(page.locator('tbody tr').or(page.getByText(day.empty)).first()).toBeVisible();
    if ((await cancelButton.count()) > 0) break;
  }
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(day.reason, { exact: true }).fill('Excursion to the museum');
  await dialog.getByRole('button', { name: day.cancelSend, exact: true }).click();
  await expect(page.getByText(day.cancelled, { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText(
    'Cancelled: Excursion to the museum',
  );

  await page.getByRole('button', { name: day.restore, exact: true }).first().click();
  await expect(page.getByText(day.restored, { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText(day.asPlanned);

  // Task 5.6a-2: the lesson moved for the day to a later free lesson slot of
  // the same date, with a reason; a slot the class or teacher already holds
  // is refused, and the next one down is tried.
  const before = await page.locator('tbody tr').first().locator('td').first().innerText();
  await page.getByRole('button', { name: day.move, exact: true }).first().click();
  const moving = page.getByRole('dialog');
  const slot = moving.getByLabel(day.slot, { exact: true });
  await expect(slot).toBeVisible();
  await moving.getByLabel(day.reason, { exact: true }).fill('Concert in the hall');
  const count = await slot.locator('option').count();
  for (let index = count - 1; index >= 1; index -= 1) {
    await slot.selectOption({ index });
    await moving.getByRole('button', { name: day.moveSend, exact: true }).click();
    const outcome = await Promise.race([
      page
        .getByText(day.moved, { exact: true })
        .waitFor()
        .then(() => 'moved'),
      moving
        .getByRole('alert')
        .first()
        .waitFor()
        .then(() => 'refused'),
    ]);
    if (outcome === 'moved') break;
  }
  await expect(page.getByText(day.moved, { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr', { hasText: day.changed }).first()).toBeVisible();
  expect(
    await page
      .locator('tbody tr', { hasText: day.changed })
      .first()
      .locator('td')
      .first()
      .innerText(),
  ).not.toBe(before);
});
