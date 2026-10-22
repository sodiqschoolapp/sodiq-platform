import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

/** The first Monday after today in Tashkent, as a school date: a new draft's default start. */
function nextMonday(): string {
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()),
  );
  const days = ((8 - today.getUTCDay()) % 7) + (today.getUTCDay() === 1 ? 7 : 0);
  return new Date(today.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// docs/spec/14-quality-plan.md, Whole system: "browser tests that act as each
// role and walk the main paths: build and publish a timetable" (task 5.12b,
// pull request #202). A branch with its year, quarters, classes, a teacher and
// a room but no version: the Academic Vice Principal starts a draft, gives
// 7 Oxford its Geometry, confirms the day templates, places the lesson on
// Tuesday in the first slot with its room, publishes from step 8 and finds the
// lesson in the class's published week. All names are invented.
test('an Academic Vice Principal builds a timetable from nothing, publishes it and reads the published week', async ({
  page,
}) => {
  const account = accountOf('buildWalk');
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

  // The draft and its load: 7 Oxford's Geometry, once a week.
  const load = en.timetable.load;
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.loadLink, exact: true }).click();
  await expect(heading(page, load.title)).toBeVisible();
  await expect(page.getByText(load.noVersion)).toBeVisible();
  await page.getByRole('button', { name: load.newDraft, exact: true }).click();
  await page
    .getByRole('form', { name: load.newDraftTitle })
    .getByRole('button', { name: en.form.save, exact: true })
    .click();
  await expect(page.getByLabel(load.version, { exact: true })).toContainText('Version 1');
  await page.getByRole('button', { name: load.add, exact: true }).first().click();
  const row = page.getByRole('form', { name: load.newRow });
  await row.getByLabel(load.unit, { exact: true }).selectOption({ label: '7 Oxford' });
  await row.getByLabel(load.subject, { exact: true }).selectOption({ label: 'Geometry' });
  await row.getByLabel(load.teacher, { exact: true }).selectOption({ label: 'Aliyeva Zarina' });
  await row.getByLabel(load.lessons, { exact: true }).fill('1');
  await row.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(
    page.getByRole('row').filter({ hasText: '7 Oxford' }).filter({ hasText: 'Geometry' }),
  ).toContainText('Aliyeva Zarina');

  // Step 1: the day templates confirmed.
  const builder = en.timetable.builder;
  await page.goto('/timetable/builder');
  await expect(heading(page, builder.title)).toBeVisible();
  await page.getByRole('button', { name: builder.confirm, exact: true }).click();
  await expect(page.getByText(builder.confirmed, { exact: true })).toBeVisible();

  // Step 7: the lesson dragged from "To place" to Tuesday 08:00, then given its room.
  await page.locator('[data-step="grid"] button').click();
  await expect(page.locator('[data-board]')).toBeVisible();
  const tuesday = page.locator('[data-cell="2:1"]');
  const entry = page.locator('[data-to-place]').filter({ hasText: 'Geometry, 7 Oxford' });
  await expect(entry).toBeVisible();
  // A pointer drag in steps: a single jump starts no native drag from the panel.
  await entry.hover({ position: { x: 12, y: 8 } });
  await page.mouse.down();
  await page.mouse.move(600, 300, { steps: 5 });
  await tuesday.hover();
  await tuesday.hover({ position: { x: 20, y: 20 } });
  await page.mouse.up();
  await expect(tuesday.locator('[data-block]')).toContainText('Geometry');
  await expect(
    page.locator('[data-to-place]').filter({ hasText: 'Geometry, 7 Oxford' }),
  ).toHaveCount(0);
  await tuesday.getByRole('button', { name: /Room of Geometry/ }).click();
  const rooms = page.getByRole('dialog');
  await rooms
    .locator('[data-room-choice]')
    .filter({ hasText: 'Room 31' })
    .getByRole('button')
    .click();
  await expect(tuesday.locator('[data-block]')).toContainText('Room 31');

  // Step 8: published from its default start, after the confirmation.
  const publish = en.timetable.publish;
  await page.locator('[data-step="publish"] button').click();
  await expect(page.locator('[data-can-publish]')).toHaveText(publish.nothingRefused);
  await page.getByRole('button', { name: publish.action, exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('Publish version 1?');
  await confirmation.getByRole('button', { name: publish.action, exact: true }).click();
  await expect(page.locator('[data-published]')).toBeVisible();

  // The class's published week of the start date: Geometry on Tuesday, first lesson.
  const views = en.timetable.views;
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.viewsLink, exact: true }).click();
  await expect(heading(page, views.title)).toBeVisible();
  await page.getByRole('radio', { name: views.kind_class, exact: true }).check({ force: true });
  // The choice of the view and the select of its class share the word "Class".
  await page
    .getByRole('combobox', { name: views.kind_class, exact: true })
    .selectOption({ label: '7 Oxford' });
  await page.getByLabel(views.date, { exact: true }).fill(nextMonday());
  await page.getByRole('radio', { name: views.span_week, exact: true }).check({ force: true });
  await expect(page.locator('[data-axis="slots"]')).toBeVisible();
  await expect(page.locator('[data-version-line]')).toContainText('Version 1, valid from');
  const first = page.locator('tbody tr').first().locator('td');
  await expect(first.nth(2)).toContainText('Geometry');
  await expect(first.nth(2)).toContainText('Room 31');
  await expect(first.nth(2)).toContainText('Aliyeva Zarina');
  await expect(first.nth(1)).not.toContainText('Geometry');
});
