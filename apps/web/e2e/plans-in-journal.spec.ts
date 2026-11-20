import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { currentPage, changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/09-lesson-plans.md, In the journal: "Clicking it opens the lesson card"; the
// lesson card's homework lines; docs/spec/edge-cases/lesson-plans.md, "A substitute supervises
// the class": "the next lesson gets no column for a homework not given" (task 8.8, Done when).
// The "Plans in the journal browser test branch" holds a lesson yesterday and one today at
// 00:05, with the homework "Read the map" given yesterday. All names are invented.
test('a teacher deletes a homework given at a lesson in the lesson editor, and the next lesson loses its column', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const account = accountOf('deliveryTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page
    .locator('[data-home-today]')
    .getByRole('button', { name: en.journal.open, exact: true })
    .click();
  await expect(currentPage(page)).toHaveText(en.journal.sheet);

  // The header shows the number and topic of yesterday's lesson; today's lesson checks the homework.
  const yesterday = page
    .locator('.ag-header-group-cell')
    .filter({ hasText: 'No. 1 · Contour lines' });
  await expect(yesterday).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Work: Read the map' })).toHaveCount(1);

  // Yesterday's lesson in the lesson editor (the owner, 20 November 2026): "given today" holds
  // the homework, and the teacher deletes it.
  const firstLesson = await page
    .locator('.ag-header-cell[col-id$=":a"]')
    .first()
    .getAttribute('col-id');
  const card = page
    .locator(`.ag-header-cell[col-id="${firstLesson ?? ''}"]`)
    .getByRole('button', { name: en.journal.card.open, exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(en.journal.card.topic, { exact: true })).toHaveValue(
    'Contour lines',
  );
  const given = dialog.locator('[data-editor-given]');
  await expect(given).toContainText('Read the map');
  await given
    .getByRole('button', {
      name: en.journal.editor.delete.replace('{{name}}', 'Read the map'),
      exact: true,
    })
    .click();
  await expect(given).toHaveCount(0);
  await dialog.getByRole('button', { name: en.journal.entry.close, exact: true }).click();

  // Today's lesson has no column for the homework deleted.
  await expect(page.getByRole('button', { name: 'Work: Read the map' })).toHaveCount(0);
});
