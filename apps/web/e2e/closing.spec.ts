import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// docs/spec/07-journal.md, Closing a quarter: "The Academic Vice Principal closes a quarter from
// one checklist screen ... The checklist opens two weeks earlier" (task 9.2a). The Academic Vice
// Principal of the "Plans in the journal browser test branch" opens the checklist from the
// Journals page; quarter 1 there ends 20 days from today, so the page names the day it opens.
// The decisions are tested by the page test and the route tests. All names are invented.
test('an Academic Vice Principal opens the closing checklist from the Journals page', async ({
  page,
}) => {
  const account = accountOf('closingVice');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/journal');
  await page.getByRole('link', { name: en.results.closing.title }).click();
  await expect(heading(page, en.results.closing.title)).toBeVisible();
  const line = page.locator('[data-closing-state="not_open"]');
  await expect(line).toContainText('The checklist opens on');
  await expect(page.getByText(en.results.closing.notOpenYet)).toBeVisible();
  // Nothing to decide or remind before the checklist opens.
  await expect(page.getByRole('button', { name: en.results.closing.remind })).toHaveCount(0);
});
