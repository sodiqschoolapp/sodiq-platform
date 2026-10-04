import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, signIn } from './steps';

const selected = (count: number): string =>
  en.list.selected_other.replace('{{count}}', String(count));

// docs/build-plan.md, task 0.8b-1: a sample list uses only the shared pieces.
// docs/spec/12-ux-standards.md, Lists: search, filters, column chooser,
// sorting, checkboxes with bulk actions, export and a side panel; Look and
// feel: full keyboard use. Once signed in, the test touches no mouse.
test('the sample list is worked with the keyboard alone, and its state is in the address', async ({
  page,
}) => {
  const account = accountOf('patterns');
  await page.goto('/sign-in');
  await page.getByRole('combobox').selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/dev/patterns');
  await expect(heading(page, en.sample.title)).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(100);

  // Search while typing; the address follows.
  await page.getByRole('searchbox', { name: en.list.search }).focus();
  await page.keyboard.type('ergashev');
  await expect(rows).toHaveCount(20);
  await expect(page).toHaveURL(/[?&]q=ergashev/);

  // Sorting, from the end at the second press.
  const nameHeader = page.getByRole('columnheader', { name: en.sample.name });
  await nameHeader.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  await page.keyboard.press('Enter');
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(rows.first()).toContainText('Zafar Ergashev');

  // "Tick all" takes the rows that match the search.
  await page.getByRole('checkbox', { name: en.list.selectAll }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('status')).toHaveText(selected(20));

  // The column chooser; the choice is kept by the browser.
  await page.getByRole('button', { name: en.list.columns }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitemcheckbox', { name: en.sample.score }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: en.sample.score })).toBeHidden();

  // A record opens beside the list and has an address of its own.
  await page.getByRole('button', { name: 'Zafar Ergashev' }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Zafar Ergashev' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Zafar Ergashev' })).toBeFocused();
  await expect(page).toHaveURL(/[?&]open=sample-/);
  await expect(rows).toHaveCount(20);

  // The address holds the search, the order and the open record.
  await page.reload();
  await expect(panel).toBeVisible();
  await expect(page.getByRole('searchbox', { name: en.list.search })).toHaveValue('ergashev');
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(rows).toHaveCount(20);
  await expect(page.getByRole('columnheader', { name: en.sample.score })).toBeHidden();

  // Escape closes the panel and gives the focus back to the row.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Zafar Ergashev' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Zafar Ergashev' })).toBeFocused();

  // The Back button of the browser undoes the last step: the panel is open again.
  await page.goBack();
  await expect(panel).toBeVisible();
});
