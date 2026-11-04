import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { NEW_PASSWORD, accountOf } from './accounts';
import { keepSecondStep, keptSecondStep } from './second-steps';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Task 10.5 (pull request #280), done when: "the browser test jumps a day and sees the new date".
// This file runs in the Playwright project `demo-clock`, which depends on `chromium`
// (playwright.config.ts): in each part of CI it starts after every other spec of that part has
// finished, since the jump moves the time of the part's whole database `sodiq_e2e`.
test('the Super Admin moves demo time a day on and every page shows the new date', async ({
  page,
}) => {
  // The seed's Super Admin of setup.spec.ts: signed in again with the key its test kept when that
  // test ran in this part; otherwise signed in for the first time here.
  const account = accountOf('superAdmin');
  const kept = keptSecondStep(account.login);
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  if (kept === undefined) {
    await signIn(page, en, account.login, account.password);
    await changeFirstPassword(page, en, account);
    await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
    const key = await page.locator('dd').innerText();
    keepSecondStep(account.login, key);
    await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(key));
    await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
    await page.getByRole('checkbox', { name: en.setUp.saved }).check();
    await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  } else {
    await signIn(page, en, account.login, NEW_PASSWORD);
    await expect(heading(page, en.code.title)).toBeVisible();
    await page.getByLabel(en.code.label, { exact: true }).fill(codeNow(kept));
    await page.getByRole('button', { name: en.code.submit, exact: true }).click();
  }
  await expect(heading(page, en.home.title)).toBeVisible();
  // Real time until the first jump: no demo time in the top bar.
  await expect(page.getByText(/^Demo time:/)).toHaveCount(0);

  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.setup) })
    .click();
  await page
    .getByRole('list', { name: en.setup.title })
    .getByRole('link', { name: en.setup.demoClockLink, exact: true })
    .click();
  await expect(heading(page, en.setup.demoClock.title)).toBeVisible();

  // Tomorrow at 07:05 in Tashkent, the time zone of every branch.
  const tomorrow = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(new Date(Date.now() + 86_400_000));
  const part = (type: string) => tomorrow.find((one) => one.type === type)?.value ?? '';
  const expected = `Demo time: ${part('weekday')}, ${part('day')} ${part('month').slice(0, 3)} ${part('year')}, 07:05`;

  await page.getByRole('button', { name: en.setup.demoClock.quick.tomorrow, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: en.setup.demoClock.confirmAction, exact: true }).click();
  await expect(dialog).toBeHidden();

  // The jump answers once it has taken effect; the page reads everything again.
  await expect(page.getByText(/^Demo time:/)).toHaveText(new RegExp(`^${expected}`), {
    timeout: 20_000,
  });
  // Still signed in on another page, at the new date.
  await page.goto('/');
  await expect(heading(page, en.home.title)).toBeVisible();
  await expect(page.getByText(/^Demo time:/)).toHaveText(new RegExp(`^${expected}`));
});
