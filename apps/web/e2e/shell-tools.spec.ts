import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, chooseTheme, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/build-plan.md, task 0.8b-3: the shell tools. docs/spec/12-ux-standards.md:
// "Light and dark themes" on every page; "Ctrl+K opens a search across ... pages";
// Devices: a tablet or a phone has no Ctrl+K. docs/spec/14-quality-plan.md,
// Monitoring: "A feedback button on every page sends a report".
test('the theme is kept, Ctrl+K and the search button open the pages, and a report is sent', async ({
  page,
}) => {
  const account = accountOf('shellTools');
  const html = page.locator('html');

  // The theme is chosen before sign-in, with the theme button of the sign-in
  // page (pull request #61, decision 2), and kept by the browser.
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: en.theme.toDark, exact: true }).click();
  await expect(html).toHaveClass(/dark/);

  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(html).toHaveClass(/dark/);
  // In the app, the person menu at the foot of the navy menu (decision 3).
  await chooseTheme(page, en, 'light');
  await expect(html).not.toHaveClass(/dark/);

  // Ctrl+K: the box has the focus; typing narrows the pages; Enter opens one.
  await page.keyboard.press('ControlOrMeta+K');
  const search = page.getByRole('dialog', { name: en.search.label });
  await expect(search).toBeVisible();
  await expect(search.getByRole('combobox', { name: en.search.label })).toBeFocused();
  await expect(search.getByRole('option')).toHaveCount(4);
  await page.keyboard.type('pass');
  await expect(search.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(heading(page, en.password.titleOwn)).toBeVisible();
  await expect(search).toBeHidden();
  await page.goto('/');
  await expect(heading(page, en.home.title)).toBeVisible();

  // On a phone there is no Ctrl+K: the button in the top bar opens the same search.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: en.search.label, exact: true }).click();
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  // A report: an empty message is refused in the browser; a sent one gets the sign.
  await page.getByRole('button', { name: en.feedback.button, exact: true }).click();
  const feedback = page.getByRole('dialog', { name: en.feedback.title });
  await expect(feedback).toBeVisible();
  const message = feedback.getByLabel(en.feedback.message, { exact: true });
  await expect(message).toBeFocused();
  await feedback.getByRole('button', { name: en.feedback.send, exact: true }).click();
  await expect(message).toHaveAccessibleDescription(en.form.required);
  await message.fill('The password page could say how long a password may be.');
  await feedback.getByRole('button', { name: en.feedback.send, exact: true }).click();
  await expect(feedback.getByRole('status')).toHaveText(en.feedback.sent);
  await expect(message).toHaveValue('');
  await feedback.getByRole('button', { name: en.confirm.cancel, exact: true }).click();
  await expect(feedback).toBeHidden();
});

// Task 3.2d (pull request #94): Ctrl+K over records. The seeded Academic Vice
// Principal types part of a class name in another script (a Cyrillic О, which
// the class names fold as the Latin O), the class shows under Classes, and
// Enter opens it in the side panel of the Classes list.
test('Ctrl+K finds a class by part of its name and opens it in its list', async ({ page }) => {
  const account = accountOf('recordSearch');
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

  await page.keyboard.press('ControlOrMeta+K');
  const search = page.getByRole('dialog', { name: en.search.label });
  await expect(search).toBeVisible();
  // "Оxf" with a Cyrillic О.
  await page.keyboard.type('\u041exf');
  const classes = search.getByRole('group', { name: en.search.classes });
  await expect(classes.getByRole('option')).toHaveCount(1);
  await expect(classes.getByRole('option')).toContainText('7 Oxford');
  await expect(search.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(search).toBeHidden();
  await expect(page).toHaveURL(/\/classes\?open=/);
  await expect(page.getByRole('complementary', { name: '7 Oxford' })).toBeVisible();
});
