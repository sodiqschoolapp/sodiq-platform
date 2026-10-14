import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, type AccountKey } from './accounts';
import {
  changeFirstPassword,
  checkNewRecord,
  checkPage,
  heading,
  languageChooser,
  signIn,
} from './steps';
import { codeNow } from './totp';

/**
 * The first sign-in of a seeded Super Admin or Academic Vice Principal: the
 * forced password change and the required second step.
 */
async function signInAsSuperAdmin(
  page: Page,
  accountKey: AccountKey = 'superAdmin',
): Promise<void> {
  const account = accountOf(accountKey);
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

/** A page of school setup, opened from the menu and its links. */
async function openSetupPage(page: Page, link: string, title: string): Promise<void> {
  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.setup) })
    .click();
  await expect(heading(page, en.setup.title)).toBeVisible();
  // The links of the page, not the items of the setup checklist above them.
  await page
    .getByRole('list', { name: en.setup.title })
    .getByRole('link', { name: link, exact: true })
    .click();
  await expect(heading(page, title)).toBeVisible();
}

const saved = (scope: Page | ReturnType<Page['getByRole']>) =>
  scope.getByRole('status').filter({ hasText: en.form.saved });

const confirmWith = async (page: Page, action: string): Promise<void> => {
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toBeHidden();
};

/**
 * Task 2.7c-1 (pull request #80, decision 8): the pages that only the Super
 * Admin reaches, against the design system in light, dark and at phone width:
 * the Branch page with the "New branch" side panel open, the travel time as a
 * form, and the audit log of the whole school. The seed holds no fourth Super
 * Admin, so this runs at the end of the first test's session.
 */
async function checkSuperAdminPages(page: Page): Promise<void> {
  await page.goto('/setup/branch');
  await expect(heading(page, en.setup.branch.title)).toBeVisible();
  await page.getByRole('button', { name: en.setup.branch.newBranch, exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: en.setup.branch.newBranchTitle }),
  ).toBeVisible();
  await checkPage(page, 'setup-branch-new');
  await page.goto('/setup/travel-times');
  await expect(heading(page, en.setup.travelTimes.title)).toBeVisible();
  await expect(page.getByRole('form').first()).toBeVisible();
  await checkPage(page, 'setup-travel-times-edit');
  await page.goto('/audit');
  await expect(heading(page, en.audit.title)).toBeVisible();
  await checkPage(page, 'audit-super-admin');
  // Task 2.7c-2a: the lists only the Super Admin adds to, with the new record
  // in the side panel. Nothing is saved.
  // In the branch of the pages test, which keeps an active floor: the floor
  // of this test's branch is archived by now, and "Add room" needs one.
  await page.goto('/setup/buildings');
  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Pages browser test branch' });
  for (const [name, address, title, add, newTitle] of [
    [
      'setup-buildings',
      '/setup/buildings',
      en.setup.buildings.title,
      en.setup.buildings.add,
      en.setup.buildings.newTitle,
    ],
    [
      'setup-rooms',
      '/setup/rooms',
      en.setup.rooms.title,
      en.setup.rooms.add,
      en.setup.rooms.newTitle,
    ],
    [
      'setup-divisions',
      '/setup/divisions',
      en.setup.divisions.title,
      en.setup.divisions.add,
      en.setup.divisions.newTitle,
    ],
    [
      'setup-years',
      '/setup/years',
      en.setup.years.title,
      en.setup.years.add,
      en.setup.years.newTitle,
    ],
    [
      'people-staff',
      '/people/staff',
      en.people.staff.title,
      en.people.staff.add,
      en.people.staff.newTitle,
    ],
  ] as const) {
    await page.goto(address);
    await expect(heading(page, title)).toBeVisible();
    await checkNewRecord(page, name, add, newTitle);
  }
  // Task 2.7c-2b-1: the records only the Super Admin changes, read with their
  // actions at the bottom and with Edit pressed. Nothing is saved.
  for (const [name, address, title, record] of [
    ['setup-buildings', '/setup/buildings', en.setup.buildings.title, 'Main building'],
    ['setup-rooms', '/setup/rooms', en.setup.rooms.title, '201'],
    ['setup-divisions', '/setup/divisions', en.setup.divisions.title, 'Pages division'],
  ] as const) {
    await page.goto(address);
    await expect(heading(page, title)).toBeVisible();
    await page.getByRole('button', { name: record, exact: true }).first().click();
    const panel = page.getByRole('complementary', { name: record });
    await expect(panel.locator('[data-slot="panel-actions"]')).toBeVisible();
    await checkPage(page, `${name}-record-super-admin`);
    await panel.getByRole('button', { name: en.form.edit, exact: true }).click();
    await expect(panel.getByRole('form', { name: record })).toBeVisible();
    await checkPage(page, `${name}-edit`);
  }
  await page.goto('/setup/years');
  await expect(heading(page, en.setup.years.title)).toBeVisible();
  await page
    .locator('table')
    .last()
    .locator('tbody tr')
    .first()
    .getByRole('button')
    .first()
    .click();
  const year = page.getByRole('complementary');
  await expect(year.locator('[data-slot="panel-actions"]')).toBeVisible();
  await checkPage(page, 'setup-years-record-super-admin');
  await year.getByRole('button', { name: en.form.edit, exact: true }).click();
  await expect(year.getByRole('form')).toBeVisible();
  await checkPage(page, 'setup-years-edit');
  // Task 2.7c-2b-2a: the staff record of the pages branch, read, and with each
  // form only the Super Admin opens there (the role forms need an account,
  // which this person has not: the page tests open them). Nothing is saved.
  await page.goto('/people/staff');
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  await page.getByRole('button', { name: 'Saidova Lola', exact: true }).click();
  const staff = page.getByRole('complementary', { name: 'Lola Saidova' });
  await expect(staff.locator('[data-slot="panel-actions"]')).toBeVisible();
  await checkPage(page, 'people-staff-record-super-admin');
  for (const [name, opener] of [
    ['people-staff-super-admin', en.form.edit],
    ['people-staff-status', en.people.staff.changeStatus],
    ['people-staff-branches', en.people.staff.changeBranches],
    ['people-staff-account', en.people.account.create],
  ] as const) {
    await staff.getByRole('button', { name: opener, exact: true }).click();
    await expect(staff.getByRole('form')).toBeVisible();
    await checkPage(page, `${name}-edit`);
    await staff.getByRole('button', { name: en.form.cancel, exact: true }).click();
    await expect(staff.getByRole('form')).toHaveCount(0);
  }
}

/**
 * Task 2.6b, done when: "the Super Admin prints the report of a student and
 * the log holds the entry". The student of the Audit log's seed, in a branch
 * of its own; the print itself is stubbed, the print mode is read. The seed
 * holds at most three Super Admins, all taken by the setup tests, so this
 * runs as the second half of the first test's session.
 */
async function printPersonalDataReport(page: Page): Promise<void> {
  await page.goto('/people/students');
  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Audit browser test branch' });
  await expect(heading(page, en.people.students.title)).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Murodova' }).getByRole('button').first().click();
  const panel = page.getByRole('complementary', { name: 'Oydin Murodova' });
  await panel.getByRole('link', { name: en.people.report.link, exact: true }).click();

  await expect(heading(page, en.people.report.title)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Murodova Oydin', level: 2 })).toBeVisible();
  // Identity plainly, and the relative of the student.
  await expect(page.getByText('Bodomzor 9').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Feruza Murodova', level: 4 })).toBeVisible();
  // The page against the design system (task 2.7c-1): no other role reaches it.
  await checkPage(page, 'people-report');
  // The browser's print dialog is replaced by a note of the print mode it saw.
  await page.evaluate(
    "window.print = () => { document.body.dataset.printed = document.body.dataset.printing ?? ''; }",
  );
  await page.getByRole('button', { name: en.people.report.print, exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'report');

  await page.goto('/audit');
  await expect(heading(page, en.audit.title)).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: en.audit.actions.student.personal_data_report }),
  ).toHaveCount(1);
}

// docs/build-plan.md, task 1.1, done when: "the Super Admin can create and
// edit them". docs/spec/03-school-setup.md: the branch record; buildings,
// floors and rooms ("Rooms are added floor by floor"). Archive refused while
// a room on the floor is in use, allowed once it is closed (decided by the
// owner, pull request #37, answer 7).
test('the Super Admin edits the branch, adds a building, a floor and a room, and archives the floor once its room is closed, then prints a personal data report', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAsSuperAdmin(page);

  // The branch: a working Saturday is ticked and saved.
  await openSetupPage(page, en.setup.branchLink, en.setup.branch.title);
  const branchForm = page.getByRole('form').first();
  await branchForm.getByLabel('Saturday', { exact: true }).check();
  await branchForm.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(saved(branchForm)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('form').first().getByLabel('Saturday', { exact: true }),
  ).toBeChecked();

  // A building with a floor.
  await openSetupPage(page, en.setup.buildingsLink, en.setup.buildings.title);
  // In the header and, while the list is empty, as the first action of the page.
  await page.getByRole('button', { name: en.setup.buildings.add, exact: true }).first().click();
  const newBuilding = page.getByRole('form', { name: en.setup.buildings.newTitle });
  await newBuilding.getByLabel(en.setup.buildings.name, { exact: true }).fill('Main building');
  await newBuilding.getByRole('button', { name: en.form.save, exact: true }).click();
  await page.getByRole('button', { name: 'Main building', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Main building' });
  // Task 2.7c-2b-1: the forms of a panel open behind a button.
  await panel.getByRole('button', { name: en.setup.buildings.addFloor, exact: true }).click();
  const newFloor = panel.getByRole('form', { name: en.setup.buildings.newFloor });
  await newFloor.getByLabel(en.setup.buildings.floorName, { exact: true }).fill('Ground');
  await newFloor.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByRole('row').filter({ hasText: 'Ground' })).toBeVisible();

  // A room on that floor, in the room list.
  await openSetupPage(page, en.setup.roomsLink, en.setup.rooms.title);
  await page.getByRole('button', { name: en.setup.rooms.add, exact: true }).first().click();
  const newRoom = page.getByRole('form', { name: en.setup.rooms.newTitle });
  await newRoom.getByLabel(en.setup.rooms.name, { exact: true }).fill('101');
  await newRoom
    .getByLabel(en.setup.rooms.building, { exact: true })
    .selectOption({ label: 'Main building' });
  await newRoom.getByLabel(en.setup.rooms.floor, { exact: true }).selectOption({ label: 'Ground' });
  await newRoom.getByLabel(en.setup.rooms.capacity, { exact: true }).fill('28');
  await newRoom.getByRole('button', { name: en.form.save, exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: '101' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(en.setup.rooms.statuses.in_use);

  // The floor cannot be archived while the room is in use.
  await openSetupPage(page, en.setup.buildingsLink, en.setup.buildings.title);
  await page.getByRole('button', { name: 'Main building', exact: true }).click();
  await panel
    .getByRole('button', { name: en.setup.buildings.archiveNamed.replace('{{name}}', 'Ground') })
    .click();
  await confirmWith(page, en.setup.buildings.archive);
  await expect(panel.getByRole('alert')).toHaveText(en.errors.archive_refused);

  // Closed, the room no longer stands in the way.
  await openSetupPage(page, en.setup.roomsLink, en.setup.rooms.title);
  await page.getByRole('button', { name: '101', exact: true }).click();
  const roomPanel = page.getByRole('complementary', { name: '101' });
  await roomPanel.getByRole('button', { name: en.form.edit, exact: true }).click();
  const roomForm = roomPanel.getByRole('form');
  await roomForm.getByLabel(en.setup.rooms.status, { exact: true }).selectOption('closed');
  await roomForm.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(saved(roomPanel)).toBeVisible();

  await openSetupPage(page, en.setup.buildingsLink, en.setup.buildings.title);
  await page.getByRole('button', { name: 'Main building', exact: true }).click();
  await panel
    .getByRole('button', { name: en.setup.buildings.archiveNamed.replace('{{name}}', 'Ground') })
    .click();
  await confirmWith(page, en.setup.buildings.archive);
  await expect(panel.getByRole('row').filter({ hasText: 'Ground' })).toContainText(
    en.setup.buildings.archived,
  );

  await printPersonalDataReport(page);
  await checkSuperAdminPages(page);
});

// docs/build-plan.md, task 1.2, done when: "Academic cannot be renamed or
// archived". docs/spec/03-school-setup.md, Divisions: "Academic is built in";
// "Other divisions are data. The Super Admin adds, renames and archives them";
// departments archived with their division (decided by the owner, pull
// request #40, answer 4).
test('the Super Admin sees Academic as built in, adds a division with a department, renames the department and archives the division with it, then creates an account, gives a role and appoints a Head Teacher', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signInAsSuperAdmin(page, 'divisions');

  await openSetupPage(page, en.setup.divisionsLink, en.setup.divisions.title);
  await expect(page.getByRole('row').filter({ hasText: 'Academic' })).toBeVisible();

  // Academic: shown, not edited; no archive.
  await page.getByRole('button', { name: 'Academic', exact: true }).click();
  const academic = page.getByRole('complementary', { name: 'Academic' });
  await expect(academic.getByText(en.setup.divisions.builtIn)).toBeVisible();
  await expect(academic.getByRole('form', { name: 'Academic' })).toHaveCount(0);
  await expect(
    academic.getByRole('button', { name: en.setup.divisions.archiveDivision, exact: true }),
  ).toHaveCount(0);
  await expect(academic.getByRole('row').filter({ hasText: 'Tutors' })).toBeVisible();

  // A new division with a department.
  await page.getByRole('button', { name: en.setup.divisions.add, exact: true }).first().click();
  const newDivision = page.getByRole('form', { name: en.setup.divisions.newTitle });
  await newDivision.getByLabel(en.setup.divisions.nameUz, { exact: true }).fill('Sport');
  await newDivision.getByLabel(en.setup.divisions.nameRu, { exact: true }).fill('Спорт');
  await newDivision.getByLabel(en.setup.divisions.nameEn, { exact: true }).fill('Sports');
  await newDivision.getByRole('button', { name: en.form.save, exact: true }).click();
  await page.getByRole('button', { name: 'Sports', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Sports' });
  await panel.getByRole('button', { name: en.setup.divisions.addDepartment, exact: true }).click();
  const newDepartment = panel.getByRole('form', { name: en.setup.divisions.newDepartment });
  await newDepartment.getByLabel(en.setup.divisions.nameUz, { exact: true }).fill('Suzish');
  await newDepartment.getByLabel(en.setup.divisions.nameRu, { exact: true }).fill('Плавание');
  await newDepartment.getByLabel(en.setup.divisions.nameEn, { exact: true }).fill('Swimming');
  await newDepartment.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByRole('row').filter({ hasText: 'Swimming' })).toBeVisible();

  // The department renamed.
  await panel
    .getByRole('button', { name: en.setup.divisions.renameNamed.replace('{{name}}', 'Swimming') })
    .click();
  const rename = panel.getByRole('form', { name: 'Swimming' });
  await rename.getByLabel(en.setup.divisions.nameEn, { exact: true }).fill('Pool');
  await rename.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByRole('row').filter({ hasText: 'Pool' })).toBeVisible();

  // The division archived takes its department with it.
  await panel
    .getByRole('button', { name: en.setup.divisions.archiveDivision, exact: true })
    .click();
  await confirmWith(page, en.setup.divisions.archive);
  await expect(panel.getByRole('row').filter({ hasText: 'Pool' })).toContainText(
    en.setup.divisions.archived,
  );
  await expect(page.getByRole('row').filter({ hasText: 'Sports' })).toContainText(
    en.setup.divisions.archived,
  );

  await test.step('creates an account, gives a role and signs in with the slip', () =>
    createAccountAndSignIn(page));

  await test.step('appoints a Head Teacher of two subjects and is refused a second one', () =>
    appointHeadTeachers(page));

  await test.step('sees the alert of a branch without an Academic Vice Principal and the Head Teachers list', () =>
    headTeachersAndAlert(page));
});

// Task 2.3a, pull request #62: the account section of a staff record. With
// SCREENSHOTS=1 the slip is saved for the report under docs/screens/2.3a/.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.3a');

/**
 * The Super Admin creates the account of a person with the suggested login,
 * reads the first-password slip once and gives the Teacher role; the person
 * signs in with the slip, changes the password and sees their name in the
 * menu. The seed holds at most three Super Admins, all taken by the setup
 * tests, so this runs as the second half of the divisions test's session.
 */
async function createAccountAndSignIn(page: Page): Promise<void> {
  await page.goto('/people/staff');
  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Accounts browser test branch' });
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  await page.getByRole('button', { name: 'Aminova Feruza', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Feruza Aminova' });
  const section = panel.getByRole('region', { name: en.people.account.title });
  // Task 2.7c-2b-2a: each form of the section opens behind its button.
  await section.getByRole('button', { name: en.people.account.create, exact: true }).click();
  const create = section.getByRole('form', {
    name: en.people.account.createOf.replace('{{name}}', 'Feruza Aminova'),
  });
  await expect(create.getByLabel(en.people.account.login, { exact: true })).toHaveValue(
    'f.aminova',
  );
  await create.getByRole('button', { name: en.form.save, exact: true }).click();

  const slip = page.getByRole('dialog', { name: en.people.account.slipTitle });
  await expect(slip.getByText('f.aminova', { exact: true })).toBeVisible();
  const password = await slip.locator('dd').nth(1).innerText();
  expect(password).toMatch(/^[A-Za-z0-9]{16}$/);
  if (process.env.SCREENSHOTS === '1') {
    mkdirSync(SCREENS, { recursive: true });
    await page.waitForTimeout(400);
    await slip.screenshot({ path: path.join(SCREENS, 'slip.png') });
  }
  await slip.getByRole('button', { name: en.people.account.closeSlip, exact: true }).click();
  await expect(slip).toBeHidden();
  await expect(page.getByText(password)).toHaveCount(0);

  await section.getByRole('button', { name: en.people.account.give, exact: true }).click();
  const give = section.getByRole('form', {
    name: en.people.account.giveOf.replace('{{name}}', 'Feruza Aminova'),
  });
  await give.getByLabel(en.people.account.newRole, { exact: true }).selectOption('teacher');
  await give.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(section.locator('tr[data-role="teacher"]')).toContainText(
    en.people.account.states.current,
  );
  if (process.env.SCREENSHOTS === '1') {
    await section.screenshot({ path: path.join(SCREENS, 'account-section.png') });
  }

  // The person signs in with the slip, in a browser of their own.
  const other = await page.context().browser()?.newContext();
  if (other === undefined) {
    throw new Error('No second browser context.');
  }
  const person = await other.newPage();
  await person.goto('/sign-in');
  await languageChooser(person).selectOption('en');
  await signIn(person, en, 'f.aminova', password);
  await changeFirstPassword(person, en, { login: 'f.aminova', password });
  await expect(heading(person, en.home.title)).toBeVisible();
  await expect(person.getByRole('button', { name: en.layout.account, exact: true })).toContainText(
    'Feruza Aminova',
  );
  await other.close();
}

// Task 2.3b-1, pull request #63: Head Teacher appointments. With
// SCREENSHOTS=1 the account section is saved under docs/screens/2.3b-1/.
const APPOINTMENT_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.3b-1');

/** The give form of the account section of a person in the open staff list. */
async function giveFormOf(page: Page, firstName: string, lastName: string) {
  // Surname first in the list, "First name Surname" in the panel (finding 27).
  await page.getByRole('button', { name: `${lastName} ${firstName}`, exact: true }).click();
  const name = `${firstName} ${lastName}`;
  const panel = page.getByRole('complementary', { name });
  const section = panel.getByRole('region', { name: en.people.account.title });
  // Task 2.7c-2b-2a: the form opens behind its button.
  await section.getByRole('button', { name: en.people.account.give, exact: true }).click();
  const give = section.getByRole('form', {
    name: en.people.account.giveOf.replace('{{name}}', name),
  });
  return { section, give };
}

/**
 * The Super Admin appoints Nazarov Rustam Head Teacher of Algebra and
 * Trigonometry in the branch, and is refused Yusupova Saida as a second Head
 * Teacher of Algebra (`02`, One per subject per branch). Runs in the session
 * of the divisions test, after the account test, for the same reason.
 */
async function appointHeadTeachers(page: Page): Promise<void> {
  await page.goto('/people/staff');
  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Accounts browser test branch' });
  await expect(heading(page, en.people.staff.title)).toBeVisible();

  const first = await giveFormOf(page, 'Rustam', 'Nazarov');
  await first.give
    .getByLabel(en.people.account.newRole, { exact: true })
    .selectOption('head_teacher');
  const subjects = first.give.getByRole('group', { name: en.people.account.subjects });
  await subjects.getByLabel('Algebra', { exact: true }).check();
  await subjects.getByLabel('Trigonometry', { exact: true }).check();
  await first.give.getByRole('button', { name: en.form.save, exact: true }).click();
  const row = first.section.locator('tr[data-role="head_teacher"]');
  await expect(row).toContainText(en.people.account.states.current);
  await expect(row.locator('[data-subjects]')).toHaveText('Algebra, Trigonometry');
  if (process.env.SCREENSHOTS === '1') {
    mkdirSync(APPOINTMENT_SCREENS, { recursive: true });
    await first.section.screenshot({ path: path.join(APPOINTMENT_SCREENS, 'appointment.png') });
  }

  const second = await giveFormOf(page, 'Saida', 'Yusupova');
  await second.give
    .getByLabel(en.people.account.newRole, { exact: true })
    .selectOption('head_teacher');
  await second.give
    .getByRole('group', { name: en.people.account.subjects })
    .getByLabel('Algebra', { exact: true })
    .check();
  await second.give.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(second.give.getByText(en.errors.head_teacher_taken)).toBeVisible();
  await expect(second.section.locator('tr[data-role="head_teacher"]')).toHaveCount(0);
  if (process.env.SCREENSHOTS === '1') {
    await second.section.screenshot({ path: path.join(APPOINTMENT_SCREENS, 'refused.png') });
  }
}

// Task 2.3b-2, pull request #64: the Head Teachers section of People and the
// alert of a branch with no active Academic Vice Principal (edge cases, Who
// can act). With SCREENSHOTS=1 both are saved under docs/screens/2.3b-2/.
const HEAD_TEACHER_SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.3b-2');

/**
 * The Super Admin sees the branch of the account test, which has no Academic
 * Vice Principal, named in the alert; its name opens the staff list of that
 * branch; People, Head Teachers lists the Head Teacher just appointed with
 * both subjects. Runs after the appointment, in the same session.
 */
async function headTeachersAndAlert(page: Page): Promise<void> {
  await page.goto('/');
  const alert = page.locator('[data-banner="vice-principals"]');
  await expect(alert).toContainText(en.layout.viceBanner);
  const branch = alert.getByRole('button', { name: 'Accounts browser test branch', exact: true });
  await expect(branch).toBeVisible();
  if (process.env.SCREENSHOTS === '1') {
    mkdirSync(HEAD_TEACHER_SCREENS, { recursive: true });
    await alert.screenshot({ path: path.join(HEAD_TEACHER_SCREENS, 'alert.png') });
  }
  await branch.click();
  await expect(heading(page, en.people.staff.title)).toBeVisible();
  await expect(page.getByRole('combobox', { name: en.switcher.branch, exact: true })).toHaveValue(
    (await page
      .getByRole('combobox', { name: en.switcher.branch, exact: true })
      .locator('option', { hasText: 'Accounts browser test branch' })
      .getAttribute('value')) ?? '',
  );

  await page.goto('/people');
  await page.getByRole('link', { name: en.people.headTeachersLink, exact: true }).click();
  await expect(heading(page, en.people.headTeachers.title)).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: 'Nazarov Rustam' });
  await expect(row).toContainText('Algebra, Trigonometry');
  await expect(row).toContainText(en.roles.head_teacher);
  await expect(row).toContainText(en.people.headTeachers.states.current);
  if (process.env.SCREENSHOTS === '1') {
    await page.screenshot({ path: path.join(HEAD_TEACHER_SCREENS, 'head-teachers.png') });
  }
}

/** A school date `days` from today in the branch's time zone (`edge/00-definitions`, Branch time). */
function schoolDay(days: number): string {
  const moment = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}

/** One year after a date, less a day: the longest year the rules allow (decision 1 of pull request #44). */
function yearEnd(start: string): string {
  const [year, month, day] = start.split('-').map(Number);
  const end = new Date(Date.UTC((year ?? 0) + 1, (month ?? 1) - 1, (day ?? 1) - 1));
  return end.toISOString().slice(0, 10);
}

// docs/spec/03-school-setup.md: Academic year and Quarters; "The current
// academic year and quarter are always shown in the top bar."
// edge/academic-year: "Start year"; the go-live date. Owner's answers 1 to 8
// for task 1.3. The dates are counted from today, so that today lies in
// quarter 1 whenever the test runs.
test('the Super Admin adds a year, dates its quarters, sets the go-live date and starts the year; the top bar shows it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAsSuperAdmin(page, 'years');
  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Years browser test branch' });
  const topBar = page.getByLabel(en.period.label, { exact: true });
  await expect(topBar).toHaveText(en.period.noYear);

  // A year that does not start on 1 January, so that it ends in the next calendar year.
  let start = schoolDay(-2);
  // 1 January would end the year in the same calendar year; 29 February a year later is 28 February, too long.
  if (start.endsWith('-01-01') || start.endsWith('-02-29')) {
    start = schoolDay(-3);
  }
  const end = yearEnd(start);
  const name = `${start.slice(0, 4)}–${end.slice(0, 4)}`;
  await openSetupPage(page, en.setup.yearsLink, en.setup.years.title);
  await page.getByRole('button', { name: en.setup.years.add, exact: true }).first().click();
  const newYear = page.getByRole('form', { name: en.setup.years.newTitle });
  await newYear.getByLabel(en.setup.years.startDate, { exact: true }).fill(start);
  await newYear.getByLabel(en.setup.years.endDate, { exact: true }).fill(end);
  await newYear.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText(
    en.setup.years.planned,
  );

  // The four quarters, today in quarter 1.
  await page.getByRole('button', { name, exact: true }).click();
  const panel = page.getByRole('complementary', { name });
  await panel.getByRole('button', { name: en.setup.years.changeQuarters, exact: true }).click();
  const quarters = panel.getByRole('form', { name: en.setup.years.quartersTitle });
  const dates: [string, string][] = [
    [start, schoolDay(30)],
    [schoolDay(40), schoolDay(100)],
    [schoolDay(110), schoolDay(200)],
    [schoolDay(210), schoolDay(300)],
  ];
  for (const [index, [from, to]] of dates.entries()) {
    const number = String(index + 1);
    await quarters.getByLabel(en.setup.years.quarterStart.replace('{{number}}', number)).fill(from);
    await quarters.getByLabel(en.setup.years.quarterEnd.replace('{{number}}', number)).fill(to);
  }
  await quarters.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('4 of 4 dated');
  // A planned year is labelled (edge/academic-year: "The top bar labels a planned year").
  await expect(topBar).toHaveText(`${name} (planned) · Quarter 1`);

  // The go-live date, on the branch page: today, or the next working weekday
  // (Monday to Friday, the branch's) when today is not one, since go-live is a
  // school day (task 1.4, decision 7 of pull request #47).
  await openSetupPage(page, en.setup.branchLink, en.setup.branch.title);
  const goLive = page.getByRole('form', { name: en.setup.branch.goLiveTitle });
  let goLiveDay = 0;
  while ([0, 6].includes(new Date(`${schoolDay(goLiveDay)}T00:00:00Z`).getUTCDay())) {
    goLiveDay += 1;
  }
  await goLive.getByLabel(en.setup.branch.goLiveDate, { exact: true }).fill(schoolDay(goLiveDay));
  await goLive.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(saved(goLive)).toBeVisible();

  // "Start year", asked first.
  await openSetupPage(page, en.setup.yearsLink, en.setup.years.title);
  await page.getByRole('button', { name, exact: true }).click();
  await panel.getByRole('button', { name: en.setup.years.start, exact: true }).click();
  await confirmWith(page, en.setup.years.start);
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText(
    en.setup.years.current,
  );
  await expect(topBar).toHaveText(`${name} · Quarter 1`);
});

// docs/spec/03-school-setup.md, Slot types and day templates: "A day template
// is a start time and an ordered list of slots ... every start and end time is
// calculated from the order and the lengths. Times are never typed by hand";
// "saving a template at any level shows that table with the changes marked,
// as the preview of the change". The build plan's "done when" for 1.5: times
// are never typed, reordering recalculates them. Owner's answers 9 to 14.
test('the Academic Vice Principal adds slot types, builds a template, reorders it and sets it as the default after the preview', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAsSuperAdmin(page, 'templates');

  await openSetupPage(page, en.setup.slotTypesLink, en.setup.slotTypes.title);
  for (const [name, kind, length] of [
    ['Lesson 45', 'lesson', '45'],
    ['Lunch', 'break', '40'],
  ] as const) {
    await page.getByRole('button', { name: en.setup.slotTypes.add, exact: true }).first().click();
    const form = page.getByRole('form', { name: en.setup.slotTypes.newTitle });
    await form.getByLabel(en.setup.slotTypes.name, { exact: true }).fill(name);
    await form.getByLabel(en.setup.slotTypes.kind, { exact: true }).selectOption(kind);
    await form.getByLabel(en.setup.slotTypes.length, { exact: true }).fill(length);
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toContainText(`${length} min`);
  }

  await openSetupPage(page, en.setup.dayTemplatesLink, en.setup.dayTemplates.title);
  await page.getByRole('button', { name: en.setup.dayTemplates.add, exact: true }).first().click();
  const form = page.getByRole('form', { name: en.setup.dayTemplates.newTitle });
  await form.getByLabel(en.setup.dayTemplates.name, { exact: true }).fill('Main');
  await form.getByLabel(en.setup.dayTemplates.startTime, { exact: true }).fill('08:00');
  const choice = form.getByLabel(
    en.form.addChoice.replace('{{label}}', en.setup.dayTemplates.slots),
  );
  const add = form.getByRole('button', { name: en.form.add, exact: true });
  for (const name of ['Lesson 45 · Lesson', 'Lunch · Break', 'Lesson 45 · Lesson']) {
    await choice.selectOption({ label: name });
    await add.click();
  }
  const slots = form.getByRole('listitem');
  await expect(slots).toHaveText([/08:00–08:45/, /08:45–09:25/, /09:25–10:10/]);
  // Lunch one slot later: the times are calculated again, never typed.
  await form
    .getByRole('button', {
      name: en.form.moveDown.replace('{{name}}', 'Lunch · Break').replace('{{place}}', '2'),
    })
    .click();
  await expect(slots).toHaveText([/08:00–08:45/, /08:45–09:30/, /09:30–10:10/]);
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Main' })).toContainText('08:00–10:10');

  await openSetupPage(page, en.setup.templateSettingsLink, en.setup.templateSettings.title);
  const set = page.getByRole('form', { name: en.setup.templateSettings.setTitle });
  await set.getByRole('button', { name: en.form.save, exact: true }).click();
  const preview = page.getByRole('dialog', { name: en.setup.templateTable.previewTitle });
  await expect(preview).toBeVisible();
  // Every working weekday (Monday to Friday) of grades 1 to 11 changes.
  await expect(preview.locator('[data-changed="true"]')).toHaveCount(55);
  await preview.getByRole('button', { name: en.setup.templateTable.save, exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(saved(set)).toBeVisible();
  const table = page.getByRole('table', { name: en.setup.templateTable.title });
  await expect(table.getByRole('cell').filter({ hasText: 'Main' })).toHaveCount(55);
});

/** A school date `days` after today in Tashkent, the branch time of the test branch. */
function dateAfter(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  const moment = new Date(`${today}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

/** The first date at least two days after today that falls on the ISO weekday (Monday 1). */
function nextWeekday(weekday: number): string {
  for (let days = 2; ; days += 1) {
    const date = dateAfter(days);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if ((day === 0 ? 7 : day) === weekday) {
      return date;
    }
  }
}

// docs/build-plan.md, task 1.4, done when: "a holiday inside a week, a working
// Saturday and a grade-range entry". docs/spec/03-school-setup.md, Academic
// calendar: "Each date resolves to 'no lessons' or to one day template";
// edge/time-dates-calendar: "the impact preview is shown first".
test('the Academic Vice Principal adds a day off for some grades and a working Saturday after the preview, and checks a date', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAsSuperAdmin(page, 'calendar');
  await openSetupPage(page, en.setup.calendarLink, en.setup.calendar.title);

  const wednesday = nextWeekday(3);
  const saturday = nextWeekday(6);
  const add = async (fill: (form: ReturnType<Page['getByRole']>) => Promise<void>) => {
    await page.getByRole('button', { name: en.setup.calendar.add, exact: true }).first().click();
    const form = page.getByRole('form', { name: en.setup.calendar.newTitle });
    await fill(form);
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    return page.getByRole('dialog', { name: en.setup.calendar.previewTitle });
  };

  const seniors = await add(async (form) => {
    await form.getByLabel(en.setup.calendar.name, { exact: true }).fill('Seniors off');
    await form.getByLabel(en.setup.calendar.firstDate, { exact: true }).fill(wednesday);
    await form.getByLabel(en.setup.calendar.lastDate, { exact: true }).fill(wednesday);
    await form.getByLabel(en.setup.calendar.scope, { exact: true }).selectOption('grades');
    await form.getByLabel(en.setup.calendar.gradeFrom, { exact: true }).selectOption('9');
  });
  await expect(seniors.getByRole('row').nth(1)).toContainText('Grades 9–11');
  await expect(seniors.getByRole('row').nth(1)).toContainText(en.setup.calendar.reasons.day_off);
  await seniors.getByRole('button', { name: en.setup.calendar.save, exact: true }).click();
  await expect(seniors).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: 'Seniors off' })).toContainText(
    'Grades 9–11',
  );

  const working = await add(async (form) => {
    await form.getByLabel(en.setup.calendar.kind, { exact: true }).selectOption('special_day');
    await form.getByLabel(en.setup.calendar.name, { exact: true }).fill('Working Saturday');
    await form.getByLabel(en.setup.calendar.firstDate, { exact: true }).fill(saturday);
    await form.getByLabel(en.setup.calendar.lastDate, { exact: true }).fill(saturday);
    await form.getByLabel(en.setup.calendar.follows, { exact: true }).selectOption('1');
  });
  await expect(working.getByRole('row').nth(1)).toContainText(
    en.setup.calendar.reasons.not_working_day,
  );
  await working.getByRole('button', { name: en.setup.calendar.save, exact: true }).click();
  await expect(working).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: 'Working Saturday' })).toContainText('Main');

  const check = page.getByRole('region', { name: en.setup.calendar.checkTitle });
  await check.getByLabel(en.setup.calendar.checkDate, { exact: true }).fill(saturday);
  await expect(check.getByRole('row').nth(1)).toContainText(
    'Main · lessons of Monday · Working Saturday',
  );
  await check.getByLabel(en.setup.calendar.checkDate, { exact: true }).fill(wednesday);
  await expect(check.getByRole('row').nth(8)).toContainText('Main');
  await expect(check.getByRole('row').nth(9)).toContainText(
    `${en.setup.calendar.reasons.day_off} (Seniors off)`,
  );
});

// Task 1.6, done when: "each setting has a permission test and the checklist
// reflects real state for Phase 1 items". The Academic Vice Principal changes
// the edit days and a late value (answers 19 and 20), and the checklist turns
// "Lesson slot types" done once one is added (answer 23).
test('the Academic Vice Principal changes the edit days and a late value, and the checklist follows a new lesson slot type', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAsSuperAdmin(page, 'settings');
  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.setup) })
    .click();
  const checklist = page.getByRole('region', { name: en.setup.checklist.title });
  const slotTypesItem = checklist.locator('[data-item="slotTypes"]');
  await expect(slotTypesItem.getByText(en.setup.checklist.missing, { exact: true })).toBeVisible();
  await expect(
    checklist.locator('[data-item="year"]').getByText(en.setup.checklist.done, { exact: true }),
  ).toBeVisible();

  await page
    .getByRole('list', { name: en.setup.title })
    .getByRole('link', { name: en.setup.settingsLink, exact: true })
    .click();
  await expect(heading(page, en.setup.settings.title)).toBeVisible();
  const editDays = page.getByRole('form', { name: en.setup.settings.editDaysTitle });
  await editDays.getByLabel(en.setup.settings.editDays, { exact: true }).fill('10');
  await editDays.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(saved(editDays)).toBeVisible();

  const year = await page.getByRole('heading', { level: 3 }).first().innerText();
  const quarter = page.getByRole('form', {
    name: en.setup.settings.quarterOfYear.replace('{{year}}', year).replace('{{number}}', '1'),
  });
  await quarter.getByLabel(en.setup.settings.lateValue, { exact: true }).fill('75');
  await quarter.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(saved(quarter)).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('form', { name: en.setup.settings.editDaysTitle })
      .getByLabel(en.setup.settings.editDays, { exact: true }),
  ).toHaveValue('10');

  await openSetupPage(page, en.setup.slotTypesLink, en.setup.slotTypes.title);
  await page.getByRole('button', { name: en.setup.slotTypes.add, exact: true }).first().click();
  const form = page.getByRole('form', { name: en.setup.slotTypes.newTitle });
  await form.getByLabel(en.setup.slotTypes.name, { exact: true }).fill('Lesson 40');
  await form.getByLabel(en.setup.slotTypes.kind, { exact: true }).selectOption('lesson');
  await form.getByLabel(en.setup.slotTypes.length, { exact: true }).fill('40');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Lesson 40' })).toContainText('40 min');

  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.setup) })
    .click();
  await expect(slotTypesItem.getByText(en.setup.checklist.done, { exact: true })).toBeVisible();
});

// docs/build-plan.md, task 2.1, done when: "a graded subject cannot be saved
// with weights that do not total 100". The owner's answers 3 to 8: one subject
// list, weights per branch, the copy of quarter 1 (answer 6).
test('the Academic Vice Principal adds a graded subject, is refused at 99, saves at 100, sets quarter 1 and copies it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAsSuperAdmin(page, 'subjects');
  await openSetupPage(page, en.setup.subjectsLink, en.setup.subjects.title);
  const texts = en.setup.subjects;

  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const form = page.getByRole('form', { name: texts.newTitle });
  await form.getByLabel(texts.nameUz, { exact: true }).fill('Astronomiya');
  await form.getByLabel(texts.nameRu, { exact: true }).fill('Астрономия');
  await form.getByLabel(texts.nameEn, { exact: true }).fill('Astronomy');
  await form.getByLabel(texts.department, { exact: true }).selectOption({ label: 'STEAM' });
  await form.getByLabel(texts.grade.replace('{{grade}}', '10'), { exact: true }).check();
  await form.getByLabel(texts.grade.replace('{{grade}}', '11'), { exact: true }).check();
  await form.getByLabel(texts.ratingExam, { exact: true }).check();
  await form.getByLabel(texts.parts.attendance, { exact: true }).fill('10');
  await form.getByLabel(texts.parts.classwork, { exact: true }).fill('50');
  await form.getByLabel(texts.parts.homework, { exact: true }).fill('39');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(form.getByText(texts.totalWrong, { exact: false })).toBeVisible();

  await form.getByLabel(texts.parts.homework, { exact: true }).fill('40');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Astronomy' });
  await expect(row).toContainText('10 · 50 · 40');

  await row.getByRole('button', { name: 'Astronomy' }).click();
  const panel = page.getByRole('complementary', { name: 'Astronomy' });
  const quarterOne = texts.quarter.replace('{{n}}', '1');
  await panel
    .getByRole('button', { name: texts.changeWeightsOf.replace('{{name}}', quarterOne) })
    .click();
  const first = panel.getByRole('form', { name: quarterOne });
  await first.getByLabel(texts.parts.attendance, { exact: true }).fill('10');
  await first.getByLabel(texts.parts.classwork, { exact: true }).fill('30');
  await first.getByLabel(texts.parts.homework, { exact: true }).fill('20');
  await first.getByLabel(texts.parts.ratingExam, { exact: true }).fill('40');
  await first.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(saved(panel)).toBeVisible();

  await panel.getByRole('button', { name: texts.copy, exact: true }).click();
  await expect(panel.locator('[data-quarter="4"]')).toContainText('10 · 30 · 20 · 40');
});
