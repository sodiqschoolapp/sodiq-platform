import { expect, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { heading } from './steps';

/** The Mondays from the one after today in Tashkent, as school dates. */
function mondaysAhead(count: number): string[] {
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()),
  );
  const days = ((8 - today.getUTCDay()) % 7) + (today.getUTCDay() === 1 ? 7 : 0);
  return Array.from({ length: count }, (_, index) => {
    const monday = new Date(today.getTime() + (days + index * 7) * 24 * 60 * 60 * 1000);
    return monday.toISOString().slice(0, 10);
  });
}

/**
 * docs/spec/06-timetable.md, Protection: "Forced delete is for Super Admin
 * only, with a typed reason. The attendance and marks are kept for 30 days and
 * can be restored." and "Every change records who, when, the value before and
 * the value after" (task 5.8b, pull request #195). The seed's publishable
 * scene in a branch of its own: the Super Admin publishes, deletes 7 Oxford's
 * Monday Geometry for good with a reason, finds it on Deleted for good,
 * restores it, and reads both lines in the lesson's history. The seed holds no
 * fourth Super Admin (correction 1 of the review of #87), so this runs at the
 * end of the first setup test's session (Nodira Ergasheva). All names are
 * invented.
 */
export async function forceDeleteAndRestore(page: Page): Promise<void> {
  const bar = page.getByRole('banner', { name: en.layout.topBar });

  // Publish the draft from its default start, as the publish test does.
  const builder = en.timetable.builder;
  const publish = en.timetable.publish;
  await page.goto('/timetable/builder');
  await bar
    .getByLabel(en.switcher.branch)
    .selectOption({ label: 'Forced delete browser test branch' });
  await expect(heading(page, builder.title)).toBeVisible();
  await page.getByRole('button', { name: builder.confirm, exact: true }).click();
  await expect(page.getByText(builder.confirmed, { exact: true })).toBeVisible();
  await page.locator('[data-step="publish"] button').click();
  await expect(page.locator('[data-can-publish]')).toHaveText(publish.nothingRefused);
  await page.getByRole('button', { name: publish.action, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: publish.action, exact: true })
    .click();
  await expect(page.locator('[data-published]')).toBeVisible();

  // Day changes: the first Monday ahead with 7 Oxford's Geometry.
  const day = en.timetable.day;
  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.dayLink, exact: true }).click();
  await expect(heading(page, day.title)).toBeVisible();
  const geometry = page.locator('tbody tr').filter({ hasText: 'Geometry' });
  for (const monday of mondaysAhead(6)) {
    const answered = page.waitForResponse(
      (response) =>
        response.url().includes('/api/timetable/day') && response.url().includes(monday),
    );
    await page.getByLabel(day.date, { exact: true }).fill(monday);
    await answered;
    await expect(page.locator('tbody tr').or(page.getByText(day.empty)).first()).toBeVisible();
    if ((await geometry.count()) > 0) break;
  }
  await expect(geometry).toHaveCount(1);
  await expect(geometry).toContainText('08:00');
  const dayAddress = page.url();

  // Its history is empty before the delete.
  const history = en.timetable.lessonHistory;
  await geometry.getByRole('button', { name: day.history, exact: true }).click();
  const before = page.getByRole('dialog');
  await expect(before.getByText(history.empty, { exact: true })).toBeVisible();
  await before.getByRole('button', { name: day.back, exact: true }).click();
  await expect(before).toBeHidden();

  // Delete for good: refused without a reason, then sent with one.
  const forced = en.timetable.forcedDelete;
  await geometry.getByRole('button', { name: day.forcedDelete, exact: true }).click();
  const deleting = page.getByRole('dialog');
  await expect(deleting.getByRole('heading')).toHaveText(/^Delete for good: Geometry, 7 Oxford, /);
  await deleting.getByRole('button', { name: en.forcedDeletes.send, exact: true }).click();
  await expect(deleting.getByText(en.forcedDeletes.reasonNeeded, { exact: true })).toBeVisible();
  await deleting
    .getByLabel(en.forcedDeletes.reason, { exact: true })
    .fill('Entered twice by mistake');
  await deleting.getByRole('button', { name: en.forcedDeletes.send, exact: true }).click();
  await expect(page.getByText(forced.done, { exact: true })).toBeVisible();
  await expect(geometry).toHaveCount(0);

  // Deleted for good, from the Setup page.
  const deleted = en.forcedDeletes;
  await page.goto('/setup');
  await page.getByRole('link', { name: en.setup.forcedDeletesLink, exact: true }).click();
  await expect(heading(page, deleted.title)).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: 'Entered twice by mistake' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('7 Oxford');
  await expect(row).toContainText('Geometry');
  await expect(row).toContainText(deleted.state_restorable);
  await row.getByRole('button').first().click();
  const panel = page.getByRole('complementary', { name: '7 Oxford, Geometry' });
  await panel.getByRole('button', { name: deleted.restore, exact: true }).click();
  await expect(panel.getByText(deleted.restoredMessage, { exact: true })).toBeVisible();
  await expect(row).toContainText(deleted.state_restored);

  // Back on the day: the lesson is there again, and its history holds the
  // forced delete and the restore, in that order.
  await page.goto(dayAddress);
  await expect(heading(page, day.title)).toBeVisible();
  await expect(geometry).toHaveCount(1);
  await expect(geometry).toContainText('08:00');
  await geometry.getByRole('button', { name: day.history, exact: true }).click();
  const after = page.getByRole('dialog');
  const lines = after.locator('li[data-line]');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveAttribute('data-line', 'forced_delete');
  await expect(lines.nth(0)).toContainText(history.kind_forced_delete);
  await expect(lines.nth(1)).toHaveAttribute('data-line', 'restored');
  await expect(lines.nth(1)).toContainText(history.kind_restored);
  // Who: the Super Admin has no staff record, so "No name", never a blank.
  for (const index of [0, 1]) {
    await expect(lines.nth(index)).toContainText(en.audit.unnamed);
    await expect(lines.nth(index)).not.toContainText(' · ,');
  }
}
