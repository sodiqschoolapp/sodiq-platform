import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// edge/students-classes-groups, "A student moves to another branch": "The
// sending Academic Vice Principal releases the student and the receiving one
// accepts, choosing class and groups ... The record, UID, relatives and
// history stay the same and are readable in the new branch." Task 3.3c, pull
// request #97. An Academic Vice Principal of two branches releases a student
// of 7 Oxford today, switches to the receiving branch, accepts the student
// into 7 Cambridge, and sees the record there with the old class on the
// History tab. All names are invented.
test('a student is released by one branch and accepted by another', async ({ page }) => {
  const account = accountOf('branchMoves');
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

  const texts = en.people.students;
  const moves = texts.branchMoves;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  const bar = page.getByRole('banner', { name: en.layout.topBar });
  const branch = bar.getByLabel(en.switcher.branch);

  // The release, today, in the sending branch.
  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await branch.selectOption({ label: 'Sending browser test branch' });
  await page.getByRole('button', { name: 'Qosimova Gulshan', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Gulshan Qosimova' });
  await panel.getByRole('button', { name: moves.move, exact: true }).click();
  const release = panel.getByRole('form', { name: moves.move });
  await release
    .getByLabel(moves.toBranch, { exact: true })
    .selectOption({ label: 'Receiving browser test branch' });
  await release.getByLabel(moves.from, { exact: true }).fill(today);
  await release.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText(/Released to Receiving browser test branch/)).toBeVisible();

  // The accept in the receiving branch, into 7 Cambridge.
  await branch.selectOption({ label: 'Receiving browser test branch' });
  const incoming = page.getByRole('region', { name: /Released to this branch/ });
  const row = incoming.getByRole('listitem', { name: 'Qosimova Gulshan' });
  await expect(row).toContainText('9999951');
  await row.getByRole('button', { name: moves.accept, exact: true }).click();
  await row.getByLabel(moves.class, { exact: true }).selectOption({ label: '7 Cambridge' });
  await row.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(incoming.getByText(/is in 7 Cambridge now/)).toBeVisible();

  // The record is of this branch now, with the same UID; the History tab
  // shows the old branch's class and the move.
  const listed = page.locator('tbody tr').filter({ hasText: '9999951' });
  await expect(listed).toContainText('7 Cambridge');
  await page.getByRole('button', { name: 'Qosimova Gulshan', exact: true }).click();
  const moved = page.getByRole('complementary', { name: 'Gulshan Qosimova' });
  await moved
    .getByRole('radiogroup', { name: texts.tabs.label })
    .getByText(texts.tabs.history, { exact: true })
    .click();
  await expect(
    moved.getByText(
      /Moved from Sending browser test branch to Receiving browser test branch, into 7 Cambridge/,
    ),
  ).toBeVisible();
  await expect(
    moved.getByText(texts.moves.classJoin.replace('{{class}}', '7 Oxford')),
  ).toBeVisible();
});
