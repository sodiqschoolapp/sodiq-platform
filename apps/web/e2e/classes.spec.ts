import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/05-classes-groups-subjects.md, Class and Language of instruction
// ("The same holds when a Tutor is given a class. This is blocked, not a
// warning"); task 3.1a, pull request #88. An Academic Vice Principal creates
// "7 Oxford", an Uzbek class, gives it a Tutor who teaches in Uzbek, and is
// not let choose one who teaches in Russian only. With SCREENSHOTS=1 the list
// and the panel are saved for the report under docs/screens/3.1a/. All names
// are invented.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.1a');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal creates a class and gives it a Tutor of its language', async ({
  page,
}) => {
  const account = accountOf('classes');
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

  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.classes) })
    .click();
  await expect(heading(page, en.classes.title)).toBeVisible();

  const texts = en.classes;
  // The header's button comes first; the empty list offers the same action.
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const create = page.getByRole('form', { name: texts.newTitle });
  await create.getByLabel(texts.grade, { exact: true }).selectOption('7');
  await create.getByLabel(texts.className, { exact: true }).fill('Oxford');
  await create.getByLabel(texts.language, { exact: true }).selectOption('uz');
  await create.getByLabel(texts.maxSize, { exact: true }).fill('25');
  await create.getByRole('button', { name: en.form.save, exact: true }).click();

  const panel = page.getByRole('complementary', { name: '7 Oxford' });
  await expect(panel).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '7 Oxford' });
  await expect(row).toContainText(texts.noTutor);

  await panel.getByRole('button', { name: texts.giveTutor, exact: true }).click();
  const give = panel.getByRole('form', { name: texts.giveTutor });
  const person = give.getByLabel(texts.person, { exact: true });
  // A person who does not teach in Uzbek is shown with the reason and cannot be chosen.
  await expect(
    person.locator('option', { hasText: 'Smirnov Pavel (does not teach in Uzbek)' }),
  ).toBeDisabled();
  await screenshot(page, 'give-tutor');
  await person.selectOption({ label: 'Salimova Zuhra' });
  // Task 3.6c-2 (decision 10): what the give does to the dated Tutor lessons
  // is shown before the save; this class has none yet.
  await expect(give.getByText(en.classes.preview.none, { exact: true })).toBeVisible();
  await give.getByRole('button', { name: en.form.save, exact: true }).click();

  await expect(panel.getByText(`${texts.kinds.tutor}: Salimova Zuhra`)).toBeVisible();
  await expect(row).toContainText('Salimova Zuhra');
  await screenshot(page, 'class-with-tutor');
});

// Task 3.1b, pull request #89 (edge/students-classes-groups, "A student is
// enrolled in August before classes are formed"; "A class is full"): an
// Academic Vice Principal puts two students with no class into 7 Oxford from
// today; the class shows them and its count, and the student list shows the
// class. With SCREENSHOTS=1 the tab and the list are saved for the report
// under docs/screens/3.1b/. All names are invented.
const MEMBER_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.1b');

async function memberScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(MEMBER_SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(MEMBER_SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal puts two students into a class', async ({ page }) => {
  const account = accountOf('members');
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

  await page.goto('/classes');
  await expect(heading(page, en.classes.title)).toBeVisible();
  const texts = en.classes;
  const row = page.getByRole('row').filter({ hasText: '7 Oxford' });
  await row.getByRole('button', { name: '7 Oxford' }).click();
  const panel = page.getByRole('complementary', { name: '7 Oxford' });
  await expect(panel.getByText(texts.noMembers)).toBeVisible();
  await panel.getByRole('button', { name: texts.putIntoClass, exact: true }).click();
  const form = panel.getByRole('form', {
    name: texts.putIntoNamed.replace('{{class}}', '7 Oxford'),
  });
  await form.getByRole('checkbox', { name: 'Qosimova Madina (9999701)' }).check();
  await form.getByRole('checkbox', { name: 'Nurmatov Javohir (9999702)' }).check();
  await form.getByRole('button', { name: en.form.save, exact: true }).click();

  await expect(panel.getByText('Qosimova Madina')).toBeVisible();
  await expect(panel.getByText('Nurmatov Javohir')).toBeVisible();
  await expect(panel.getByText(texts.freeToday.replace('{{n}}', '23'))).toBeVisible();
  // The count of the list (`05`: "the student count of the class card").
  // Retried until the list has read the save again (task 10.1: a one-shot read
  // of the cells could come before the refetch and read 0).
  await expect(
    row
      .locator('td')
      .filter({ hasText: /^\s*2\s*$/ })
      .first(),
  ).toBeVisible();
  await memberScreenshot(page, 'class-students');

  await page.goto('/people/students');
  await expect(heading(page, en.people.students.title)).toBeVisible();
  for (const name of ['Qosimova Madina', 'Nurmatov Javohir']) {
    await expect(page.locator('tbody tr').filter({ hasText: name })).toContainText('7 Oxford');
  }
  await memberScreenshot(page, 'student-list');
});

// Task 3.1c, pull request #90 (`02`, the Tutor row: "Own class or classes ...
// the profiles of own class"; edge/people-roles-accounts, Contact: "and the
// class Tutor"): the Tutor of 7 Oxford sees 7 Oxford only under Classes, opens
// the profile of a student of it with the mother's phone, and the row of a
// student of 7 Yale does not open. With SCREENSHOTS=1 the pages are saved for
// the report under docs/screens/3.1c/. All names are invented.
const SCOPE_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.1c');

async function scopeScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCOPE_SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCOPE_SCREENS, `${name}.png`) });
}

test('a Tutor reads the own class and nothing of another class', async ({ page }) => {
  const account = accountOf('tutorScope');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.classes) })
    .click();
  await expect(heading(page, en.classes.title)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  const row = page.getByRole('row').filter({ hasText: '7 Oxford' });
  await expect(row).toContainText('Ahmedova Shoira');
  await expect(page.getByRole('button', { name: en.classes.add, exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: '7 Oxford' }).click();
  const panel = page.getByRole('complementary', { name: '7 Oxford' });
  await expect(panel.getByText('Tojiyeva Nilufar')).toBeVisible();
  await scopeScreenshot(page, 'tutor-classes');

  await page.goto('/people/students');
  await expect(heading(page, en.people.students.title)).toBeVisible();
  // The whole list of the branch, and only the own class's student opens.
  const yale = page.locator('tbody tr').filter({ hasText: 'Aliyev Sherzod' });
  await expect(yale).toContainText('7 Yale');
  await expect(yale.getByRole('button', { name: 'Aliyev Sherzod' })).toHaveCount(0);
  const oxford = page.locator('tbody tr').filter({ hasText: 'Tojiyeva Nilufar' });
  await oxford.getByRole('button', { name: 'Tojiyeva Nilufar' }).click();
  const profile = page.getByRole('complementary', { name: 'Nilufar Tojiyeva' });
  await expect(profile).toBeVisible();
  await profile.getByText(en.people.students.tabs.relatives, { exact: true }).click();
  await expect(profile.getByText('Dilnoza Tojiyeva')).toBeVisible();
  await expect(profile.getByText('+998 90 555 02 61')).toBeVisible();
  await scopeScreenshot(page, 'tutor-student');
});
