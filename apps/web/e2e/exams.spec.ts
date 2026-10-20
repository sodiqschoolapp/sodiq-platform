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

// docs/spec/06-timetable.md, Changes after publishing, Exam; edge/timetable,
// Exams: "The save lists such blocks. For each, the Academic Vice Principal
// chooses in the same save: cancel the whole block ..., or keep it for the
// other classes". Task 5.6c-2, pull request #182, Done when: "an exam is made
// from the page over a shared block with its choice, and cancelled with a
// lesson kept cancelled". The scene of its own: 7 Oxford (lesson 1) and
// 7 Princeton (lesson 2) with Aliyeva's geometry on Monday, the group
// 7-Astronomy of both classes in lesson 3, and Nazarov free to invigilate.
// All names are invented.
test('an Academic Vice Principal makes an exam over a shared block and cancels it keeping a lesson cancelled', async ({
  page,
}) => {
  const account = accountOf('exams');
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

  // The first Monday with 7 Oxford's lessons, from the day page.
  const day = en.timetable.day;
  const texts = en.timetable.exams;
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
  await page.getByRole('link', { name: day.examsLink, exact: true }).click();
  await expect(heading(page, texts.title)).toBeVisible();

  // The exam of 7 Oxford in lessons 1 to 3, over the shared astronomy lesson.
  await page.getByRole('button', { name: texts.new, exact: true }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel(texts.examTitle, { exact: true }).fill('Quarter exam');
  await form.getByLabel(texts.room, { exact: true }).selectOption({ label: 'Room 31' });
  await form.getByRole('checkbox', { name: '7 Oxford', exact: true }).check();
  await form.getByRole('checkbox', { name: 'Nazarov Rustam', exact: true }).check();
  await form.getByLabel(texts.firstLesson, { exact: true }).selectOption('1');
  await form.getByLabel(texts.lastLesson, { exact: true }).selectOption('3');
  await form.getByRole('button', { name: texts.check, exact: true }).click();
  const shared = form.locator('[data-shared]');
  await expect(shared).toHaveCount(1);
  await expect(shared).toContainText('Astronomy');
  await expect(form.locator('[data-exam-cancels] li')).toHaveCount(1);
  await shared.getByRole('radio', { name: texts.choice_keep, exact: true }).check();
  const save = form.getByRole('button', { name: texts.save, exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(texts.created, { exact: true })).toBeVisible();

  // The class day page shows the exam, and 7 Oxford's lesson 1 cancelled for it.
  await page.getByRole('link', { name: texts.toDay, exact: true }).click();
  await expect(heading(page, day.title)).toBeVisible();
  await expect(page.locator('[data-exam]')).toContainText(day.exam);
  await expect(page.locator('[data-exam]')).toContainText('Quarter exam');
  await expect(page.locator('tbody tr[data-lesson]').first()).toContainText(day.cause_exam);

  // 7 Princeton's lesson moves to lesson 1 for the day: its teacher now
  // holds the time of 7 Oxford's lesson, which cannot come back.
  await page.getByLabel(day.class, { exact: true }).selectOption({ label: '7 Princeton' });
  await page.getByRole('button', { name: day.move, exact: true }).first().click();
  const moving = page.getByRole('dialog');
  await moving.getByLabel(day.slot, { exact: true }).selectOption('1');
  await moving.getByLabel(day.reason, { exact: true }).fill('Teacher training later');
  await moving.getByRole('button', { name: day.moveSend, exact: true }).click();
  // With a warning: a free period in the middle of the class’s day.
  await expect(page.locator('main p[role="status"]')).toContainText(day.moved);

  // The cancel lists the lesson that cannot come back and keeps it cancelled.
  await page.getByRole('link', { name: day.examsLink, exact: true }).click();
  await expect(heading(page, texts.title)).toBeVisible();
  await page.locator('tbody tr').first().getByRole('button').first().click();
  await page.getByRole('button', { name: texts.cancel, exact: true }).click();
  const cancelling = page.getByRole('dialog');
  await cancelling.getByRole('button', { name: texts.cancelSend, exact: true }).click();
  await expect(cancelling.locator('[data-exam-restore-blocked]')).toBeVisible();
  await cancelling.getByLabel(texts.keepReason, { exact: true }).fill('The teacher is taken');
  await cancelling.getByRole('button', { name: texts.cancelKeeping, exact: true }).click();
  await expect(page.getByText(texts.cancelledDone, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: texts.toDay, exact: true }).click();
  await expect(heading(page, day.title)).toBeVisible();
  await expect(page.locator('[data-exam]')).toHaveCount(0);
  await expect(page.locator('tbody tr[data-lesson]').first()).toContainText(
    'Cancelled: The teacher is taken',
  );
});
