import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, NEW_PASSWORD } from './accounts';
import { changeFirstPassword, checkPage, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

/** A page opened by its address, waited for by its title. */
async function open(page: Page, address: string, title: string): Promise<void> {
  await page.goto(address);
  await expect(heading(page, title)).toBeVisible();
}

/** The first record of the list opened in its side panel: the list is the last table of the page. */
async function openFirstRecord(page: Page): Promise<void> {
  await page
    .locator('table')
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
  ['people-staff', '/people/staff', en.people.staff.title],
  ['people-students', '/people/students', en.people.students.title],
  ['people-parents', '/people/parents', en.people.relatives.title],
] as const;

/** The other pages of Phases 0 to 2 the Academic Vice Principal opens. */
const PAGES = [
  ['account', '/account', en.account.title],
  ['account-password', '/account/password', en.password.titleOwn],
  ['setup', '/setup', en.setup.title],
  ['setup-branch', '/setup/branch', en.setup.branch.title],
  ['setup-calendar', '/setup/calendar', en.setup.calendar.title],
  ['setup-settings', '/setup/settings', en.setup.settings.title],
  ['setup-travel-times', '/setup/travel-times', en.setup.travelTimes.title],
  ['people', '/people', en.people.title],
  ['people-vacancies', '/people/vacancies', en.people.vacancies.title],
  ['people-head-teachers', '/people/head-teachers', en.people.headTeachers.title],
  ['people-never-used', '/people/never-used', en.people.neverUsed.title],
  ['audit', '/audit', en.audit.title],
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
    await openFirstRecord(page);
    await checkPage(page, `${name}-record`);
  }

  // The same account as Teacher: its home and its account.
  await page.goto('/');
  await page.getByRole('combobox', { name: en.switcher.role, exact: true }).selectOption('teacher');
  await expect(page.getByText(en.home.teaching)).toBeVisible();
  await checkPage(page, 'home-teacher');
  await open(page, '/account', en.account.title);
  await checkPage(page, 'account-teacher');
});
