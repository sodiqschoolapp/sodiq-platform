import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Task 3.5c (issue #105, Part D), with an account of its own (seeded in "Hand
// test 3.5c branch"). The steps of H36: a leaving with its last day next week
// is saved and its cancel pressed; a move to 7 Princeton is scheduled, its
// date changed, then cancelled. Wanted: "one continuous stay in one class is
// one stay everywhere": the class panel lists the student once, with no
// "Joins on" and no Withdraw of a second row; the History tab has one line
// for 7 Oxford "until now" (H35) and one move with its change, which never
// says "moved" (H34). All names are invented.
test('a cancelled leaving and a changed and cancelled move leave one stay in the class', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const account = accountOf('handTest35cStays');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await page.getByRole('button', { name: en.setUp.start, exact: true }).click();
  const secret = await page.locator('dd').innerText();
  await page.getByLabel(en.setUp.code, { exact: true }).fill(codeNow(secret));
  await page.getByRole('button', { name: en.setUp.confirm, exact: true }).click();
  await page.getByRole('checkbox', { name: en.setUp.saved }).check();
  await page.getByRole('button', { name: en.setUp.continue, exact: true }).click();
  await expect(heading(page, en.home.title)).toBeVisible();

  const texts = en.people.students;
  const moves = texts.moves;
  const dayMs = 24 * 60 * 60 * 1000;
  const inDays = (days: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(
      Date.now() + days * dayMs,
    );

  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: 'Usmonov Sardor', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Sardor Usmonov' });

  // A leaving with its last day next week, then its cancel.
  await panel.getByRole('button', { name: texts.leaveTitle, exact: true }).click();
  const leaving = panel.getByRole('form', { name: texts.leaveTitle });
  await leaving.getByLabel(texts.lastDay, { exact: true }).fill(inDays(7));
  await leaving.getByLabel(texts.reason, { exact: true }).fill('The family moved to Navoiy.');
  await leaving.getByRole('button', { name: en.form.save, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.leaveConfirmTitle })
    .getByRole('button', { name: texts.leaveAction, exact: true })
    .click();
  await panel.getByRole('button', { name: texts.cancelLeaving, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: texts.cancelConfirmTitle })
    .getByRole('button', { name: texts.cancelLeaving, exact: true })
    .click();
  await expect(panel.getByRole('button', { name: texts.leaveTitle, exact: true })).toBeVisible();

  // A move to 7 Princeton in six days, its date changed to thirteen, then cancelled.
  await panel.getByRole('button', { name: moves.moveClass, exact: true }).click();
  const move = panel.getByRole('form', { name: moves.moveClass });
  await move.getByLabel(moves.toClass, { exact: true }).selectOption({ label: '7 Princeton' });
  await move.getByLabel(moves.from, { exact: true }).fill(inDays(6));
  await move.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText(/Moves to 7 Princeton on/)).toBeVisible();
  const target = '7 Princeton';
  await panel
    .getByRole('button', { name: moves.change.replace('{{target}}', target), exact: true })
    .click();
  const change = panel.getByRole('form');
  await change.getByLabel(moves.from, { exact: true }).fill(inDays(13));
  await change.getByRole('button', { name: en.form.save, exact: true }).click();
  const cancel = moves.cancel.replace('{{target}}', target);
  await panel.getByRole('button', { name: cancel, exact: true }).click();
  await page
    .getByRole('alertdialog', { name: moves.cancelTitle })
    .getByRole('button', { name: cancel, exact: true })
    .click();
  await expect(panel.getByText(/Moves to 7 Princeton on/)).toHaveCount(0);

  // The History tab: one line for 7 Oxford "until now", one move with its change.
  await panel
    .getByRole('radiogroup', { name: texts.tabs.label })
    .getByText(texts.tabs.history, { exact: true })
    .click();
  const history = panel.getByRole('region', { name: moves.historyLabel });
  await expect(
    history.getByText(moves.classStayNow.replace('{{class}}', '7 Oxford'), { exact: true }),
  ).toHaveCount(1);
  const planned = moves.classMoveCancelled
    .replace('{{from}}', '7 Oxford')
    .replace('{{to}}', '7 Princeton');
  await expect(history.getByText(`${planned} · ${moves.states.cancelled}`)).toHaveCount(1);
  await expect(history.getByText(moves.dateChanged.split(':')[0] ?? '')).toHaveCount(1);
  await expect(
    history.getByText(
      moves.classMove.replace('{{from}}', '7 Oxford').replace('{{to}}', '7 Princeton'),
    ),
  ).toHaveCount(0);

  // The class panel lists the student once: no second row "Joins on" with its Withdraw.
  await page.goto('/classes');
  await expect(heading(page, en.classes.title)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '7 Oxford' });
  await row.getByRole('button', { name: '7 Oxford' }).click();
  const oxford = page.getByRole('complementary', { name: '7 Oxford' });
  await expect(oxford.getByText('Usmonov Sardor')).toHaveCount(1);
  await expect(oxford.getByText(/Joins on/)).toHaveCount(0);
  await expect(oxford.getByRole('button', { name: en.classes.withdraw, exact: true })).toHaveCount(
    0,
  );
});
