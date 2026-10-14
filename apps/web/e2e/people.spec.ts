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

  await row.getByRole('button', { name: 'Qoʻchqorov Oybek' }).click();
  const panel = page.getByRole('complementary', { name: 'Oybek Qoʻchqorov' });
  // Task 2.7c-2b-2a: the panel reads first; each form opens behind its button.
  await panel.getByRole('button', { name: en.form.edit, exact: true }).click();
  const record = panel.getByRole('form', { name: 'Oybek Qoʻchqorov', exact: true });
  await expect(record.getByLabel(texts.sex, { exact: true })).toBeDisabled();
  await record.getByLabel(texts.phone, { exact: true }).fill('+998 93 555 44 34');
  await record.getByRole('button', { name: en.form.save, exact: true }).click();
  // The phone grouped (finding 24).
  await expect(row).toContainText('+998 93 555 44 34');

  await panel.getByRole('button', { name: texts.changeTeaching, exact: true }).click();
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
  // Grades as ranges (finding 19): the one grade 8.
  await expect(row.getByRole('cell', { name: '8', exact: true })).toBeVisible();

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

  await row.getByRole('button', { name: 'Mirzayev Shahzod' }).click();
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

  const shown = row.getByRole('img', { name: 'Mirzayev Shahzod' });
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
  await page.getByRole('link', { name: 'Valiyev Sherzod', exact: true }).click();
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
  // The slip keeps "First name Surname" (task 2.7b-1, decision 3).
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
    // Task 2.5a: a student is saved with a relative.
    await form.getByRole('checkbox', { name: en.people.relatives.noPhone }).check();
    await form.getByLabel(en.people.relatives.fullName, { exact: true }).fill('Dilfuza Rahimova');
    await form.getByLabel(en.people.relatives.relationship, { exact: true }).selectOption('mother');
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

  await page.getByRole('button', { name: 'Rahimov Oʻtkir', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Oʻtkir Rahimov' });
  await expect(panel.getByRole('radio', { name: texts.tabs.overview })).toBeVisible();
  await panel.getByText(texts.tabs.contract, { exact: true }).click();
  await expect(panel.getByText(/E2E-STUDENT-1/)).toBeVisible();
  await studentScreenshot(page, 'profile');
  await panel.getByRole('button', { name: en.list.closePanel }).click();

  const form = await add('Qodirov', 'E2E-STUDENT-2');
  await expect(
    form.getByText(texts.takenHere.replace('{{student}}', 'Rahimov Oʻtkir (9999001)')),
  ).toBeVisible();
  await form.getByLabel(texts.uid, { exact: true }).scrollIntoViewIfNeeded();
  await studentScreenshot(page, 'uid-taken');
});

// Task 2.4b-1 (docs/spec/04-people.md, Movements; edge/students-classes-groups):
// an Academic Vice Principal schedules a leaving for today (the list shows the
// badge), cancels it, records a leaving in the past, undoes it with a reason,
// records it again and brings the student back with a new contract, the UID
// unchanged in the list; then deletes a student created twice. With
// SCREENSHOTS=1 the screens are saved under docs/screens/2.4b-1/. All names
// are invented.
const LEAVING_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.4b-1');

async function leavingScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(LEAVING_SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(LEAVING_SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal records a leaving, undoes it, brings the student back and deletes a duplicate', async ({
  page,
}) => {
  const account = accountOf('leaving');
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
  await page.goto('/people/students');
  await expect(heading(page, en.people.students.title)).toBeVisible();

  const texts = en.people.students;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  const daysAgo = (days: number): string => {
    const [year, month, day] = today.split('-').map(Number);
    return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - days))
      .toISOString()
      .slice(0, 10);
  };
  async function add(uid: string, lastName: string, contract: string) {
    await page.getByRole('button', { name: texts.add, exact: true }).first().click();
    const form = page.getByRole('form', { name: texts.newTitle });
    await form.getByLabel(texts.uid, { exact: true }).fill(uid);
    await form.getByLabel(texts.lastName, { exact: true }).fill(lastName);
    await form.getByLabel(texts.firstName, { exact: true }).fill('Madina');
    await form.getByLabel(texts.sex, { exact: true }).selectOption('female');
    await form.getByLabel(texts.birthDate, { exact: true }).fill('2013-06-12');
    await form.getByLabel(texts.grade, { exact: true }).selectOption('8');
    await form.getByLabel(texts.startsOn, { exact: true }).fill(daysAgo(60));
    await form.getByLabel(texts.contractNumber, { exact: true }).fill(contract);
    await form.getByLabel(texts.contractSignedOn, { exact: true }).fill(daysAgo(61));
    // Task 2.5a: a student is saved with a relative.
    await form.getByRole('checkbox', { name: en.people.relatives.noPhone }).check();
    await form.getByLabel(en.people.relatives.fullName, { exact: true }).fill('Dilfuza Rahimova');
    await form.getByLabel(en.people.relatives.relationship, { exact: true }).selectOption('mother');
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    const question = page.getByRole('alertdialog', { name: texts.setTitle });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: texts.saveAnyway, exact: true }).click();
    await expect(page.getByRole('form', { name: texts.newTitle })).toHaveCount(0);
  }

  await add('9998001', 'Yoqubova', 'E2E-LEAVE-1');
  await page.getByRole('button', { name: 'Yoqubova Madina', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Madina Yoqubova' });

  async function leave(lastDay: string) {
    const form = panel.getByRole('form', { name: texts.leaveTitle });
    await form.getByLabel(texts.lastDay, { exact: true }).fill(lastDay);
    await form.getByLabel(texts.reason, { exact: true }).fill('The family moved to Samarkand.');
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    const question = page.getByRole('alertdialog', { name: texts.leaveConfirmTitle });
    await question.getByRole('button', { name: texts.leaveAction, exact: true }).click();
  }

  // Scheduled: the last day is today, so the student is inactive from tomorrow.
  await leave(today);
  const row = page.locator('tbody tr').filter({ hasText: '9998001' });
  await expect(row).toContainText(texts.statuses.active);
  await expect(row).toContainText(texts.inactiveFrom.replace('{{date}}', '').trim());
  await panel.getByRole('heading', { name: texts.statusTitle }).scrollIntoViewIfNeeded();
  await leavingScreenshot(page, 'scheduled');
  await panel.getByRole('button', { name: texts.cancelLeaving, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.cancelConfirmTitle })
    .getByRole('button', { name: texts.cancelLeaving, exact: true })
    .click();
  await expect(panel.getByRole('form', { name: texts.leaveTitle })).toBeVisible();
  await expect(row).not.toContainText(texts.inactiveFrom.replace('{{date}}', '').trim());

  // In the past: inactive now; undone with a reason.
  await leave(daysAgo(10));
  await expect(row).toContainText(texts.statuses.inactive);
  const undo = panel.getByRole('form', { name: texts.undoTitle });
  await undo.getByLabel(texts.reason, { exact: true }).fill('Entered for the wrong student.');
  await undo.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(row).toContainText(texts.statuses.active);

  // Again, then back with a new contract: the same UID, every row kept.
  await leave(daysAgo(10));
  await expect(row).toContainText(texts.statuses.inactive);
  const back = panel.getByRole('form', { name: texts.returnTitle });
  await back.getByLabel(texts.returnFrom, { exact: true }).fill(daysAgo(3));
  await back.getByLabel(texts.contractNumber, { exact: true }).fill('E2E-LEAVE-1R');
  await back.getByLabel(texts.contractSignedOn, { exact: true }).fill(daysAgo(3));
  await back.getByRole('button', { name: en.form.save, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.returnConfirmTitle })
    .getByRole('button', { name: texts.returnTitle, exact: true })
    .click();
  await expect(row).toContainText(texts.statuses.active);
  // Every row kept: the time before the leaving, the time away and the return (the
  // undone leaving and the second one share their first day, so one inactive row stays).
  const history = panel
    .getByRole('list')
    .filter({ hasText: texts.causes.start })
    .getByRole('listitem');
  await expect(history).toHaveCount(3);
  for (const [index, cause] of (['start', 'leaving', 'return'] as const).entries()) {
    await expect(history.nth(index)).toContainText(texts.causes[cause]);
  }
  await panel.getByRole('heading', { name: texts.statusTitle }).scrollIntoViewIfNeeded();
  await leavingScreenshot(page, 'returned');
  await panel.getByRole('button', { name: en.list.closePanel }).click();

  // A student created twice by mistake, deleted with a reason.
  await add('9998002', 'Yoqubovaa', 'E2E-LEAVE-2');
  await page.getByRole('button', { name: 'Yoqubovaa Madina', exact: true }).click();
  const twice = page.getByRole('complementary', { name: 'Madina Yoqubovaa' });
  const remove = twice.getByRole('form', { name: texts.deleteTitle });
  await remove.getByLabel(texts.reason, { exact: true }).fill('Created twice by mistake.');
  await remove.getByRole('button', { name: en.form.save, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.deleteConfirmTitle })
    .getByRole('button', { name: texts.deleteAction, exact: true })
    .click();
  await expect(twice.getByText(texts.deleted, { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: '9998002' })).toHaveCount(0);
  await leavingScreenshot(page, 'deleted');
});

// Task 2.4b-2, pull request #70: an Academic Vice Principal adds two students,
// filters the active students without consent (answer 23), exports a ticked
// row with the identity group (the columns the server wrote are read from the
// answer's X-Export-Columns), adds a student photo, and finds the "No class"
// counter on the home page, whose link opens the rows it counts. What each
// role may export, and the cells of the file, are proved by the API tests,
// which read the file back. With SCREENSHOTS=1 the list and the home page are
// saved for the report under docs/screens/2.4b-2/. All names are invented.
const EXPORT_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.4b-2');

async function exportScreenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(EXPORT_SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(EXPORT_SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal exports students with their documents, adds a photo and sees the No class counter', async ({
  page,
}) => {
  const account = accountOf('studentExport');
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
  await page.goto('/people/students');
  await expect(heading(page, en.people.students.title)).toBeVisible();

  const texts = en.people.students;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  const daysAgo = (days: number): string => {
    const [year, month, day] = today.split('-').map(Number);
    return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - days))
      .toISOString()
      .slice(0, 10);
  };
  async function add(uid: string, lastName: string, contract: string, consent: string | null) {
    await page.getByRole('button', { name: texts.add, exact: true }).first().click();
    const form = page.getByRole('form', { name: texts.newTitle });
    await form.getByLabel(texts.uid, { exact: true }).fill(uid);
    await form.getByLabel(texts.lastName, { exact: true }).fill(lastName);
    await form.getByLabel(texts.firstName, { exact: true }).fill('Kamola');
    await form.getByLabel(texts.sex, { exact: true }).selectOption('female');
    await form.getByLabel(texts.birthDate, { exact: true }).fill('2013-07-14');
    await form.getByLabel(texts.grade, { exact: true }).selectOption('8');
    await form.getByLabel(texts.startsOn, { exact: true }).fill(daysAgo(40));
    await form.getByLabel(texts.jshshir, { exact: true }).fill(`3140713${uid}`);
    if (consent !== null) {
      await form.getByLabel(texts.consentSignedOn, { exact: true }).fill(consent);
    }
    await form.getByLabel(texts.contractNumber, { exact: true }).fill(contract);
    await form.getByLabel(texts.contractSignedOn, { exact: true }).fill(daysAgo(41));
    // Task 2.5a: a student is saved with a relative.
    await form.getByRole('checkbox', { name: en.people.relatives.noPhone }).check();
    await form.getByLabel(en.people.relatives.fullName, { exact: true }).fill('Dilfuza Rahimova');
    await form.getByLabel(en.people.relatives.relationship, { exact: true }).selectOption('mother');
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    const question = page.getByRole('alertdialog', { name: texts.setTitle });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: texts.saveAnyway, exact: true }).click();
    await expect(page.getByRole('form', { name: texts.newTitle })).toHaveCount(0);
  }
  await add('9997001', 'Ergasheva', 'E2E-EXPORT-1', null);
  await add('9997002', 'Musayeva', 'E2E-EXPORT-2', daysAgo(45));
  await expect(page.locator('tbody tr')).toHaveCount(2);

  // Answer 23: the active students without consent.
  await page.getByRole('combobox', { name: texts.consent }).selectOption('missing');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Ergasheva Kamola');
  await page.getByRole('button', { name: en.list.clearSearch, exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);

  // A ticked row, with the documents, birth date and address added to the file.
  await page.locator('tbody tr').filter({ hasText: '9997002' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: en.list.exportAlso, exact: true }).click();
  await page
    .getByRole('menuitemcheckbox', { name: texts.exportGroups.identity, exact: true })
    .click();
  await page.keyboard.press('Escape');
  await exportScreenshot(page, 'list');
  const answer = page.waitForResponse((response) =>
    response.url().endsWith('/api/people/students/export'),
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Export 1 ticked$/ }).click();
  expect((await answer).headers()['x-export-columns']).toBe(
    'uid,name,class,status,birthDate,documentType,documentNumber,jshshir,address,region',
  );
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Students-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(statSync(await file.path()).size).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // A photo, shrunk by the browser and shown in the photo column.
  const row = page.locator('tbody tr').filter({ hasText: '9997001' });
  await row.getByRole('button', { name: 'Ergasheva Kamola' }).click();
  const panel = page.getByRole('complementary', { name: 'Kamola Ergasheva' });
  await panel.getByLabel(en.people.staff.photo.add).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: pngOf(1600, 1200),
  });
  await expect(panel.getByRole('button', { name: en.people.staff.photo.change })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Ergasheva Kamola' })).toHaveAttribute(
    'src',
    /^data:image\/jpeg;base64,/,
  );

  // The counter of the home page, and the rows its link opens.
  await page.goto('/');
  const counter = page.getByRole('region', { name: en.home.noClass.title });
  await expect(counter.locator('[data-count]')).toHaveText('2');
  await exportScreenshot(page, 'home');
  await counter.getByRole('link', { name: en.home.noClass.link }).click();
  await expect(heading(page, texts.title)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

// Task 2.5a, pull request #72 (docs/spec/04-people.md, Close relatives;
// edge/close-relatives): an Academic Vice Principal of two branches adds a
// student with a new relative, then in the other branch a student whose
// relative is found by the same phone and linked; the Parents page shows one
// record with the student of the other branch as a count. All names and
// phones are invented.
test('an Academic Vice Principal links one relative to students of two branches', async ({
  page,
}) => {
  const account = accountOf('relatives');
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

  const texts = en.people.students;
  const relatives = en.people.relatives;
  const phone = '+998 90 555 01 25';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  async function add(uid: string, lastName: string, contract: string, found: boolean) {
    await page.getByRole('button', { name: texts.add, exact: true }).first().click();
    const form = page.getByRole('form', { name: texts.newTitle });
    await form.getByLabel(texts.uid, { exact: true }).fill(uid);
    await form.getByLabel(texts.lastName, { exact: true }).fill(lastName);
    await form.getByLabel(texts.firstName, { exact: true }).fill('Nodira');
    await form.getByLabel(texts.sex, { exact: true }).selectOption('female');
    await form.getByLabel(texts.birthDate, { exact: true }).fill('2014-06-02');
    await form.getByLabel(texts.grade, { exact: true }).selectOption('7');
    await form.getByLabel(texts.startsOn, { exact: true }).fill(today);
    await form.getByLabel(texts.contractNumber, { exact: true }).fill(contract);
    await form.getByLabel(texts.contractSignedOn, { exact: true }).fill(today);
    // The phone typed first (04, Adding a relative).
    await form.getByLabel(relatives.phone, { exact: true }).fill(phone);
    await form.getByLabel(relatives.phone, { exact: true }).blur();
    if (found) {
      await expect(
        form.getByText(
          relatives.found_one.replace('{{name}}', 'Gulnora Tursunova').replace('{{count}}', '1'),
        ),
      ).toBeVisible();
    } else {
      await form.getByLabel(relatives.fullName, { exact: true }).fill('Gulnora Tursunova');
    }
    await form.getByLabel(relatives.relationship, { exact: true }).selectOption('mother');
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    const question = page.getByRole('alertdialog', { name: texts.setTitle });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: texts.saveAnyway, exact: true }).click();
    await expect(page.getByRole('form', { name: texts.newTitle })).toHaveCount(0);
  }

  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await add('9999201', 'Tursunova', 'E2E-RELATIVE-1', false);

  // The other branch: the same phone finds the same person.
  const branches = page.getByRole('combobox', { name: en.switcher.branch, exact: true });
  const other = await branches.locator('option:not(:checked)').first().getAttribute('value');
  await branches.selectOption(other ?? '');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await add('9999202', 'Rasulova', 'E2E-RELATIVE-2', true);

  await page.goto('/people/parents');
  await expect(heading(page, relatives.title)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Gulnora Tursunova', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Gulnora Tursunova' });
  await expect(
    panel.getByText(relatives.elsewhereCount_one.replace('{{count}}', '1'), { exact: true }),
  ).toBeVisible();
  await studentScreenshot(page, 'parents');
});

// Task 2.5b-1, pull request #73 (edge/close-relatives, rows 1 and 2): the
// Academic Vice Principal of branch A types a phone held by a relative of
// branch B, chooses "the number has a new owner" with "no valid phone"; the
// Academic Vice Principal of branch B is told in the app and finds that
// relative under "No valid phone". All names and phones are invented.
test('the number of a relative of another branch gets a new owner, and that branch is told', async ({
  page,
}) => {
  const relatives = en.people.relatives;
  const texts = en.people.students;
  async function firstSignIn(who: 'phoneOwners' | 'phoneOwnersOther') {
    const account = accountOf(who);
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
  }

  await firstSignIn('phoneOwners');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const form = page.getByRole('form', { name: texts.newTitle });
  await form.getByLabel(texts.uid, { exact: true }).fill('9999302');
  await form.getByLabel(texts.lastName, { exact: true }).fill('Rasulova');
  await form.getByLabel(texts.firstName, { exact: true }).fill('Madina');
  await form.getByLabel(texts.sex, { exact: true }).selectOption('female');
  await form.getByLabel(texts.birthDate, { exact: true }).fill('2014-06-02');
  await form.getByLabel(texts.grade, { exact: true }).selectOption('7');
  await form.getByLabel(texts.startsOn, { exact: true }).fill(today);
  await form.getByLabel(texts.contractNumber, { exact: true }).fill('E2E-OWNERS-2');
  await form.getByLabel(texts.contractSignedOn, { exact: true }).fill(today);
  await form.getByLabel(relatives.phone, { exact: true }).fill('+998 90 555 01 37');
  await form.getByLabel(relatives.phone, { exact: true }).blur();
  const choice = form.getByLabel(relatives.ownerChoice.replace('{{name}}', 'Zarina Aliyeva'), {
    exact: true,
  });
  await expect(choice).toBeVisible();
  await choice.selectOption('new_owner');
  await form.getByLabel(relatives.fullName, { exact: true }).fill('Nodira Rasulova');
  await form
    .getByRole('checkbox', {
      name: relatives.previousUnknown.replace('{{name}}', 'Zarina Aliyeva'),
    })
    .check();
  await form.getByLabel(relatives.relationship, { exact: true }).selectOption('mother');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  const question = page.getByRole('alertdialog', { name: texts.setTitle });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: texts.saveAnyway, exact: true }).click();
  await expect(page.getByRole('form', { name: texts.newTitle })).toHaveCount(0);

  // The other branch's Academic Vice Principal.
  await page.context().clearCookies();
  await firstSignIn('phoneOwnersOther');
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread', exact: true });
  await expect(bell).toBeVisible();
  await bell.click();
  const dialog = page.getByRole('dialog', { name: en.notifications.title });
  await expect(
    dialog.getByText(
      en.notifications.kinds.relative.phone_changed.replace('{{fullName}}', 'Zarina Aliyeva'),
    ),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/people/parents?f=%7B%22phone%22%3A%22no_valid_phone%22%7D');
  await expect(heading(page, relatives.title)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('Zarina Aliyeva');
  await expect(page.locator('tbody tr').first()).toContainText(relatives.noValidPhone);
});

// Task 2.5b-2 (edge/close-relatives, rows 5 and 8): the Academic Vice
// Principal gives a parent an extra phone, marks the parent as the same
// person as a teacher of the branch, and opens the teacher's panel from the
// Parent panel, where the teacher is shown as also a parent. The seed gives
// the branch a student whose mother Kamola Yusupova holds +998 90 555 01 41
// and the teacher Farrux Yusupov (S-269401). All names and phones are invented.
test('an Academic Vice Principal gives a parent an extra phone and marks them as a teacher of the branch', async ({
  page,
}) => {
  const account = accountOf('samePerson');
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

  const relatives = en.people.relatives;
  await page.goto('/people/parents');
  await expect(heading(page, relatives.title)).toBeVisible();
  await page.getByRole('button', { name: 'Kamola Yusupova', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Kamola Yusupova' });

  // An extra phone, saved with the record.
  const form = panel.getByRole('form', {
    name: relatives.formLabel.replace('{{name}}', 'Kamola Yusupova'),
  });
  await form.getByRole('button', { name: relatives.addExtraPhone, exact: true }).click();
  await form
    .getByLabel(relatives.extraPhone.replace('{{n}}', '1'), { exact: true })
    .fill('+998 93 555 01 42');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.locator('dt', { hasText: relatives.extraPhones }).locator('+ dd')).toHaveText(
    '+998 93 555 01 42',
  );

  // The same person as a teacher of the branch, found by name.
  const same = panel.getByRole('region', { name: relatives.sameTitle });
  await same.getByRole('button', { name: relatives.markStaff, exact: true }).click();
  await same.getByLabel(relatives.staffSearch, { exact: true }).fill('Yusupov');
  await same
    .getByLabel(relatives.staffChoice, { exact: true })
    .selectOption({ label: 'Yusupov Farrux (S-269401)' });
  await same.getByRole('button', { name: relatives.markSave, exact: true }).click();
  const link = same.getByRole('link', { name: 'Yusupov Farrux', exact: true });
  await expect(link).toBeVisible();
  await expect(
    same.getByText(relatives.staffIdOf.replace('{{staffId}}', 'S-269401'), { exact: true }),
  ).toBeVisible();
  await studentScreenshot(page, 'same-person');

  // The teacher's panel, opened from the Parent panel, names the parent.
  await link.click();
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  const staffPanel = page.getByRole('complementary', { name: 'Farrux Yusupov' });
  await expect(
    staffPanel
      .locator('dt', { hasText: en.people.staff.alsoParent })
      .locator('+ dd')
      .getByRole('link', { name: 'Kamola Yusupova', exact: true }),
  ).toBeVisible();
});
