import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, languageChooser, signIn } from './steps';

// Task 11.7, pull request #306 (`11`, Announcements and events): the Vice Principal for
// Spiritual and Moral Education of the portal branch writes an event for "7 Seeded", for staff
// and parents, and sees it on the calendar of the month; Kamron's grandmother sees it on the
// portal's Announcements page at phone width. All names are invented.
test('an event for a class reaches the calendar of staff and the portal of the class’s parents', async ({
  browser,
}) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());

  const author = accountOf('announcementsAuthor');
  const staffPage = await (await browser.newContext()).newPage();
  await staffPage.goto('/sign-in');
  await languageChooser(staffPage).selectOption('en');
  await signIn(staffPage, en, author.login, author.password);
  await changeFirstPassword(staffPage, en, author);

  await staffPage.getByRole('link', { name: en.announcements.title, exact: true }).click();
  await staffPage.getByRole('link', { name: en.announcements.manage.link, exact: true }).click();
  // An empty list offers Add in the header and in its empty page: the header one.
  await staffPage
    .getByRole('button', { name: en.announcements.manage.add, exact: true })
    .first()
    .click();
  await staffPage.getByLabel(en.announcements.form.kind, { exact: true }).selectOption('event');
  await staffPage.getByLabel(en.announcements.form.title, { exact: true }).fill('Science fair');
  await staffPage
    .getByLabel(en.announcements.form.body, { exact: true })
    .fill('Projects of grade 7 in the hall.');
  await staffPage.getByLabel(en.announcements.form.firstDate, { exact: true }).fill(today);
  await staffPage.getByLabel(en.announcements.form.lastDate, { exact: true }).fill(today);
  await staffPage.getByLabel(en.announcements.form.startsAt, { exact: true }).fill('10:00');
  await staffPage.getByLabel(en.announcements.form.place, { exact: true }).fill('Main hall');
  await staffPage
    .getByLabel(en.announcements.form.audience, { exact: true })
    .selectOption('classes');
  await staffPage.getByLabel('7 Seeded', { exact: true }).check();
  await staffPage.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(staffPage.getByRole('cell', { name: 'Science fair' })).toBeVisible();

  // The calendar of what is addressed to the author: the event on today's cell.
  await staffPage.goto('/announcements?view=calendar');
  await expect(staffPage.locator(`[data-date="${today}"]`)).toContainText('Science fair');

  const parent = accountOf('announcementsParent');
  const phone = await (
    await browser.newContext({ viewport: { width: 390, height: 844 } })
  ).newPage();
  await phone.goto('/sign-in');
  await languageChooser(phone).selectOption('en');
  await signIn(phone, en, parent.login, parent.password);
  await changeFirstPassword(phone, en, parent);
  await phone.getByRole('link', { name: en.portal.announcements.title, exact: true }).click();
  await expect(phone).toHaveURL(/\/announcements$/);
  await expect(phone.getByRole('heading', { name: 'Science fair' })).toBeVisible();
  await expect(phone.getByText('Main hall', { exact: false })).toBeVisible();
  const wide = await phone.evaluate<boolean>(
    '(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)()',
  );
  expect(wide).toBe(false);
});
