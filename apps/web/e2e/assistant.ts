import { expect, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { heading } from './steps';

/**
 * Task 11.12 (build plan, Done when: "with the fake model the Super Admin asks 'which classes have
 * no Tutor' and gets the platform's own list"), a step of the setup Super Admin's test (the seed
 * holds no fourth Super Admin, correction 1 of #87). The browser tests' API runs the scripted
 * model (`ASSISTANT_SCRIPTED_MODEL=1`, `src/testing/e2e/server.ts`): it reads the classes through
 * the platform's own route as the person and names those with no Tutor. The seed gave the branch
 * "Assistant browser test branch" two classes with no Tutor; the assistant is off until the step
 * switches it on.
 */
export async function askTheAssistant(page: Page): Promise<void> {
  // Off until switched on: no button in the top bar.
  await expect(page.getByRole('button', { name: en.assistant.open, exact: true })).toHaveCount(0);
  await page.goto('/setup/settings');
  const section = page.getByRole('region', { name: en.assistant.settings.title });
  await section.getByLabel(en.assistant.settings.schoolOn, { exact: true }).check();
  await section
    .getByLabel(en.assistant.settings.roleOn.replace('{{role}}', en.roles.super_admin), {
      exact: true,
    })
    .check();
  await section.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(section.getByText(en.form.saved)).toBeVisible();

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
  await panel.getByRole('button', { name: en.assistant.close, exact: true }).click();

  // Every conversation, for the Super Admin.
  await page.goto('/assistant-conversations');
  await expect(heading(page, en.assistant.conversationsPage.title)).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Which classes have no Tutor?' }),
  ).toBeVisible();
}
