import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/05-classes-groups-subjects.md, Teaching load ("Only teachers whose
// profile has the subject and every grade of the class or group ... can be
// chosen"); 06-timetable.md, Building a timetable, steps 1 and 2; task 3.4a,
// pull request #99. An Academic Vice Principal starts a draft, adds a row of
// 7 Oxford in Geometry and sees the teacher without grade 7 not offered.
// With SCREENSHOTS=1 the form and the list are saved for the report under
// docs/screens/3.4a/. All names are invented.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.4a');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal starts a draft and adds a load row with a teacher who may take it', async ({
  page,
}) => {
  const account = accountOf('teachingLoad');
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

  // The load is reached from the Timetable item of the menu.
  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.timetable) })
    .click();
  await expect(heading(page, en.timetable.title)).toBeVisible();
  await page.getByRole('link', { name: en.timetable.loadLink, exact: true }).click();
  await expect(heading(page, en.timetable.load.title)).toBeVisible();
  await expect(page.getByText(en.timetable.load.noVersion)).toBeVisible();

  const texts = en.timetable.load;
  await page.getByRole('button', { name: texts.newDraft, exact: true }).click();
  const draft = page.getByRole('form', { name: texts.newDraftTitle });
  await screenshot(page, 'new-draft');
  await draft.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByLabel(texts.version, { exact: true })).toContainText('Version 1');

  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const create = page.getByRole('form', { name: texts.newRow });
  await create.getByLabel(texts.unit, { exact: true }).selectOption({ label: '7 Oxford' });
  await create.getByLabel(texts.subject, { exact: true }).selectOption({ label: 'Geometry' });
  const teacher = create.getByLabel(texts.teacher, { exact: true });
  await expect(teacher.locator('option')).toHaveText([texts.chooseTeacher, 'Karimova Aziza']);
  await teacher.selectOption({ label: 'Karimova Aziza' });
  await create.getByLabel(texts.lessons, { exact: true }).fill('3');
  await screenshot(page, 'new-row');
  await create.getByRole('button', { name: en.form.save, exact: true }).click();

  // The row of the list; the weekly totals below have a row of 7 Oxford too (task 3.4b).
  const row = page.getByRole('row').filter({ hasText: '7 Oxford' }).filter({ hasText: 'Geometry' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Karimova Aziza');
  await expect(row).toContainText(texts.none);
  await screenshot(page, 'load-list');

  // Task 3.6c-2 (decision 1): the Homework slot of 7 Oxford has no teacher to
  // choose; the form names the class's Tutor, who holds the row.
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const tutorRow = page.getByRole('form', { name: texts.newRow });
  await tutorRow.getByLabel(texts.unit, { exact: true }).selectOption({ label: '7 Oxford' });
  await tutorRow
    .getByLabel(texts.subject, { exact: true })
    .selectOption({ label: 'Homework slot' });
  await expect(
    tutorRow.getByText(texts.tutorRowTeacher.replace('{{name}}', 'Tursunova Gulnora')),
  ).toBeVisible();
  await expect(tutorRow.getByLabel(texts.teacher, { exact: true })).toHaveCount(0);
  await tutorRow.getByLabel(texts.lessons, { exact: true }).fill('1');
  await tutorRow.getByRole('button', { name: en.form.save, exact: true }).click();
  const homework = page
    .getByRole('row')
    .filter({ hasText: '7 Oxford' })
    .filter({ hasText: 'Homework slot' });
  await expect(homework).toContainText('Tursunova Gulnora');
  await expect(homework).toContainText(texts.none);
});

// edge-cases/timetable.md, Structure: "all parts have equal lessons per week
// and different teachers"; 06-timetable.md, Building a timetable, steps 2 and
// 3; task 3.4b, pull request #100. An Academic Vice Principal gives the two
// halves of a split of 7 Oxford their rows: the first half's teacher is not
// offered for the second, a change of lessons on one half is written to both,
// and the weekly totals count the split once. All names are invented.
test('an Academic Vice Principal gives a split its two parts and changes their lessons together', async ({
  page,
}) => {
  const account = accountOf('teachingBlocks');
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

  await page.goto('/timetable/load');
  await expect(heading(page, en.timetable.load.title)).toBeVisible();
  const texts = en.timetable.load;
  await page.getByRole('button', { name: texts.newDraft, exact: true }).click();
  await page
    .getByRole('form', { name: texts.newDraftTitle })
    .getByRole('button', { name: en.form.save, exact: true })
    .click();
  await expect(page.getByLabel(texts.version, { exact: true })).toContainText('Version 1');

  async function addPart(group: string, offered: string[], chosen: string): Promise<void> {
    await page.getByRole('button', { name: texts.add, exact: true }).first().click();
    const create = page.getByRole('form', { name: texts.newRow });
    await create.getByLabel(texts.unit, { exact: true }).selectOption({ label: group });
    await create.getByLabel(texts.subject, { exact: true }).selectOption({ label: 'Geometry' });
    const teacher = create.getByLabel(texts.teacher, { exact: true });
    await expect(teacher.locator('option')).toHaveText([texts.chooseTeacher, ...offered]);
    await teacher.selectOption({ label: chosen });
    await create.getByLabel(texts.lessons, { exact: true }).fill('3');
    await create.getByRole('button', { name: en.form.save, exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: group }).first()).toBeVisible();
  }

  await addPart('7-G-1', ['Olimova Zarina', 'Saidova Madina'], 'Saidova Madina');
  // The first half's teacher is not offered for the second half.
  await addPart('7-G-2', ['Olimova Zarina'], 'Olimova Zarina');
  await screenshot(page, 'split-rows');

  const first = page
    .getByRole('row')
    .filter({ hasText: '7-G-1, 7-G-2' })
    .filter({ hasText: 'Saidova Madina' });
  await first.getByRole('button').first().click();
  await page.getByRole('button', { name: en.form.edit, exact: true }).click();
  const edit = page.getByRole('form', { name: '7-G-1, Geometry' });
  await expect(
    edit.getByText(texts.blockLessonsNote.replace('{{min}}', '1').replace('{{max}}', '40')),
  ).toBeVisible();
  await edit.getByLabel(texts.lessons, { exact: true }).fill('4');
  await edit.getByRole('button', { name: en.form.save, exact: true }).click();
  for (const teacher of ['Saidova Madina', 'Olimova Zarina']) {
    // The lessons cell of each half (spec review of the build, should-fix 6).
    await expect(
      page.getByRole('row').filter({ hasText: teacher }).first().locator('td').nth(4),
    ).toHaveText('4');
  }

  // The split counts once for 7 Oxford in the weekly totals.
  const totals = page.locator('[data-totals="classes"]');
  await expect(
    totals.getByRole('row').filter({ hasText: '7 Oxford' }).locator('td').nth(1),
  ).toHaveText(/^4(?!\d)/);
  await screenshot(page, 'weekly-totals');
});
