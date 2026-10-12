import { mkdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { uz } from '../src/i18n/locales/uz';
import { accountOf } from './accounts';
import { pngOf } from './photos';
import { heading, languageChooser, openPersonMenu, signIn } from './steps';

// The outbox of the API of the browser tests (apps/api/src/testing/e2e/mail.ts):
// each mail is one JSON file there.
const OUTBOX = path.join(tmpdir(), 'sodiq-e2e-mail');
// The invented address on the seeded teacher's record (the same file).
const ADDRESS = 'madina.xolmatova@example.test';
const CHOSEN = 'a chosen new password 7';

// With SCREENSHOTS=1 the pages are saved for the report under docs/screens/2.3c-2/.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/2.3c-2');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** The newest mail to the address: the worker of the API sends it a moment after the request. */
async function newestMailTo(address: string): Promise<Mail | undefined> {
  let files: string[];
  try {
    files = await readdir(OUTBOX);
  } catch {
    return undefined;
  }
  const mails = await Promise.all(
    files.map(async (file) => {
      const full = path.join(OUTBOX, file);
      return {
        mail: JSON.parse(await readFile(full, 'utf8')) as Mail,
        at: (await stat(full)).mtimeMs,
      };
    }),
  );
  return mails
    .filter((one) => one.mail.to === address)
    .sort((a, b) => b.at - a.at)
    .at(0)?.mail;
}

// docs/build-plan.md, task 2.3c-2, done when: the browser test asks for a
// reset from the sign-in page and sets the own photo. The mail is written to
// the outbox only (the owner's answer 16); the rules of the link are proved
// by the API tests. All names and addresses are invented.
test('asks for a reset from the sign-in page, chooses a new password with the link, and sets the own photo', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const account = accountOf('emailReset');

  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await page.getByRole('link', { name: en.signIn.forgot, exact: true }).click();
  await expect(heading(page, en.forgot.title)).toBeVisible();
  await page.getByLabel(en.forgot.login, { exact: true }).fill(account.login);
  await screenshot(page, 'forgot');
  await page.getByRole('button', { name: en.forgot.submit, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(en.forgot.sent);

  // The worker of the API makes the link and writes the mail, in the
  // account's language: Uzbek, the language of a new account (the page's
  // language before sign-in is the browser's own).
  let mail: Mail | undefined;
  await expect
    .poll(
      async () => {
        mail = await newestMailTo(ADDRESS);
        return mail?.subject;
      },
      { timeout: 30_000 },
    )
    .toBe(uz.reset.title);
  const link = /(http\S+\/reset-password#token=[A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1];
  expect(link).toBeDefined();

  await page.goto(link ?? '');
  await expect(heading(page, en.reset.title)).toBeVisible();
  // The token is taken out of the address at once.
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel(en.password.new, { exact: true }).fill(CHOSEN);
  await page.getByLabel(en.password.repeat, { exact: true }).fill(CHOSEN);
  await screenshot(page, 'reset');
  await page.getByRole('button', { name: en.reset.submit, exact: true }).click();

  await expect(heading(page, en.signIn.title)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(en.signIn.passwordChanged);
  // The first password no longer works; the chosen one does, with no forced change.
  await signIn(page, en, account.login, account.password);
  await expect(page.getByText(en.errors.sign_in_failed)).toBeVisible();
  await signIn(page, en, account.login, CHOSEN);
  await expect(heading(page, en.home.title)).toBeVisible();

  // The own photo on the account page.
  await openPersonMenu(page, en);
  await page.getByRole('menuitem', { name: en.account.title, exact: true }).click();
  await expect(heading(page, en.account.title)).toBeVisible();
  const photo = page.getByRole('region', { name: en.account.photoTitle });
  await expect(photo.getByRole('button', { name: en.account.photoAdd })).toBeVisible();
  await photo.getByLabel(en.account.photoAdd).setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: pngOf(400, 300),
  });
  await expect(photo.getByRole('img', { name: 'Madina Xolmatova' })).toBeVisible();
  await screenshot(page, 'own-photo');

  await page.reload();
  await expect(
    page
      .getByRole('region', { name: en.account.photoTitle })
      .getByRole('img', { name: 'Madina Xolmatova' }),
  ).toBeVisible();
});
