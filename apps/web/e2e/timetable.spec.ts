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

  const row = page.getByRole('row').filter({ hasText: '7 Oxford' });
  await expect(row).toContainText('Geometry');
  await expect(row).toContainText('Karimova Aziza');
  await expect(row).toContainText(texts.none);
  await screenshot(page, 'load-list');
});
