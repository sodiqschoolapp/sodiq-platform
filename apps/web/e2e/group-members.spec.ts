import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/05-classes-groups-subjects.md, Group ("Every student of the
// classes involved must be in exactly one group for that subject; the screen
// lists students not yet placed"; "A bulk screen places students ... into
// groups for one subject and one grade ... at a time");
// docs/spec/edge-cases/students-classes-groups.md ("Bulk placement puts
// students into the smallest suitable group and tags them \"placed
// automatically, review\""); task 3.2b, pull request #92. An Academic Vice
// Principal puts two students of 7 Oxford into 7-G-1 from its panel, then
// places the other two with "Place automatically" on the placement screen,
// where both go into the smaller 7-G-2, tagged for review, and marks one
// reviewed. With SCREENSHOTS=1 the screens are saved for the report under
// docs/screens/3.2b/. All names are invented.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.2b');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal places students into groups by hand and automatically', async ({
  page,
}) => {
  const account = accountOf('groupMembers');
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

  const texts = en.groups;
  await page.goto('/groups');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: '7-G-1', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '7-G-1' });
  await expect(panel.getByText(texts.noMembers)).toBeVisible();
  await panel.getByRole('button', { name: texts.putIntoGroup, exact: true }).click();
  const form = panel.getByRole('form', { name: texts.putIntoNamed.replace('{{group}}', '7-G-1') });
  await form.getByRole('checkbox', { name: /Aliyeva Nodira/ }).check();
  await form.getByRole('checkbox', { name: /Bakirova Feruza/ }).check();
  await screenshot(page, 'put-into-group');
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText('Aliyeva Nodira', { exact: true })).toBeVisible();
  await expect(panel.getByText('Bakirova Feruza', { exact: true })).toBeVisible();

  // The placement screen: Geometry and grade 7 are the only choice.
  await page.goto('/groups');
  await page.getByRole('link', { name: texts.placementLink, exact: true }).click();
  await expect(heading(page, texts.placement.title)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Davronova Gulchehra' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Aliyeva Nodira' })).toHaveCount(0);
  await screenshot(page, 'placement-screen');
  await page.getByRole('button', { name: texts.placement.automatic, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Ergasheva Iroda');
  await dialog.getByRole('button', { name: texts.placement.automatic, exact: true }).click();
  await expect(
    page.getByText(texts.placement.placedAutomatically_other.replace('{{n}}', '2')),
  ).toBeVisible();
  await expect(page.getByText(texts.placement.emptyTitle)).toBeVisible();

  // Both went into the smaller group, tagged for review.
  await page.goto('/groups');
  await page.getByRole('button', { name: '7-G-2', exact: true }).click();
  const second = page.getByRole('complementary', { name: '7-G-2' });
  await expect(second.getByText(texts.review)).toHaveCount(2);
  await screenshot(page, 'review-tags');
  await second.getByRole('button', { name: texts.markReviewed, exact: true }).first().click();
  await expect(second.getByText(texts.review)).toHaveCount(1);

  // The student list shows the groups.
  await page.goto('/people/students');
  await expect(page.getByRole('row').filter({ hasText: 'Aliyeva Nodira' })).toContainText('7-G-1');
  await expect(page.getByRole('row').filter({ hasText: 'Ergasheva Iroda' })).toContainText('7-G-2');
});
