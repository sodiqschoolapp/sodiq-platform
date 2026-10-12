import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { jpegSizeOf, pngOf } from './photos';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/04-people.md, Teacher and staff record; task 2.2a. An Academic
// Vice Principal opens a teacher of the branch, changes the phone and gives
// the teacher a subject with its grades and a language of instruction (edge,
// Who can act); then (task 2.2b) gives the teacher hours on Monday, and adds
// and closes a vacancy in the section of its own (04, Availability, Vacancy). The Super Admin's create is proved by the API and page tests:
// no fourth Super Admin can be seeded. All names are invented.
test('an Academic Vice Principal gives a teacher of the branch a subject', async ({ page }) => {
  const account = accountOf('staff');
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
    .getByRole('link', { name: new RegExp(en.menu.people) })
    .click();
  await expect(heading(page, en.people.title)).toBeVisible();
  await page.getByRole('link', { name: en.people.staffLink, exact: true }).click();
  await expect(heading(page, en.people.staff.title)).toBeVisible();

  const texts = en.people.staff;
  // The Academic Vice Principal does not add people.
  await expect(page.getByRole('button', { name: texts.add, exact: true })).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: 'Qoʻchqorov' });
  await expect(row).toContainText('S-269001');
  await expect(row).toContainText(texts.statuses.active);

  await row.getByRole('button', { name: 'Oybek Qoʻchqorov' }).click();
  const panel = page.getByRole('complementary', { name: 'Oybek Qoʻchqorov' });
  const record = panel.getByRole('form', { name: 'Oybek Qoʻchqorov', exact: true });
  await expect(record.getByLabel(texts.sex, { exact: true })).toBeDisabled();
  await record.getByLabel(texts.phone, { exact: true }).fill('+998 93 555 44 34');
  await record.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(row).toContainText('+998935554434');

  const teaching = panel.getByRole('form', {
    name: texts.teachingOf.replace('{{name}}', 'Oybek Qoʻchqorov'),
  });
  await teaching.getByLabel('Geometry', { exact: true }).check();
  await teaching
    .getByLabel(en.setup.subjects.grade.replace('{{grade}}', '8'), { exact: true })
    .check();
  await teaching.getByLabel(texts.languages.uz, { exact: true }).check();
  await teaching.getByRole('button', { name: en.form.save, exact: true }).click();

  await expect(row).toContainText('Geometry');
  await expect(row).toContainText(en.setup.subjects.grade.replace('{{grade}}', '8'));

  // Task 2.2b: the hours of the branch, from today (the first entry).
  const hours = en.people.availability;
  await panel.getByRole('button', { name: hours.change, exact: true }).click();
  const week = panel.getByRole('form', {
    name: hours.changeOf.replace('{{name}}', 'Oybek Qoʻchqorov'),
  });
  await week.getByLabel('Monday', { exact: true }).fill('08:00–13:00');
  await week.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText('08:00–13:00', { exact: true })).toBeVisible();
  await expect(panel.getByText(hours.inForce, { exact: true })).toBeVisible();

  // A vacancy, in the section of its own, added and closed.
  const vacancies = en.people.vacancies;
  await page
    .getByRole('navigation', { name: en.people.sections })
    .getByRole('link', { name: vacancies.title, exact: true })
    .click();
  await expect(heading(page, vacancies.title)).toBeVisible();
  // On an empty list the button stands in the header and on the empty page.
  await page.getByRole('button', { name: vacancies.add, exact: true }).first().click();
  const added = page.getByRole('form', { name: vacancies.newTitle, exact: true });
  await added.getByLabel(vacancies.name, { exact: true }).fill('Geometry vacancy 1');
  await added.getByLabel(vacancies.department, { exact: true }).selectOption({ label: 'STEAM' });
  await added.getByLabel('Geometry', { exact: true }).check();
  await added
    .getByLabel(en.setup.subjects.grade.replace('{{grade}}', '8'), { exact: true })
    .check();
  await added.getByLabel(texts.languages.uz, { exact: true }).check();
  await added.getByRole('button', { name: en.form.save, exact: true }).click();
  const vacancyRow = page.getByRole('row').filter({ hasText: 'Geometry vacancy 1' });
  await expect(vacancyRow).toContainText(vacancies.statuses.open);
  await vacancyRow.getByRole('button', { name: 'Geometry vacancy 1' }).click();
  const vacancyPanel = page.getByRole('complementary', { name: 'Geometry vacancy 1' });
  await vacancyPanel.getByRole('button', { name: vacancies.close, exact: true }).click();
  await expect(vacancyRow).toContainText(vacancies.statuses.closed);
});

// Task 2.2c-1: the Export button of the staff list. The Academic Vice
// Principal searches the list and exports it; the browser saves an Excel file
// named with the list and today. What the file holds, and what each role may
// export, is proved by the API tests, which read the file back. All names are
// invented.
test('an Academic Vice Principal exports the staff list of the branch', async ({ page }) => {
  const account = accountOf('staffExport');
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

  await page.goto('/people/staff');
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  await page.getByRole('searchbox', { name: en.list.search }).fill('Qoʻchqorov');
  await expect(page.locator('tbody tr')).toHaveCount(1);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en.list.export, exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Staff-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(statSync(await file.path()).size).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// Task 2.2c-2: an Academic Vice Principal adds the photo of a person of the
// branch (decision 2). The browser shrinks a photo of 1600 by 1200 pixels to
// 800 by 600 and sends it as a JPEG; the list then shows it in the photo
// column. The API keeps it in memory here (PHOTOS_IN_MEMORY); what is refused
// and who may do what is proved by the API and page tests. All names are invented.
test('an Academic Vice Principal adds the photo of a person of the branch', async ({ page }) => {
  const account = accountOf('staffPhoto');
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

  await page.goto('/people/staff');
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Mirzayev' });
  // No photo yet: the initials.
  await expect(row.getByRole('cell').first()).toHaveText('SM');

  await row.getByRole('button', { name: 'Shahzod Mirzayev' }).click();
  const panel = page.getByRole('complementary', { name: 'Shahzod Mirzayev' });
  const sent = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/photo'),
  );
  await panel.getByLabel(en.people.staff.photo.add).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: pngOf(1600, 1200),
  });
  expect((await sent).headers()['content-type']).toBe('image/jpeg');
  await expect(panel.getByRole('button', { name: en.people.staff.photo.change })).toBeVisible();

  const shown = row.getByRole('img', { name: 'Shahzod Mirzayev' });
  await expect(shown).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  const address = (await shown.getAttribute('src')) ?? '';
  const sentPhoto = Buffer.from(address.slice(address.indexOf(',') + 1), 'base64');
  expect(jpegSizeOf(sentPhoto)).toEqual({ width: 800, height: 600 });
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

// Task 2.3c-1, pull request #65: an Academic Vice Principal locks a Teacher
// of the branch with a reason, unlocks the account and resets its password;
// the one-time password is shown once on the slip. Who may do what to whom
// is proved by the API tests. With SCREENSHOTS=1 the section and the slip are
// saved for the report under docs/screens/2.3c-1/. All names are invented.
const ACCESS_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.3c-1');

async function accessScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(ACCESS_SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(ACCESS_SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal locks, unlocks and resets a teacher’s password', async ({
  page,
}) => {
  const account = accountOf('accountAccess');
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

  // The teacher has never signed in: listed among the accounts never used.
  await page.goto('/people/never-used');
  await expect(heading(page, en.people.neverUsed.title)).toBeVisible();
  await page.getByRole('link', { name: 'Sherzod Valiyev', exact: true }).click();
  await expect(heading(page, en.people.staff.title)).toBeVisible();

  const panel = page.getByRole('complementary', { name: 'Sherzod Valiyev' });
  const access = panel.getByRole('region', { name: en.people.access.title });
  await expect(access.getByText(en.people.access.neverUsed, { exact: true })).toBeVisible();

  const texts = en.people.access;
  await access.getByRole('button', { name: texts.lock, exact: true }).click();
  const lock = page.getByRole('dialog', {
    name: texts.lockTitle.replace('{{name}}', 'Sherzod Valiyev'),
  });
  await lock.getByLabel(texts.reason, { exact: true }).fill('Laptop lost on the bus');
  await lock.getByRole('button', { name: texts.lock, exact: true }).click();
  await expect(access.getByText(/Laptop lost on the bus/)).toBeVisible();
  await accessScreenshot(page, 'locked');

  await access.getByRole('button', { name: texts.unlock, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: texts.unlock, exact: true })
    .click();
  await expect(access.getByText(/Laptop lost on the bus/)).toHaveCount(0);
  await expect(access.getByRole('button', { name: texts.lock, exact: true })).toBeVisible();

  await access.getByRole('button', { name: texts.resetPassword, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: texts.resetPassword, exact: true })
    .click();
  const slip = page.getByRole('dialog', { name: texts.slipTitle });
  await expect(slip.getByText('Sherzod Valiyev')).toBeVisible();
  await expect(slip.locator('dd.font-mono').nth(1)).toHaveText(/^[A-Za-z0-9]{16}$/);
  await accessScreenshot(page, 'slip');
  await slip.getByRole('button', { name: en.people.account.closeSlip, exact: true }).click();
  await expect(slip).toHaveCount(0);
  await expect(access.getByText(/Password reset by/)).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

// Task 2.4a: an Academic Vice Principal adds a student with a UID outside the
// set of the grade and confirms it (04, UID sets, Release 1), finds the
// student by a Cyrillic spelling of the name (answer 18), opens the profile
// with its two tabs, and is refused a second student with the same UID, the
// holder named (edge/students-classes-groups). The readers of each group and
// the refusals of other branches are proved by the API and page tests. With
// SCREENSHOTS=1 the list, the profile and the refusal are saved for the report
// under docs/screens/2.4a/. All names are invented.
const STUDENT_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.4a');

async function studentScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(STUDENT_SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(STUDENT_SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal adds a student and is refused a second with the same UID', async ({
  page,
}) => {
  const account = accountOf('students');
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
    .getByRole('link', { name: new RegExp(en.menu.people) })
    .click();
  await page.getByRole('link', { name: en.people.studentsLink, exact: true }).click();
  await expect(heading(page, en.people.students.title)).toBeVisible();

  const texts = en.people.students;
  // Today in Tashkent: inside the seeded year, which began 100 days ago.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  async function add(lastName: string, contract: string) {
    // While the list is empty its empty state offers the same button.
    await page.getByRole('button', { name: texts.add, exact: true }).first().click();
    const form = page.getByRole('form', { name: texts.newTitle });
    await form.getByLabel(texts.uid, { exact: true }).fill('9999001');
    await form.getByLabel(texts.lastName, { exact: true }).fill(lastName);
    await form.getByLabel(texts.firstName, { exact: true }).fill("O'tkir");
    await form.getByLabel(texts.sex, { exact: true }).selectOption('male');
    await form.getByLabel(texts.birthDate, { exact: true }).fill('2014-03-02');
    await form.getByLabel(texts.grade, { exact: true }).selectOption('7');
    await form.getByLabel(texts.startsOn, { exact: true }).fill(today);
    await form.getByLabel(texts.contractNumber, { exact: true }).fill(contract);
    await form.getByLabel(texts.contractSignedOn, { exact: true }).fill(today);
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    const question = page.getByRole('alertdialog', { name: texts.setTitle });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: texts.saveAnyway, exact: true }).click();
    return form;
  }

  await add('Rahimov', 'E2E-STUDENT-1');
  await expect(page.getByRole('form', { name: texts.newTitle })).toHaveCount(0);
  await page.getByRole('searchbox', { name: en.list.search }).fill('Ўткир');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('9999001');
  await studentScreenshot(page, 'list');

  await page.getByRole('button', { name: 'Oʻtkir Rahimov', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Oʻtkir Rahimov' });
  await expect(panel.getByRole('tab', { name: texts.tabs.overview })).toBeVisible();
  await panel.getByRole('tab', { name: texts.tabs.contract }).click();
  await expect(panel.getByText(/E2E-STUDENT-1/)).toBeVisible();
  await studentScreenshot(page, 'profile');
  await panel.getByRole('button', { name: en.list.closePanel }).click();

  const form = await add('Qodirov', 'E2E-STUDENT-2');
  await expect(
    form.getByText(texts.takenHere.replace('{{student}}', 'Oʻtkir Rahimov (9999001)')),
  ).toBeVisible();
  await form.getByLabel(texts.uid, { exact: true }).scrollIntoViewIfNeeded();
  await studentScreenshot(page, 'uid-taken');
});
