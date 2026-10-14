import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/05-classes-groups-subjects.md, Class and Language of instruction
// ("The same holds when a Tutor is given a class. This is blocked, not a
// warning"); task 3.1a, pull request #88. An Academic Vice Principal creates
// "7 Oxford", an Uzbek class, gives it a Tutor who teaches in Uzbek, and is
// not let choose one who teaches in Russian only. With SCREENSHOTS=1 the list
// and the panel are saved for the report under docs/screens/3.1a/. All names
// are invented.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.1a');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal creates a class and gives it a Tutor of its language', async ({
  page,
}) => {
  const account = accountOf('classes');
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

  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.classes) })
    .click();
  await expect(heading(page, en.classes.title)).toBeVisible();

  const texts = en.classes;
  // The header's button comes first; the empty list offers the same action.
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const create = page.getByRole('form', { name: texts.newTitle });
  await create.getByLabel(texts.grade, { exact: true }).selectOption('7');
  await create.getByLabel(texts.className, { exact: true }).fill('Oxford');
  await create.getByLabel(texts.language, { exact: true }).selectOption('uz');
  await create.getByLabel(texts.maxSize, { exact: true }).fill('25');
  await create.getByRole('button', { name: en.form.save, exact: true }).click();

  const panel = page.getByRole('complementary', { name: '7 Oxford' });
  await expect(panel).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '7 Oxford' });
  await expect(row).toContainText(texts.noTutor);

  await panel.getByRole('button', { name: texts.giveTutor, exact: true }).click();
  const give = panel.getByRole('form', { name: texts.giveTutor });
  const person = give.getByLabel(texts.person, { exact: true });
  // A person who does not teach in Uzbek is shown with the reason and cannot be chosen.
  await expect(
    person.locator('option', { hasText: 'Smirnov Pavel (does not teach in Uzbek)' }),
  ).toBeDisabled();
  await screenshot(page, 'give-tutor');
  await person.selectOption({ label: 'Salimova Zuhra' });
  await give.getByRole('button', { name: en.form.save, exact: true }).click();

  await expect(panel.getByText(`${texts.kinds.tutor}: Salimova Zuhra`)).toBeVisible();
  await expect(row).toContainText('Salimova Zuhra');
  await screenshot(page, 'class-with-tutor');
});
