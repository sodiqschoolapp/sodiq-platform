import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/04-people.md, Movements: "Class transfer and group transfer. One
// action with an effective date. ... The profile History tab shows each move
// with dates"; docs/spec/edge-cases/students-classes-groups.md: "tomorrow by
// default", "scheduled: the student shows the current class with a badge ...
// It can be changed or cancelled until the date", "A transfer is recorded a
// week late. Backdating is for the Academic Vice Principal". Task 3.3a, pull
// request #95. An Academic Vice Principal moves a student of 7 Oxford to
// 7 Yale from tomorrow, sees the badge, cancels the move, moves the student
// again from yesterday, and reads both moves on the History tab. All names
// are invented.
test('an Academic Vice Principal moves a student to another class, cancels, and records a late move', async ({
  page,
}) => {
  const account = accountOf('moves');
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
  const moves = texts.moves;
  const dayMs = 24 * 60 * 60 * 1000;
  const tashkent = (moment: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(moment);
  const yesterday = tashkent(Date.now() - dayMs);

  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: 'Qosimova Sabina', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Sabina Qosimova' });
  await panel.getByRole('button', { name: moves.moveClass, exact: true }).click();
  const form = panel.getByRole('form', { name: moves.moveClass });
  await form.getByLabel(moves.toClass, { exact: true }).selectOption({ label: '7 Yale' });
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  // Scheduled: still in 7 Oxford, with the badge of the move.
  await expect(panel.getByText(/Moves to 7 Yale on/)).toBeVisible();
  const cancel = moves.cancel.replace('{{target}}', '7 Yale');
  await panel.getByRole('button', { name: cancel, exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: moves.cancelTitle });
  await dialog.getByRole('button', { name: cancel, exact: true }).click();
  await expect(panel.getByText(/Moves to 7 Yale on/)).toHaveCount(0);

  // "A transfer is recorded a week late": from yesterday, by the Academic Vice Principal.
  await panel.getByRole('button', { name: moves.moveClass, exact: true }).click();
  const late = panel.getByRole('form', { name: moves.moveClass });
  await late.getByLabel(moves.toClass, { exact: true }).selectOption({ label: '7 Yale' });
  await late.getByLabel(moves.from, { exact: true }).fill(yesterday);
  await late.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(panel.getByText(/From 7 Oxford,/)).toBeVisible();

  await panel
    .getByRole('radiogroup', { name: texts.tabs.label })
    .getByText(texts.tabs.history, { exact: true })
    .click();
  const history = panel.getByRole('region', { name: moves.historyLabel });
  const moved = moves.classMove.replace('{{from}}', '7 Oxford').replace('{{to}}', '7 Yale');
  await expect(history.getByText(`${moved} · ${moves.states.done}`)).toBeVisible();
  await expect(history.getByText(`${moved} · ${moves.states.cancelled}`)).toBeVisible();
  await expect(history.getByRole('button', { name: moves.undo, exact: true })).toBeVisible();
});
