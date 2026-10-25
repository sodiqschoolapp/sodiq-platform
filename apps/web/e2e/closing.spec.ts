import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

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
  // The role requires a second step at sign-in (task 0.7b): set up as exemptions.spec.ts does.
  await expect(heading(page, en.setUp.title)).toBeVisible();
  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  const secret = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(secret));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/journal');
  await page.getByRole('link', { name: en.results.closing.title }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: en.results.closing.title, exact: true }),
  ).toBeVisible();
  const line = page.locator('[data-closing-state="not_open"]');
  await expect(line).toContainText('The checklist opens on');
  await expect(page.getByText(en.results.closing.notOpenYet)).toBeVisible();
  // Nothing to decide or remind before the checklist opens.
  await expect(page.getByRole('button', { name: en.results.closing.remind })).toHaveCount(0);
});
