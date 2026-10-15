import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, NEW_PASSWORD } from './accounts';
import {
  changeFirstPassword,
  checkNewRecord,
  checkPage,
  heading,
  languageChooser,
  signIn,
} from './steps';
import { codeNow } from './totp';

/** A page opened by its address, waited for by its title. */
async function open(page: Page, address: string, title: string): Promise<void> {
  await page.goto(address);
  await expect(heading(page, title)).toBeVisible();
}

/**
 * The first record of the list opened in its side panel: the list is the last
 * table of the page, the weekly totals below the teaching load aside (task 3.4b).
 */
async function openFirstRecord(page: Page): Promise<void> {
  await page
    .locator('table:not([data-totals])')
    .last()
    .locator('tbody tr')
    .first()
    .getByRole('button')
    .first()
    .click({ timeout: 10_000 });
  await expect(page.getByRole('complementary')).toBeVisible();
}

/** The lists of Phases 0 to 2 the Academic Vice Principal opens, each with a record. */
const LISTS = [
  ['setup-buildings', '/setup/buildings', en.setup.buildings.title],
  ['setup-rooms', '/setup/rooms', en.setup.rooms.title],
  ['setup-divisions', '/setup/divisions', en.setup.divisions.title],
  ['setup-subjects', '/setup/subjects', en.setup.subjects.title],
  ['setup-years', '/setup/years', en.setup.years.title],
  ['setup-slot-types', '/setup/slot-types', en.setup.slotTypes.title],
  ['setup-day-templates', '/setup/day-templates', en.setup.dayTemplates.title],
  ['setup-template-settings', '/setup/day-template-settings', en.setup.templateSettings.title],
  ['setup-calendar', '/setup/calendar', en.setup.calendar.title],
  ['people-staff', '/people/staff', en.people.staff.title],
  ['people-students', '/people/students', en.people.students.title],
  ['people-vacancies', '/people/vacancies', en.people.vacancies.title],
  ['audit', '/audit', en.audit.title],
  ['people-parents', '/people/parents', en.people.relatives.title],
  // Task 3.1a: the seeded class.
  ['classes', '/classes', en.classes.title],
  // Task 3.2a: the seeded group.
  ['groups', '/groups', en.groups.title],
  // Task 3.2b: the seeded student of 7 Harvard in no Geometry group.
  ['groups-placement', '/groups/placement', en.groups.placement.title],
  // Task 3.4a: the seeded load row of 7 Harvard.
  ['timetable-load', '/timetable/load', en.timetable.load.title],
] as const;

/** The lists the Academic Vice Principal adds to, with the "New …" button and the panel's title. */
const NEW_RECORDS = [
  [
    'setup-slot-types',
    '/setup/slot-types',
    en.setup.slotTypes.title,
    en.setup.slotTypes.add,
    en.setup.slotTypes.newTitle,
  ],
  [
    'setup-day-templates',
    '/setup/day-templates',
    en.setup.dayTemplates.title,
    en.setup.dayTemplates.add,
    en.setup.dayTemplates.newTitle,
  ],
  [
    'setup-calendar',
    '/setup/calendar',
    en.setup.calendar.title,
    en.setup.calendar.add,
    en.setup.calendar.newTitle,
  ],
  [
    'setup-subjects',
    '/setup/subjects',
    en.setup.subjects.title,
    en.setup.subjects.add,
    en.setup.subjects.newTitle,
  ],
  [
    'people-students',
    '/people/students',
    en.people.students.title,
    en.people.students.add,
    en.people.students.newTitle,
  ],
  [
    'people-vacancies',
    '/people/vacancies',
    en.people.vacancies.title,
    en.people.vacancies.add,
    en.people.vacancies.newTitle,
  ],
  ['classes', '/classes', en.classes.title, en.classes.add, en.classes.newTitle],
  ['groups', '/groups', en.groups.title, en.groups.add, en.groups.newTitle],
] as const;

/**
 * The School setup and People panels the Academic Vice Principal changes
 * (tasks 2.7c-2b-1, 2.7c-2b-2a and 2.7c-2b-2b): the list, the record opened by the button
 * of its row (or the first), and the button of the panel that opens its form.
 */
const EDITS = [
  ['people-staff', '/people/staff', en.people.staff.title, null, en.form.edit],
  [
    'people-staff-teaching',
    '/people/staff',
    en.people.staff.title,
    null,
    en.people.staff.changeTeaching,
  ],
  [
    'people-staff-availability',
    '/people/staff',
    en.people.staff.title,
    null,
    en.people.availability.change,
  ],
  ['people-vacancies', '/people/vacancies', en.people.vacancies.title, null, en.form.edit],
  [
    'people-vacancies-availability',
    '/people/vacancies',
    en.people.vacancies.title,
    null,
    en.people.availability.change,
  ],
  // The seeded student is active and holds no data yet, so it may be deleted.
  ['people-students', '/people/students', en.people.students.title, null, en.form.edit],
  [
    'people-students-uid',
    '/people/students',
    en.people.students.title,
    null,
    en.people.students.uidTitle,
  ],
  [
    'people-students-leave',
    '/people/students',
    en.people.students.title,
    null,
    en.people.students.leaveTitle,
  ],
  [
    'people-students-delete',
    '/people/students',
    en.people.students.title,
    null,
    en.people.students.deleteAction,
  ],
  ['people-parents', '/people/parents', en.people.relatives.title, null, en.form.edit],
  [
    'people-parents-same',
    '/people/parents',
    en.people.relatives.title,
    null,
    en.people.relatives.markStaff,
  ],
  ['setup-slot-types', '/setup/slot-types', en.setup.slotTypes.title, null, en.form.edit],
  ['setup-day-templates', '/setup/day-templates', en.setup.dayTemplates.title, null, en.form.edit],
  ['setup-calendar', '/setup/calendar', en.setup.calendar.title, 'Pages day off', en.form.edit],
  ['setup-subjects', '/setup/subjects', en.setup.subjects.title, null, en.form.edit],
  ['setup-years', '/setup/years', en.setup.years.title, null, en.setup.years.changeQuarters],
  [
    'setup-template-settings',
    '/setup/day-template-settings',
    en.setup.templateSettings.title,
    en.setup.templateSettings.levels.weekday,
    en.setup.templateSettings.endTitle,
  ],
  // Task 3.1a: the record and the forms of its Tutors.
  ['classes', '/classes', en.classes.title, null, en.form.edit],
  ['classes-tutor', '/classes', en.classes.title, null, en.classes.giveTutor],
  // Task 3.2a: the record of a group.
  ['groups', '/groups', en.groups.title, null, en.form.edit],
] as const;

/** The other pages of Phases 0 to 2 the Academic Vice Principal opens. */
const PAGES = [
  ['account', '/account', en.account.title],
  ['account-password', '/account/password', en.password.titleOwn],
  ['setup', '/setup', en.setup.title],
  ['setup-branch', '/setup/branch', en.setup.branch.title],
  ['setup-settings', '/setup/settings', en.setup.settings.title],
  ['setup-travel-times', '/setup/travel-times', en.setup.travelTimes.title],
  ['people', '/people', en.people.title],
  ['people-head-teachers', '/people/head-teachers', en.people.headTeachers.title],
  ['people-never-used', '/people/never-used', en.people.neverUsed.title],
  // Task 3.4a: the entry of the Timetable item.
  ['timetable', '/timetable', en.timetable.title],
] as const;

// docs/build-plan.md, task 2.7c-1 (pull request #80), done when: every page of
// Phases 0 to 2 passes the browser check in light, dark and at 390 px, with
// the screenshots in the report. The seeded account `pages` is an Academic
// Vice Principal and a Teacher of a branch of its own with one record of each
// list (decision 8); the Super Admin's own pages are checked at the end of
// the Super Admin test of setup.spec.ts, the page of the reset link in
// password-reset.spec.ts. It changes nothing but its own password and second step.
test('every page of Phases 0 to 2 is drawn with the design system in light, dark and at phone width', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const account = accountOf('pages');

  // Signed out: the sign-in frame.
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await expect(heading(page, en.signIn.title)).toBeVisible();
  await checkPage(page, 'sign-in', { signInFrame: true });
  await page.getByRole('link', { name: en.signIn.forgot, exact: true }).click();
  await expect(heading(page, en.forgot.title)).toBeVisible();
  await checkPage(page, 'forgot-password', { signInFrame: true });

  // The first sign-in: the forced password change and the required second step.
  await page.goto('/sign-in');
  await signIn(page, en, account.login, account.password);
  await expect(heading(page, en.password.titleForced)).toBeVisible();
  await checkPage(page, 'password-forced', { signInFrame: true });
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.setUp.title)).toBeVisible();
  await checkPage(page, 'second-step-set-up', { signInFrame: true });
  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  const key = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(10);
  const recoveryCode = (await page.getByRole('listitem').allInnerTexts())[0] ?? '';
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  // The second sign-in asks for the code: a recovery code, since the code of
  // the app was used for the set-up a moment ago.
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await signIn(page, en, account.login, NEW_PASSWORD);
  await expect(heading(page, en.code.title)).toBeVisible();
  await checkPage(page, 'sign-in-code', { signInFrame: true });
  await page.getByLabel(en.code.label, { exact: true }).fill(recoveryCode);
  await page.getByRole('button', { name: en.code.submit, exact: true }).click();

  // The Academic Vice Principal: the home with its counters, every page and
  // every list with a record open in its side panel.
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(page.getByRole('region', { name: en.home.noClass.title })).toBeVisible();
  await checkPage(page, 'home-vice-principal');
  for (const [name, address, title] of PAGES) {
    await open(page, address, title);
    await checkPage(page, name);
  }
  for (const [name, address, title] of LISTS) {
    await open(page, address, title);
    await checkPage(page, name);
    // The calendar's last table is the check of a date: its record is opened by name.
    await (name === 'setup-calendar'
      ? page.getByRole('button', { name: 'Pages day off', exact: true }).click()
      : openFirstRecord(page));
    await expect(page.getByRole('complementary')).toBeVisible();
    await checkPage(page, `${name}-record`);
  }
  // Task 2.7c-3: the Rooms "By floor" view, with a card open in its side
  // panel as a row is; and the Branches list, which is the Super Admin's.
  await open(page, '/setup/rooms?view=floors', en.setup.rooms.title);
  await expect(page.getByRole('tablist', { name: en.setup.rooms.floorsTabs })).toBeVisible();
  await checkPage(page, 'setup-rooms-floors');
  await page.getByRole('tabpanel').getByRole('list').last().getByRole('button').first().click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await checkPage(page, 'setup-rooms-floors-record');
  await page.goto('/setup/branches');
  await expect(heading(page, en.problems.noAccessTitle)).toBeVisible();
  // Tasks 2.7c-2b-1 and 2.7c-2b-2a: each School setup and People panel this
  // role changes, with each of its forms open; while the record's form is
  // open its Save and Cancel are the panel's last part. Nothing is saved.
  for (const [name, address, title, row, opener] of EDITS) {
    await open(page, address, title);
    await (row === null
      ? openFirstRecord(page)
      : page.getByRole('button', { name: row, exact: true }).first().click());
    const panel = page.getByRole('complementary');
    await panel.getByRole('button', { name: opener, exact: true }).click();
    // Task 3.5b, H22: with nobody holding the Tutor role, Give Tutor says what to do instead of a form.
    await expect(
      panel
        .getByRole('form')
        .first()
        .or(panel.getByText(en.classes.noCandidates, { exact: true })),
    ).toBeVisible();
    await checkPage(page, `${name}-edit`);
  }
  // Task 2.7c-2b-2b: the forms of the student's Relatives tab, each opened in
  // the tab (the seeded student has one relative). Nothing is saved.
  for (const [name, opener] of [
    ['people-students-relative-new', en.people.relatives.add],
    ['people-students-link', en.people.relatives.changeLink],
  ] as const) {
    await open(page, '/people/students', en.people.students.title);
    await openFirstRecord(page);
    const panel = page.getByRole('complementary');
    await panel.getByText(en.people.students.tabs.relatives, { exact: true }).click();
    await panel.getByRole('button', { name: opener, exact: true }).click();
    await expect(panel.getByRole('form').first()).toBeVisible();
    await checkPage(page, `${name}-edit`);
  }
  // Task 2.7c-2a: every list the Academic Vice Principal may add to, with its
  // new record in the side panel; the others are the Super Admin's
  // (setup.spec.ts). Nothing is saved.
  for (const [name, address, title, add, newTitle] of NEW_RECORDS) {
    await open(page, address, title);
    await checkNewRecord(page, name, add, newTitle);
  }
  // The bulk "Leave school" of the ticked students, in the side panel.
  await open(page, '/people/students', en.people.students.title);
  await page.locator('tbody input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: en.people.students.bulkLeave, exact: true }).click();
  await expect(
    page.getByRole('complementary', {
      name: en.people.students.bulkLeaveTitle_one.replace('{{n}}', '1'),
    }),
  ).toBeVisible();
  await checkPage(page, 'people-students-leave');

  // The same account as Teacher: its home and its account.
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${en.switcher.rolePrefix}`) }).click();
  await page.getByRole('menuitemradio', { name: en.roles.teacher }).click();
  await expect(page.getByText(en.home.teaching)).toBeVisible();
  await checkPage(page, 'home-teacher');
  await open(page, '/account', en.account.title);
  await checkPage(page, 'account-teacher');
});
