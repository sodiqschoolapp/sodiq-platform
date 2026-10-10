import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, type AccountKey } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

/** The first sign-in of the seeded Super Admin: the forced password change and the required second step. */
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
  await page.getByRole('link', { name: link, exact: true }).click();
  await expect(heading(page, title)).toBeVisible();
}

const saved = (scope: Page | ReturnType<Page['getByRole']>) =>
  scope.getByRole('status').filter({ hasText: en.form.saved });

const confirmWith = async (page: Page, action: string): Promise<void> => {
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toBeHidden();
};

// docs/build-plan.md, task 1.1, done when: "the Super Admin can create and
// edit them". docs/spec/03-school-setup.md: the branch record; buildings,
// floors and rooms ("Rooms are added floor by floor"). Archive refused while
// a room on the floor is in use, allowed once it is closed (decided by the
// owner, pull request #37, answer 7).
test('the Super Admin edits the branch, adds a building, a floor and a room, and archives the floor once its room is closed', async ({
  page,
}) => {
  test.setTimeout(90_000);
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
  const roomForm = page.getByRole('complementary', { name: '101' }).getByRole('form');
  await roomForm.getByLabel(en.setup.rooms.status, { exact: true }).selectOption('closed');
  await roomForm.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(saved(roomForm)).toBeVisible();

  await openSetupPage(page, en.setup.buildingsLink, en.setup.buildings.title);
  await page.getByRole('button', { name: 'Main building', exact: true }).click();
  await panel
    .getByRole('button', { name: en.setup.buildings.archiveNamed.replace('{{name}}', 'Ground') })
    .click();
  await confirmWith(page, en.setup.buildings.archive);
  await expect(panel.getByRole('row').filter({ hasText: 'Ground' })).toContainText(
    en.setup.buildings.archived,
  );
});

// docs/build-plan.md, task 1.2, done when: "Academic cannot be renamed or
// archived". docs/spec/03-school-setup.md, Divisions: "Academic is built in";
// "Other divisions are data. The Super Admin adds, renames and archives them";
// departments archived with their division (decided by the owner, pull
// request #40, answer 4).
test('the Super Admin sees Academic as built in, adds a division with a department, renames the department and archives the division with it', async ({
  page,
}) => {
  test.setTimeout(90_000);
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
});
