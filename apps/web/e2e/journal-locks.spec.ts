import { expect, test, type Browser, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

async function signedIn(page: Page, key: 'locksTeacher' | 'locksHead' | 'locksVice') {
  const account = accountOf(key);
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  if (key === 'locksVice') {
    // The role requires a second step at sign-in (task 0.7b): set up as audit.spec.ts does.
    await expect(heading(page, en.setUp.title)).toBeVisible();
    await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
    const secret = await page.locator('dd').innerText();
    await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(secret));
    await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
    await page.getByRole('checkbox', { name: en.setUp.saved }).check();
    await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  }
  await expect(heading(page, en.home.title)).toBeVisible();
}

async function inOwnBrowser(
  browser: Browser,
  key: 'locksHead' | 'locksVice',
  work: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signedIn(page, key);
  await work(page);
  await context.close();
}

/** The journal of 7 Kent, as the Journals page opens it. */
async function openJournal(page: Page) {
  await page.goto('/journal');
  await page.locator('tbody tr').filter({ hasText: '7 Kent' }).getByRole('button').first().click();
  await expect(heading(page, en.journal.sheet)).toBeVisible();
}

const cellOf = (page: Page, name: string) =>
  page.locator('.ag-row').filter({ hasText: name }).first().locator('[col-id$=":a"]').last();

// docs/spec/07-journal.md, Editing rules and locks: "To change a locked lesson the teacher sends
// an unlock request"; docs/spec/edge-cases/journal.md, Locks, unlocks and corrections: "The
// Head Teacher approves and sets 1 to 7 days ... Entries made under it are marked 'entered after
// the edit period' with the approver's name"; "The Academic Vice Principal corrects a mark ...
// needs a reason ... leaves a marker in the cell" (task 8.4). The "Locks browser test branch"
// holds a class of three students with one lesson five days ago and one edit day, so the lesson
// is locked. All names are invented.
test('a teacher asks to unlock a locked lesson, the Head Teacher approves, the teacher enters, and the Academic Vice Principal corrects', async ({
  page,
  browser,
}) => {
  // Three sign-ins, as the other tests with several sessions.
  test.setTimeout(120_000);
  await signedIn(page, 'locksTeacher');
  await openJournal(page);
  const panel = page.getByRole('region', { name: en.journal.locks.title });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: en.journal.locks.request, exact: true }).click();
  const ask = page.getByRole('form', { name: /^Request unlock:/ });
  await ask.getByRole('textbox', { name: en.journal.locks.reason, exact: true }).fill('I was ill');
  await ask.getByRole('button', { name: en.journal.locks.send, exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(panel.getByRole('button', { name: en.journal.locks.withdraw })).toBeVisible();

  await inOwnBrowser(browser, 'locksHead', async (head) => {
    await head.goto('/journal/unlocks');
    await expect(heading(head, en.journal.unlocks.title)).toBeVisible();
    await head
      .locator('tbody tr')
      .filter({ hasText: '7 Kent' })
      .getByRole('button')
      .first()
      .click();
    await head.getByRole('button', { name: en.journal.unlocks.decide, exact: true }).click();
    const decide = head.getByRole('form', { name: en.journal.locks.decideTitle });
    await decide
      .getByRole('combobox', { name: en.journal.locks.days, exact: true })
      .selectOption('2');
    await decide.getByRole('button', { name: en.journal.locks.approve, exact: true }).click();
    await expect(decide).toHaveCount(0);
  });

  await page.reload();
  const alimova = cellOf(page, 'Alimova Sevara');
  await alimova.click();
  await page.keyboard.press('1');
  await expect(alimova.locator('[data-save-state="saved"]')).toBeVisible();
  await page.reload();
  await expect(cellOf(page, 'Alimova Sevara').locator('[data-marker="late"]')).toBeVisible();

  await inOwnBrowser(browser, 'locksVice', async (vice) => {
    await openJournal(vice);
    const own = vice.getByRole('region', { name: en.journal.locks.title });
    await own.getByRole('button', { name: en.journal.locks.correct, exact: true }).click();
    const reason = vice.getByRole('form', { name: /^Correct:/ });
    await reason
      .getByRole('textbox', { name: en.journal.locks.correctReason, exact: true })
      .fill('The register shows an absence');
    await reason
      .getByRole('button', { name: en.journal.locks.startCorrecting, exact: true })
      .click();
    const rahimov = cellOf(vice, 'Rahimov Bekzod');
    await rahimov.click();
    await vice.keyboard.press('0');
    await expect(rahimov.locator('[data-save-state="saved"]')).toBeVisible();
    await vice.reload();
    await expect(
      cellOf(vice, 'Rahimov Bekzod').locator('[data-marker="correction"]'),
    ).toBeVisible();
  });
});
