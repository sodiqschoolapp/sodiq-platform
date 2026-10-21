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

// docs/spec/edge-cases/timetable.md, After publishing: "A room closure has a
// start, an end and a reason. Lessons in the range go to 'needs a room', with
// 'move all to room R for the period'." Task 5.7a-2b, pull request #187. The
// publishable grid scene with Room 41 and Room 42: the Academic Vice
// Principal publishes, puts 7 Oxford's Monday lesson into Room 41 for the
// day, closes Room 41 that day, finds the lesson under "Lessons that need a
// room" on the home page, moves all to Room 42, and the list is gone. All
// names are invented.
test('an Academic Vice Principal closes a room, sees its lesson needs a room, and moves it to another room', async ({
  page,
}) => {
  const account = accountOf('roomClosures');
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

  // The first Monday with 7 Oxford's lesson, put into Room 41 for the day.
  const day = en.timetable.day;
  await page.goto('/timetable/day');
  await expect(heading(page, day.title)).toBeVisible();
  const roomButton = page.getByRole('button', { name: day.changeRoom, exact: true }).first();
  let lessonDay = '';
  for (const monday of mondaysAhead(6)) {
    const answered = page.waitForResponse(
      (response) =>
        response.url().includes('/api/timetable/day') && response.url().includes(monday),
    );
    await page.getByLabel(day.date, { exact: true }).fill(monday);
    await answered;
    await expect(page.locator('tbody tr').or(page.getByText(day.empty)).first()).toBeVisible();
    if ((await roomButton.count()) > 0) {
      lessonDay = monday;
      break;
    }
  }
  expect(lessonDay).not.toBe('');
  await roomButton.click();
  const roomDialog = page.getByRole('dialog');
  await roomDialog.getByLabel(day.newRoom, { exact: true }).selectOption({ label: 'Room 41' });
  await roomDialog.getByLabel(day.reason, { exact: true }).fill('Practical work');
  await roomDialog.getByRole('button', { name: day.roomSend, exact: true }).click();
  await expect(page.getByText(day.roomChanged, { exact: true })).toBeVisible();

  // Room 41 closed that day, from the Timetable page.
  const texts = en.timetable.roomClosures;
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.roomClosuresLink, exact: true }).click();
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const form = page.getByRole('form', { name: texts.newTitle });
  await form.getByLabel(texts.room, { exact: true }).selectOption({ label: 'Room 41' });
  await form.getByLabel(texts.firstDay, { exact: true }).fill(lessonDay);
  await form.getByLabel(texts.lastDay, { exact: true }).fill(lessonDay);
  await form.getByLabel(texts.reason, { exact: true }).fill('Water leak');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByRole('table', { name: texts.caption })).toContainText('Water leak');

  // The lesson needs a room, on the home page; its row opens the closure.
  await page.goto('/');
  const needs = page.getByRole('region', { name: en.home.needsRoom.title });
  await expect(needs).toContainText(en.home.attention.room_closure.replace('{{name}}', 'Room 41'));
  await needs.getByRole('link', { name: en.home.attention.openClosure, exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Room 41' });
  await expect(panel.getByText(texts.needsRoom, { exact: true })).toBeVisible();

  // Move all to Room 42: the lesson no longer needs a room.
  await panel.getByRole('button', { name: texts.moveAll, exact: true }).click();
  const move = panel.getByRole('form', { name: texts.moveAll });
  await move.getByLabel(texts.moveRoom, { exact: true }).selectOption({ label: 'Room 42' });
  await move.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText(texts.lessonsEmpty)).toBeVisible();
  await page.goto('/');
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(page.getByRole('region', { name: en.home.needsRoom.title })).toHaveCount(0);
});
