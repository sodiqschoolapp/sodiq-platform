import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/05-classes-groups-subjects.md, Group and Language of instruction,
// Groups ("A group takes its language from its classes when they share one. A
// group that mixes Uzbek and Russian classes is possible; the Academic Vice
// Principal then chooses the group's language and confirms a warning"); task
// 3.2a, pull request #91. An Academic Vice Principal creates "7-G-1" from two
// Uzbek classes, then "7-G-2" from an Uzbek and a Russian class with the
// language chosen and the warning confirmed. With SCREENSHOTS=1 the form and
// the list are saved for the report under docs/screens/3.2a/. All names are
// invented.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.2a');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal creates a group of one language and a confirmed mixed one', async ({
  page,
}) => {
  const account = accountOf('groups');
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

  // The groups are reached from the Classes item of the menu.
  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.classes) })
    .click();
  await expect(heading(page, en.classes.title)).toBeVisible();
  await page.getByRole('link', { name: en.classes.groupsLink, exact: true }).click();
  await expect(heading(page, en.groups.title)).toBeVisible();

  const texts = en.groups;
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  let create = page.getByRole('form', { name: texts.newTitle });
  await create.getByLabel(texts.subject, { exact: true }).selectOption({ label: 'Geometry' });
  await create.getByRole('checkbox', { name: '7 Oxford', exact: true }).check();
  await create.getByRole('checkbox', { name: '7 Princeton', exact: true }).check();
  await expect(
    create.getByText(texts.languageOfClasses.replace('{{language}}', 'Uzbek')),
  ).toBeVisible();
  await create.getByLabel(texts.groupName, { exact: true }).fill('7-G-1');
  await create.getByLabel(texts.maxSize, { exact: true }).fill('20');
  await screenshot(page, 'new-group');
  await create.getByRole('button', { name: en.form.save, exact: true }).click();

  await expect(page.getByRole('complementary', { name: '7-G-1' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '7-G-1' })).toContainText(
    '7 Oxford, 7 Princeton',
  );

  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  create = page.getByRole('form', { name: texts.newTitle });
  await create.getByLabel(texts.subject, { exact: true }).selectOption({ label: 'Geometry' });
  await create.getByRole('checkbox', { name: '7 Oxford', exact: true }).check();
  await create.getByRole('checkbox', { name: '7 Yale', exact: true }).check();
  await create.getByLabel(texts.language, { exact: true }).selectOption('ru');
  await create.getByLabel(texts.groupName, { exact: true }).fill('7-G-2');
  await create.getByLabel(texts.maxSize, { exact: true }).fill('20');
  await create.getByRole('button', { name: en.form.save, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('7 Yale');
  await screenshot(page, 'mixed-language');
  await dialog.getByRole('button', { name: texts.mixedConfirm, exact: true }).click();

  await expect(page.getByRole('complementary', { name: '7-G-2' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '7-G-2' })).toContainText('Russian');
  await screenshot(page, 'groups-list');
});
