import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

/** The Monday after today in Tashkent, as a school date. */
function nextMonday(): string {
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()),
  );
  const days = ((8 - today.getUTCDay()) % 7) + (today.getUTCDay() === 1 ? 7 : 0);
  return new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// edge/timetable, After publishing, "A teacher is ill for weeks with no
// return date": "One substitute can be assigned per journal for the whole
// absence in one action, each date still being checked. Shortening the
// absence returns future lessons to the teacher." Task 5.7b-2, pull request
// #192. The publishable grid scene with a second teacher of Geometry: the
// Academic Vice Principal publishes, enters Aliyeva's absence for two weeks
// and Rahimov's for the first, substitutes Rahimov for 7 Oxford's Geometry
// for the whole absence (the first week's dates are listed as blocked, the
// second week's saved), then shortens Aliyeva's absence to the first week,
// and Rahimov is no longer on her lessons. All names are invented.
test('an Academic Vice Principal substitutes a journal for a whole absence and shortens it', async ({
  page,
}) => {
  const account = accountOf('absenceSubstitution');
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

  // Aliyeva is absent for four weeks.
  const texts = en.timetable.absences;
  const monday = nextMonday();
  const enter = async (person: string, first: string, last: string) => {
    await page.goto('/timetable/absences');
    await expect(heading(page, texts.title)).toBeVisible();
    await page.getByRole('button', { name: texts.add, exact: true }).first().click();
    const form = page.getByRole('form', { name: texts.newTitle });
    await form.getByLabel(texts.person, { exact: true }).selectOption({ label: person });
    await form.getByLabel(texts.firstDay, { exact: true }).fill(first);
    await form.getByLabel(texts.lastDay, { exact: true }).fill(last);
    await form.getByLabel(texts.reason, { exact: true }).fill('Ill');
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    await expect(page.getByRole('table', { name: texts.caption })).toContainText(person);
  };
  const openAliyeva = async () => {
    await page.goto('/timetable/absences');
    await page.getByRole('button', { name: 'Aliyeva Zarina', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Aliyeva Zarina' });
    const lessons = panel.getByRole('region', { name: texts.lessons });
    const oxford = lessons.locator('tbody tr').filter({ hasText: '7 Oxford' });
    await expect(oxford.first()).toBeVisible();
    return { panel, lessons, oxford };
  };
  await enter('Aliyeva Zarina', monday, addDays(monday, 27));
  const before = (await openAliyeva()).oxford;
  // Her first two lessons of 7 Oxford's Geometry; Rahimov is absent on the first.
  const first = await before.nth(0).getAttribute('data-date');
  const second = await before.nth(1).getAttribute('data-date');
  if (first === null || second === null) throw new Error('Two lessons of 7 Oxford are needed.');
  await enter('Rahimov Nodir', first, first);
  const { panel, lessons, oxford } = await openAliyeva();

  // One substitute for 7 Oxford's Geometry for the whole absence.
  await oxford.first().getByRole('button', { name: texts.substituteJournal, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const field = dialog.getByLabel(en.timetable.day.substitute, { exact: true });
  const rahimov = await field.locator('option', { hasText: 'Rahimov Nodir' }).getAttribute('value');
  expect(rahimov).not.toBeNull();
  await field.selectOption(rahimov ?? '');
  await expect(dialog.locator('[data-chosen-blocked]')).toBeVisible();
  await dialog.getByLabel(en.timetable.day.reason, { exact: true }).fill('Aliyeva is ill');
  await dialog.getByRole('button', { name: en.timetable.day.substituteSend, exact: true }).click();
  const answer = dialog.locator('[data-journal-substitute-answer]');
  await expect(answer).toBeVisible();
  // Each date checked: the first lesson is blocked (Rahimov is absent), the next saved.
  await expect(answer.locator(`[data-blocked-date="${first}"]`)).toContainText(
    en.errors.substitute_away,
  );
  const saved = await answer.locator('[data-saved-dates]').getAttribute('data-saved-dates');
  expect((saved ?? '').split(',')).toContain(second);
  await answer
    .getByRole('button', { name: en.timetable.journalSubstitute.close, exact: true })
    .click();
  await expect(lessons.locator(`tbody tr[data-date="${second}"]`).first()).toContainText(
    'Rahimov Nodir',
  );

  // Shortened to her first lesson's day: the later lessons return to Aliyeva.
  await panel.getByRole('button', { name: texts.changeDates, exact: true }).click();
  const dates = panel.getByRole('form', { name: texts.changeDates });
  await dates.getByLabel(texts.lastDay, { exact: true }).fill(first);
  await dates.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByRole('button', { name: texts.changeDates, exact: true })).toBeVisible();
  await expect(lessons.locator(`tbody tr[data-date="${second}"]`)).toHaveCount(0);
  await expect(lessons).not.toContainText('Rahimov Nodir');
});
