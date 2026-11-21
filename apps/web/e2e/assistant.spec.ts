import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Task 11.12 (build plan, Done when: "with the fake model the Super Admin asks 'which classes have
// no Tutor' and gets the platform's own list"). The browser tests' API runs the scripted model
// (`ASSISTANT_SCRIPTED_MODEL=1`, `src/testing/e2e/server.ts`), which reads the classes through
// the platform's own route as the person and names those with no Tutor. The seed switched the
// assistant on and gave the branch "Assistant browser test branch" two classes with no Tutor.
test('the Super Admin asks which classes have no Tutor and gets the platform’s own list', async ({
  page,
}) => {
  const account = accountOf('assistantAdmin');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  const key = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Assistant browser test branch' });
  await page.getByRole('button', { name: en.assistant.open, exact: true }).click();
  const panel = page.getByRole('complementary', { name: en.assistant.title });
  await expect(panel).toBeVisible();
  await panel
    .getByLabel(en.assistant.question, { exact: true })
    .fill('Which classes have no Tutor?');
  await panel.getByRole('button', { name: en.assistant.send, exact: true }).click();

  // The answer is the platform's own list: the read went through GET /api/classes as the person.
  await expect(panel.getByText('Assistant A, Assistant B', { exact: true })).toBeVisible();
  await expect(
    panel.getByText(en.assistant.read.replace('{{what}}', en.assistant.groups.classes), {
      exact: true,
    }),
  ).toBeVisible();
  // Every screen works beside it.
  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.classes) })
    .click();
  await expect(page.getByRole('cell', { name: 'Assistant A' }).first()).toBeVisible();
});

test('a Teacher sees no assistant in the top bar', async ({ page }) => {
  const account = accountOf('assistantTeacher');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(page.getByRole('button', { name: en.assistant.open, exact: true })).toHaveCount(0);
});
