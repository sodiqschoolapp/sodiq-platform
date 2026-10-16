import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, type AccountKey } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

// Task 3.6a, the owner's answers of 15 October 2026 on issue #42, each test
// with an account of its own (seeded in "Who sees what browser test branch"):
// a Teacher reads the students taught in the published load, Basic only
// (L48); a Head Tutor reads every group and exports it (L59); a Head Teacher
// reads a Senior Head Teacher of another branch by full name (L32). All
// names are invented.

async function signedIn(page: Page, key: AccountKey): Promise<void> {
  const account = accountOf(key);
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();
}

const texts = en.people.students;

test('a Teacher lists the taught student only and reads the Basic fields', async ({ page }) => {
  await signedIn(page, 'whoTeacher');
  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  const row = page.locator('tbody tr').filter({ hasText: 'Yoqubova Madina' });
  await expect(row).toContainText('7 Oxford');
  await expect(page.getByText('Nurmatov Javohir')).toHaveCount(0);
  await row.getByRole('button', { name: 'Yoqubova Madina' }).click();
  const panel = page.getByRole('complementary', { name: 'Madina Yoqubova' });
  await expect(panel.getByText('9999831').first()).toBeVisible();
  // Basic only: no phone, no score, no contract tab, no relatives tab.
  await expect(panel.getByText(texts.phone, { exact: true })).toHaveCount(0);
  await expect(panel.getByText(texts.diagnosticScore, { exact: true })).toHaveCount(0);
  await expect(panel.getByText(texts.tabs.contract, { exact: true })).toHaveCount(0);
  await expect(panel.getByText(texts.tabs.relatives, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.list.export })).toHaveCount(0);
});

test('a Head Tutor reads every group of a student and exports every group', async ({ page }) => {
  await signedIn(page, 'whoHeadTutor');
  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Nurmatov Javohir' }).click();
  const panel = page.getByRole('complementary', { name: 'Javohir Nurmatov' });
  await expect(panel.getByText(texts.birthDate, { exact: true })).toBeVisible();
  await expect(panel.getByText(texts.diagnosticScore, { exact: true })).toBeVisible();
  await expect(panel.getByText('68', { exact: true })).toBeVisible();
  await panel.getByText(texts.tabs.contract, { exact: true }).click();
  await expect(panel.getByText(/E2E-9999832/)).toBeVisible();
  await page.getByRole('button', { name: en.list.exportAlso }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText([
    texts.exportGroups.basic,
    texts.exportGroups.contact,
    texts.exportGroups.identity,
    texts.exportGroups.financial,
    texts.exportGroups.diagnostic,
  ]);
});

test('a Head Teacher reads a Senior Head Teacher of another branch by full name', async ({
  page,
}) => {
  await signedIn(page, 'whoHeadTeacher');
  await page.goto('/people/head-teachers');
  await expect(heading(page, en.people.headTeachers.title)).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'Toshev Bahrom' })).toHaveCount(1);
});
