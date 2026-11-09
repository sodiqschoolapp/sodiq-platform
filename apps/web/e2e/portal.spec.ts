import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, languageChooser, signIn } from './steps';

// Task 11.2, pull request #294 (`10`, What parents see; `12`, Devices: "Phone: ... the portal"):
// at phone width a mother of two children signs in, sees the first child's week, opens the
// homework, and switches to the other child. Task 11.3, pull request #296: back on the first
// child, the Grades, the Attendance and the Rating pages. All names are invented.
test.use({ viewport: { width: 390, height: 844 } });

test('a parent opens the timetable and the homework of both children, then the grades and attendance, at phone width', async ({
  page,
}) => {
  const account = accountOf('portal');
  await page.goto('/sign-in');
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);

  const child = page.getByRole('combobox', { name: en.portal.child, exact: true });
  await expect(child).toBeVisible();
  await expect(child.locator('option')).toHaveText([
    'Kamron Usmonov, 7 Seeded',
    'Nilufar Usmonova, 8 Seeded',
  ]);
  await expect(page).toHaveURL(/\/portal\/[0-9a-f-]+\/timetable$/);
  // Kamron's Biology, every day of the seeded fortnight, at 08:00.
  await expect(page.getByText('Biology').first()).toBeVisible();
  await expect(page.getByText('08:00–08:45').first()).toBeVisible();
  // No page wider than the phone.
  const wide = await page.evaluate<boolean>(
    '(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)()',
  );
  expect(wide).toBe(false);

  await page.getByRole('link', { name: en.portal.homework.title, exact: true }).click();
  await expect(page).toHaveURL(/\/homework$/);
  // The homework given two days ago: this week, or the week before on a Monday or Tuesday.
  const homework = page.getByText('Read pages 20 to 24', { exact: true });
  await expect(
    homework.or(page.getByText(en.portal.homework.empty, { exact: true })),
  ).toBeVisible();
  if (!(await homework.isVisible())) {
    await page.getByRole('button', { name: en.portal.previousWeek, exact: true }).click();
  }
  await expect(homework).toBeVisible();

  // The other child, on the same page; then its timetable.
  await child.selectOption({ label: 'Nilufar Usmonova, 8 Seeded' });
  await expect(child.locator('option:checked')).toHaveText('Nilufar Usmonova, 8 Seeded');
  await expect(page).toHaveURL(/\/homework$/);
  await page.getByRole('link', { name: en.portal.timetable.title, exact: true }).click();
  await expect(page).toHaveURL(/\/timetable$/);
  // Nilufar's class has no lesson: her week shows none of Kamron's.
  await expect(page.getByRole('button', { name: en.portal.nextWeek, exact: true })).toBeVisible();
  await expect(page.getByText('Biology')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: en.layout.menu })).toHaveCount(0);

  // Task 11.3: Kamron's grades: yesterday's classwork with its comment visible to parents.
  await child.selectOption({ label: 'Kamron Usmonov, 7 Seeded' });
  await page.getByRole('link', { name: en.portal.grades.title, exact: true }).click();
  await expect(page).toHaveURL(/\/grades$/);
  const biology = page.getByRole('region', { name: 'Biology' });
  await expect(biology.getByText('Cells and tissues', { exact: true })).toBeVisible();
  await expect(biology.getByText('8 of 10 · 80%', { exact: true })).toBeVisible();
  await expect(biology.getByText('Well done on the diagram', { exact: true })).toBeVisible();
  await expect(page.getByText(en.portal.grades.provisional, { exact: true })).toBeVisible();
  await expect(page.getByText(/Staff only/)).toHaveCount(0);
  expect(
    await page.evaluate<boolean>(
      '(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)()',
    ),
  ).toBe(false);

  // Attendance: late yesterday (this week, or the week before on a Monday); no staff comment.
  // On a Monday this week holds no lesson before 08:45 Tashkent time (the empty line) and
  // today's unmarked lesson after it (the seed has a lesson every day at 08:00).
  await page.getByRole('link', { name: en.portal.attendance.title, exact: true }).click();
  await expect(page).toHaveURL(/\/attendance$/);
  const late = page.getByText(en.portal.attendance.marks.late, { exact: true });
  await expect(
    late
      .or(page.getByText(en.portal.attendance.empty, { exact: true }))
      .or(page.getByText(en.portal.attendance.marks.unmarked, { exact: true }))
      .first(),
  ).toBeVisible();
  if (!(await late.isVisible())) {
    await page.getByRole('button', { name: en.portal.previousWeek, exact: true }).click();
  }
  await expect(late).toBeVisible();
  await expect(page.getByText(/Staff only/)).toHaveCount(0);

  // Task 11.6: Kamron's own place in the class and the class average, no other student.
  await page.getByRole('link', { name: en.portal.rating.title, exact: true }).click();
  await expect(page).toHaveURL(/\/rating$/);
  const place = page.getByRole('region', { name: /^Place \d+ in 7 Seeded$/ });
  await expect(place).toBeVisible();
  await expect(place.locator('[data-figure="own"]')).toHaveText(/^\d+\.\d$/);
  await expect(place.locator('[data-figure="average"]')).toHaveText(/^\d+\.\d$/);
  await expect(page.getByText(en.portal.rating.provisional, { exact: true })).toBeVisible();
  expect(
    await page.evaluate<boolean>(
      '(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)()',
    ),
  ).toBe(false);
});

// Task 11.4, pull request #298 (`10`, Signing in: Telegram): the portal as a Telegram mini app.
// The address carries launch data signed as Telegram signs it, with the invented token of the
// browser tests' API (`apps/api/src/testing/e2e/telegram.ts`).
const E2E_TELEGRAM_BOT_TOKEN = '111111111:AAinventedBrowserTestBotToken_000000';

function launchAddress(telegramUserId: number): string {
  const fields: [string, string][] = [
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', 'AAHinventedBrowserTest'],
    ['user', JSON.stringify({ id: telegramUserId, first_name: 'Botir' })],
  ];
  const checkString = [...fields]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(E2E_TELEGRAM_BOT_TOKEN).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return `/portal/telegram#tgWebAppData=${encodeURIComponent(params.toString())}&tgWebAppVersion=8.0`;
}

test('a father opens the portal from Telegram: once with the password, then without it until he signs out', async ({
  page,
}) => {
  const account = accountOf('telegramParent');
  const address = launchAddress(7_200_001);

  // The first opening: the chat is not linked, so the login and password, then the first-password change.
  await page.goto(address);
  await languageChooser(page).selectOption('en');
  await signIn(page, en, account.login, account.password);
  await changeFirstPassword(page, en, account);
  await expect(page).toHaveURL(/\/portal\/[0-9a-f-]+\/timetable$/);
  await expect(page.getByText('Biology').first()).toBeVisible();

  // The next opening from the same chat, in a fresh web view: no password asked.
  await page.context().clearCookies();
  await page.goto(address);
  await expect(page).toHaveURL(/\/portal\/[0-9a-f-]+\/timetable$/);
  await expect(page.getByText('Biology').first()).toBeVisible();
  await expect(page.getByLabel(en.signIn.password, { exact: true })).toHaveCount(0);

  // The Account page names the link; a sign-out in the mini app ends it.
  await page.getByRole('link', { name: en.portal.account, exact: true }).click();
  await expect(page.getByRole('region', { name: en.parent.telegram })).toContainText(
    en.parent.telegramLinked.replace('{{date}}', ''),
  );
  await page.getByRole('button', { name: en.parent.signOut, exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto(address);
  await expect(page.getByLabel(en.signIn.password, { exact: true })).toBeVisible();
});
