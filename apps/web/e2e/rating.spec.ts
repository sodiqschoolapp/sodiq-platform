import { expect, test } from '@playwright/test';
import { statSync } from 'node:fs';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/08-results-rating-analytics.md, Rating (task 9.3a): a Principal of the "Plans in the
// journal browser test branch" opens the rating, finds Sardor Alimov ranked in
// Geodesy, switches to the list of classes and exports it to Excel. All names are invented.
test('a Principal opens the rating, ranks a subject and the classes, and exports', async ({
  page,
}) => {
  const account = accountOf('ratingPrincipal');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  // A Principal finds Results under "More" of the menu; the address is the page.
  await page.goto('/results/rating');
  await expect(heading(page, en.results.ratingList.title)).toBeVisible();
  await expect(page.locator('[data-provisional="true"]')).toBeVisible();
  const journal = page.getByLabel(en.results.ratingList.journal, { exact: true });
  const geodesy = await journal
    .locator('option', { hasText: 'Geodesy' })
    .first()
    .getAttribute('value');
  if (geodesy === null) throw new Error('A Geodesy journal to rank.');
  await journal.selectOption(geodesy);
  const sardor = page.locator('tbody tr').filter({ hasText: 'Alimov Sardor' });
  await expect(sardor).toBeVisible();

  await page
    .getByRole('radiogroup', { name: en.results.ratingList.kind })
    .getByText(en.results.ratingList.kinds.classes, { exact: true })
    .click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en.results.ratingList.excel, exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^rating-classes-\d\.xlsx$/);
  expect(statSync(await file.path()).size).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
