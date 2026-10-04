import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, signIn } from './steps';

const selected = (count: number): string => en.list.selected_other.replace('{{n}}', String(count));

// docs/build-plan.md, task 0.8b-1: a sample list uses only the shared pieces.
// docs/spec/12-ux-standards.md, Lists: search, filters, column chooser,
// sorting, checkboxes with bulk actions, export and a side panel; Look and
// feel: full keyboard use.
//
// The controls above the table are reached with the Tab key, in their order,
// and worked with the keyboard. Two steps are not keyboard steps: a value of a
// filter is chosen by the test directly, and the focus is put on a row and on
// an item of the column menu instead of walking there.
test('the sample list is worked from the keyboard, and its state is in the address', async ({
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
  const list = page.getByRole('main');
  const rows = page.locator('tbody tr');
  const search = page.getByRole('searchbox', { name: en.list.search });
  await expect(rows).toHaveCount(100);

  // Search while typing; the address follows.
  await search.focus();
  await page.keyboard.type('ergashev');
  await expect(rows).toHaveCount(20);
  await expect(page).toHaveURL(/[?&]q=ergashev/);

  // Tab: the filters.
  const status = list.getByRole('combobox', { name: en.sample.status });
  await page.keyboard.press('Tab');
  await expect(status).toBeFocused();
  await status.selectOption('archived');
  await expect(rows).toHaveCount(2);
  await expect(page).toHaveURL(/archived/);
  await status.selectOption('');
  await expect(rows).toHaveCount(20);
  await page.keyboard.press('Tab');
  await expect(list.getByRole('combobox', { name: en.sample.language })).toBeFocused();

  // Tab: the column chooser; the choice is kept by the browser.
  const columns = page.getByRole('button', { name: en.list.columns });
  await page.keyboard.press('Tab');
  await expect(columns).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitemcheckbox', { name: en.sample.score }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: en.sample.score })).toBeHidden();
  await expect(columns).toBeFocused();

  // Tab: the export, which asks for the rows that match.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: en.list.export })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText(en.sample.exported_other.replace('{{n}}', '20'))).toBeVisible();

  // Tab: "tick all", past the bulk actions, which are off while nothing is
  // ticked. It takes the rows that match the search.
  const tickAll = page.getByRole('checkbox', { name: en.list.selectAll });
  await page.keyboard.press('Tab');
  await expect(tickAll).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByText(selected(20))).toBeVisible();

  // Back to the bulk action, now on: it is handed the ticked rows.
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: en.list.clearSelection })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const archive = page.getByRole('button', { name: en.sample.archive });
  await expect(archive).toBeFocused();
  await page.keyboard.press('Enter');
  // The action asks first and names what it will touch (task 0.8b-2). The
  // focus starts on Cancel; Tab leads to the button that goes on.
  const question = page.getByRole('alertdialog', {
    name: en.sample.archiveTitle_other.replace('{{n}}', '20'),
  });
  await expect(question.getByRole('listitem').first()).toHaveText('Aziza Ergashev');
  await expect(question.getByRole('button', { name: en.confirm.cancel })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(question.getByRole('button', { name: en.sample.archive })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(question).toBeHidden();
  await expect(rows.filter({ hasText: en.sample.archived })).toHaveCount(20);
  // The dialog gives the focus back to the button it came from.
  await expect(archive).toBeFocused();

  // Tab: the first column header. Sorting, from the end at the second press.
  const nameHeader = page.getByRole('columnheader', { name: en.sample.name });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(nameHeader.getByRole('button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  await page.keyboard.press('Enter');
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(rows.first()).toContainText('Zafar Ergashev');

  // A record opens beside the list and has an address of its own.
  const row = page.getByRole('button', { name: 'Zafar Ergashev' });
  await row.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Zafar Ergashev' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Zafar Ergashev' })).toBeFocused();
  await expect(page).toHaveURL(/[?&]open=sample-/);
  await expect(rows).toHaveCount(20);

  // The address holds the search, the order and the open record.
  await page.reload();
  await expect(panel).toBeVisible();
  await expect(search).toHaveValue('ergashev');
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(rows).toHaveCount(20);
  await expect(page.getByRole('columnheader', { name: en.sample.score })).toBeHidden();

  // Escape closes the panel and gives the focus back to the row.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(row).toBeFocused();

  // On a narrow screen the record takes the place of the list: nothing that
  // cannot be seen takes the focus, and the top bar stays.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(search).toBeHidden();
  await expect(rows.first()).toBeHidden();
  await expect(page.getByRole('button', { name: en.layout.account })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: en.list.closePanel })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toBeHidden();
  await expect(search).toBeVisible();
  await expect(row).toBeFocused();

  // The Back button of the browser undoes the last step: the panel is open again.
  await page.goBack();
  await expect(panel).toBeVisible();
});
