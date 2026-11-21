import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// Task 11.12. `02`, Assistant: "A person whose chosen role is another role does not see it". The
// Super Admin's question is a step of the setup Super Admin's test (`assistant.ts`).
test('a Teacher sees no assistant in the top bar', async ({ page }) => {
  const account = accountOf('assistantTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(page.getByRole('button', { name: en.assistant.open, exact: true })).toHaveCount(0);
});
