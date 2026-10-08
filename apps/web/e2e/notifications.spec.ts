import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, type Credentials } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';

/**
 * Sends a sample notification to the account, as a later task would from the
 * server: the command of the browser-test API writes it and the worker inside
 * that API delivers it.
 */
function notify(login: string, text: string): void {
  execFileSync(process.execPath, ['dist-e2e/testing/e2e/notify.js', login, text], {
    cwd: path.resolve(import.meta.dirname, '../../api'),
    encoding: 'utf8',
  });
}

/** The first sign-in of a seeded account: the forced change, then the home page. */
async function firstSignIn(page: Page, account: Credentials): Promise<void> {
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(heading(page, en.home.title)).toBeVisible();
}

/** How long a notification may take to arrive live on a loaded machine. */
const LIVE_MS = 20_000;

const bell = (page: Page, unread?: number) =>
  page.getByRole('button', {
    name:
      unread === undefined ? en.notifications.button : `Notifications, ${String(unread)} unread`,
    exact: true,
  });

// docs/build-plan.md, task 0.9: the list and unread count in the top bar;
// live arrival over Socket.IO. A notification sent before the sign-in is in
// the list; one sent while the page is open arrives without a reload, through
// the job, the channel and the WebSocket of the Vite proxy; "Mark all as
// read" brings the count to zero.
test('shows the unread count, receives a notification live and marks all as read', async ({
  page,
}) => {
  // Three runs of the command (a NestJS context each) and the worker's polling
  // (2 s) between them: more than the usual half minute when the other tests load the machine.
  test.setTimeout(120_000);
  const account = accountOf('notifications');
  notify(account.login, 'Sent before the sign-in.');

  await firstSignIn(page, account);
  await expect(bell(page, 1)).toBeVisible();

  // The live arrival: no reload, no click. Through the job (polled every 2 s),
  // the channel and the WebSocket of the Vite proxy.
  notify(account.login, 'Sent while the page is open.');
  await expect(bell(page, 2)).toBeVisible({ timeout: LIVE_MS });

  await bell(page, 2).click();
  const dialog = page.getByRole('dialog', { name: en.notifications.title });
  await expect(dialog).toBeVisible();
  const items = dialog.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Sample: Sent while the page is open.');
  await expect(items.nth(0)).toContainText(en.notifications.unread);
  await expect(items.nth(1)).toContainText('Sample: Sent before the sign-in.');

  await dialog.getByRole('button', { name: en.notifications.markAllRead, exact: true }).click();
  await expect(dialog.getByText(en.notifications.unread)).toHaveCount(0);
  // The bell is behind the dialog, which hides the page from the accessibility tree: close it first.
  await dialog.getByRole('button', { name: en.notifications.close, exact: true }).click();
  await expect(bell(page)).toBeVisible();

  // A third one, read in the dialog itself by a click: the count moves with it.
  notify(account.login, 'A third one.');
  await expect(bell(page, 1)).toBeVisible({ timeout: LIVE_MS });
  await bell(page, 1).click();
  await dialog.getByRole('listitem').nth(0).getByRole('button').click();
  await expect(dialog.getByText(en.notifications.unread)).toHaveCount(0);
  await dialog.getByRole('button', { name: en.notifications.close, exact: true }).click();
  await expect(bell(page)).toBeVisible();
});
