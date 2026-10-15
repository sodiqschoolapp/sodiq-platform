import { expect, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { heading } from './steps';

/** A school date some days from today in Tashkent. */
function schoolDay(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

/**
 * edge-cases/people-roles-accounts.md, row 15: "A teacher moves to another
 * department, or a subject is moved, mid-year. Both changes carry a start date
 * and are made by the Super Admin. They are refused while a teaching load
 * would have a teacher outside the subject's department; those loads are
 * listed for reassignment first." Task 3.4c, pull request #101. The Super
 * Admin moves Cosmology to National, sees its row of 7 Oxford listed, follows
 * the link to the draft, deletes the row and moves the subject. The seed holds
 * no fourth Super Admin, so this runs at the end of the years test's session.
 * All names are invented.
 */
export async function moveSubjectDepartment(page: Page): Promise<void> {
  const texts = en.setup.subjects;
  const bar = page.getByRole('banner', { name: en.layout.topBar });
  const moveOn = schoolDay(7);

  const move = async () => {
    await page.goto('/setup/subjects');
    await expect(heading(page, texts.title)).toBeVisible();
    await page
      .getByRole('row')
      .filter({ hasText: 'Cosmology' })
      .getByRole('button', { name: 'Cosmology' })
      .click();
    const panel = page.getByRole('complementary', { name: 'Cosmology' });
    await panel.getByRole('button', { name: en.form.edit, exact: true }).click();
    const form = panel.getByRole('form', { name: 'Cosmology' });
    await form.getByLabel(texts.department, { exact: true }).selectOption({ label: 'National' });
    await form.getByLabel(texts.departmentStartsOn, { exact: true }).fill(moveOn);
    await form.getByRole('button', { name: en.form.save, exact: true }).click();
    return panel;
  };

  await page.goto('/setup/subjects');
  await expect(heading(page, texts.title)).toBeVisible();
  await bar
    .getByLabel(en.switcher.branch)
    .selectOption({ label: 'Department move browser test branch' });
  const panel = await move();
  const listed = panel.getByRole('status', { name: en.people.moveLoads.title });
  // Issue #105, H8: the class with its grade; H20: readable by a screen
  // reader, so nothing above it or on it hides it from the accessibility tree.
  await expect(listed).toContainText('7 Oxford · Cosmology · Qodirova Malika');
  await expect(listed).toBeVisible();
  // Found by its attributes: a role query finds nothing that is hidden.
  const selector = `[role="status"][aria-label="${en.people.moveLoads.title}"]`;
  const hidden = () =>
    page.evaluate<boolean>(
      `(() => document.querySelector(${JSON.stringify(selector)})?.closest('[aria-hidden="true"], [inert]') != null)()`,
    );
  expect(await hidden()).toBe(false);
  await expect(listed).toMatchAriaSnapshot(`
    - status "${en.people.moveLoads.title}":
      - heading "${en.people.moveLoads.title}" [level=4]
      - list:
        - listitem:
          - link /Version 1/
    `);
  // The only thing that hides the list is the modal question the link opens
  // (the form keeps what was typed): while it is open everything behind it is
  // hidden, as it must be; once it closes the list is readable again (H20).
  await listed.getByRole('link').click();
  const leave = page.getByRole('alertdialog', { name: en.unsent.leaveTitle });
  await expect(leave).toBeVisible();
  expect(await hidden()).toBe(true);
  await leave.getByRole('button', { name: en.unsent.stay, exact: true }).click();
  await expect(leave).toBeHidden();
  expect(await hidden()).toBe(false);
  await expect(listed).toBeVisible();
  await listed.getByRole('link').click();
  // The form keeps what was typed: the link asks before it leaves it.
  await page
    .getByRole('alertdialog', { name: en.unsent.leaveTitle })
    .getByRole('button', { name: en.unsent.leave, exact: true })
    .click();
  await expect(heading(page, en.timetable.load.title)).toBeVisible();
  await expect(page.getByLabel(en.timetable.load.version, { exact: true })).toContainText(
    'Version 1',
  );

  const row = page
    .getByRole('row')
    .filter({ hasText: '7 Oxford' })
    .filter({ hasText: 'Cosmology' });
  await row.getByRole('button').first().click();
  await page.getByRole('button', { name: en.timetable.load.deleteRow, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: en.timetable.load.deleteRow, exact: true })
    .click();
  await expect(row).toHaveCount(0);

  const moved = await move();
  await expect(moved.getByRole('button', { name: en.form.edit, exact: true })).toBeVisible();
  await expect(moved.getByRole('status', { name: en.people.moveLoads.title })).toHaveCount(0);
  await expect(moved.locator('dd').filter({ hasText: 'National' })).toContainText('since');
}
