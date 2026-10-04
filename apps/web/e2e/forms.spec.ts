import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, signIn } from './steps';

// docs/build-plan.md, task 0.8b-2: a sample form uses only the shared pieces.
// docs/spec/12-ux-standards.md, No lost work: forms check each field as it is
// typed and say in plain words what to fix. Decided by the owner: a Save
// button on record forms, and a warning before leaving with typed changes.
test('the sample form is filled from the keyboard, saved, and not left by accident', async ({
  page,
}) => {
  const account = accountOf('forms');
  await page.goto('/sign-in');
  await page.getByRole('combobox').selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();

  await page.goto('/dev/patterns?q=abdullayev');
  await expect(heading(page, en.sample.title)).toBeVisible();
  const topBar = page.locator('header').first();
  const sign = topBar.getByRole('status');

  // The record opens beside the list, as a form.
  await page.getByRole('button', { name: 'Bekzod Abdullayev' }).click();
  const panel = page.getByRole('complementary', { name: 'Bekzod Abdullayev' });
  const form = panel.getByRole('form', { name: 'Bekzod Abdullayev' });
  const grade = form.getByLabel(en.sample.grade);
  const score = form.getByLabel(en.sample.score);
  await expect(grade).toHaveValue('6');
  await expect(sign).toBeEmpty();

  // A field says what to fix as it is typed; Save sends nothing and goes to it.
  await grade.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('6.5');
  await expect(grade).toHaveAccessibleDescription(en.form.wholeNumber);
  await expect(sign).toHaveText(en.unsent.typed);
  await score.focus();
  await page.keyboard.press('Enter');
  await expect(grade).toBeFocused();
  await expect(form.getByRole('status')).toBeEmpty();

  // Fixed and saved with Enter: the form says so and the list shows it.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('7');
  await expect(grade).not.toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Enter');
  await expect(form.getByRole('status')).toHaveText(en.form.saved);
  await expect(page.locator('tbody tr').nth(1)).toContainText('7 Cambridge');
  await expect(sign).toBeEmpty();

  // Typed and not saved: the Back button of the browser asks first.
  await score.fill('90');
  await expect(sign).toHaveText(en.unsent.typed);
  await page.goBack();
  const question = page.getByRole('alertdialog', { name: en.unsent.leaveTitle });
  await expect(question.getByRole('listitem')).toHaveText('Bekzod Abdullayev');
  await expect(question.getByRole('button', { name: en.unsent.stay })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(question).toBeHidden();
  await expect(score).toHaveValue('90');
  await expect(page).toHaveURL(/open=sample-0002/);

  // Reloading or closing the tab is asked by the browser itself.
  const browserAsks = page.waitForEvent('dialog');
  // A moment later: the question of the browser holds the page until it is
  // answered. As a text: this file is not type-checked as code of a page.
  await page.evaluate('window.setTimeout(() => { window.location.reload(); }, 0)');
  const browserQuestion = await browserAsks;
  expect(browserQuestion.type()).toBe('beforeunload');
  await browserQuestion.dismiss();
  await expect(score).toHaveValue('90');

  // The sign in the top bar leads back to the form.
  await sign.getByRole('button', { name: en.unsent.typed }).click();
  await expect(form.getByLabel(en.sample.name, { exact: true })).toBeFocused();

  // Leaving by choice drops what was typed.
  await page.getByRole('navigation', { name: en.layout.breadcrumbs }).getByRole('link').click();
  await question.getByRole('button', { name: en.unsent.leave }).click();
  await expect(heading(page, en.home.title)).toBeVisible();
});
