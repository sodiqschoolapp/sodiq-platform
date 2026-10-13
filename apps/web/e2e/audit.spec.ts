import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/edge-cases/people-roles-accounts.md, Personal data and the audit
// log; task 2.6a, pull request #75. The seed writes a student of a branch of
// its own and the entry of its creation by the Academic Vice Principal, with
// the address among the values. All names are invented.

test('an Academic Vice Principal opens the history of a student from its panel', async ({
  page,
}) => {
  const account = accountOf('auditVice');
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
  await page.getByRole('row').filter({ hasText: 'Murodova' }).getByRole('button').first().click();
  const panel = page.getByRole('complementary', { name: 'Murodova Oydin' });
  await panel.getByRole('link', { name: en.audit.history, exact: true }).click();

  await expect(heading(page, en.audit.title)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: en.audit.actions.student.create });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Ergashev Rustam');
  await row.getByRole('button').first().click();
  const entry = page.getByRole('complementary');
  // The Academic Vice Principal reads Identity: the address is plain.
  await expect(entry.getByRole('row').filter({ hasText: 'Bodomzor 9' })).toHaveCount(1);
  await expect(entry.getByRole('button', { name: en.audit.show })).toHaveCount(0);
});

test('a Principal sees the address hidden, shows it, and finds the own sign-in', async ({
  page,
}) => {
  const account = accountOf('auditPrincipal');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.getByRole('link', { name: en.menu.audit_log, exact: true }).first().click();
  await expect(heading(page, en.audit.title)).toBeVisible();
  // The Principal reads the branch log only: no choice of log.
  await expect(page.getByLabel(en.audit.scope)).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: en.audit.actions.student.create });
  await row.getByRole('button').first().click();
  const entry = page.getByRole('complementary');
  const address = entry.getByRole('row').filter({ hasText: en.people.students.address });
  await expect(address).toContainText(en.audit.hidden);
  await expect(entry.getByText('Bodomzor 9')).toHaveCount(0);
  await entry.getByRole('button', { name: en.audit.show, exact: true }).click();
  await expect(address).toContainText('Bodomzor 9');

  await page.goto('/account');
  const history = page.getByRole('region', { name: en.account.signInHistoryTitle });
  await expect(
    history.getByRole('cell', { name: en.audit.actions.auth.sign_in, exact: true }).first(),
  ).toBeVisible();
});
