import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// docs/spec/05-classes-groups-subjects.md, Teaching load ("Only teachers whose
// profile has the subject and every grade of the class or group ... can be
// chosen"); 06-timetable.md, Building a timetable, steps 1 and 2; task 3.4a,
// pull request #99. An Academic Vice Principal starts a draft, adds a row of
// 7 Oxford in Geometry and sees the teacher without grade 7 not offered.
// With SCREENSHOTS=1 the form and the list are saved for the report under
// docs/screens/3.4a/. All names are invented.
const SCREENS = path.join(import.meta.dirname, '../../../docs/screens/3.4a');

async function screenshot(page: Page, name: string): Promise<void> {
  if (process.env.SCREENSHOTS !== '1') {
    return;
  }
  await page.waitForTimeout(400);
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

test('an Academic Vice Principal starts a draft and adds a load row with a teacher who may take it', async ({
  page,
}) => {
  const account = accountOf('teachingLoad');
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

  // The load is reached from the Timetable item of the menu.
  await page
    .getByRole('navigation', { name: en.layout.menu })
    .getByRole('link', { name: new RegExp(en.menu.timetable) })
    .click();
  await expect(heading(page, en.timetable.title)).toBeVisible();
  await page.getByRole('link', { name: en.timetable.loadLink, exact: true }).click();
  await expect(heading(page, en.timetable.load.title)).toBeVisible();
  await expect(page.getByText(en.timetable.load.noVersion)).toBeVisible();

  const texts = en.timetable.load;
  await page.getByRole('button', { name: texts.newDraft, exact: true }).click();
  const draft = page.getByRole('form', { name: texts.newDraftTitle });
  await screenshot(page, 'new-draft');
  await draft.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(page.getByLabel(texts.version, { exact: true })).toContainText('Version 1');

  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const create = page.getByRole('form', { name: texts.newRow });
  await create.getByLabel(texts.unit, { exact: true }).selectOption({ label: '7 Oxford' });
  await create.getByLabel(texts.subject, { exact: true }).selectOption({ label: 'Geometry' });
  const teacher = create.getByLabel(texts.teacher, { exact: true });
  await expect(teacher.locator('option')).toHaveText([texts.chooseTeacher, 'Karimova Aziza']);
  await teacher.selectOption({ label: 'Karimova Aziza' });
  await create.getByLabel(texts.lessons, { exact: true }).fill('3');
  await screenshot(page, 'new-row');
  await create.getByRole('button', { name: en.form.save, exact: true }).click();

  // The row of the list; the weekly totals below have a row of 7 Oxford too (task 3.4b).
  const row = page.getByRole('row').filter({ hasText: '7 Oxford' }).filter({ hasText: 'Geometry' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Karimova Aziza');
  await expect(row).toContainText(texts.none);
  await screenshot(page, 'load-list');

  // Task 3.6c-2 (decision 1): the Homework slot of 7 Oxford has no teacher to
  // choose; the form names the class's Tutor, who holds the row.
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const tutorRow = page.getByRole('form', { name: texts.newRow });
  await tutorRow.getByLabel(texts.unit, { exact: true }).selectOption({ label: '7 Oxford' });
  await tutorRow
    .getByLabel(texts.subject, { exact: true })
    .selectOption({ label: 'Homework slot' });
  await expect(
    tutorRow.getByText(texts.tutorRowTeacher.replace('{{name}}', 'Tursunova Gulnora')),
  ).toBeVisible();
  await expect(tutorRow.getByLabel(texts.teacher, { exact: true })).toHaveCount(0);
  await tutorRow.getByLabel(texts.lessons, { exact: true }).fill('1');
  await tutorRow.getByRole('button', { name: en.form.save, exact: true }).click();
  const homework = page
    .getByRole('row')
    .filter({ hasText: '7 Oxford' })
    .filter({ hasText: 'Homework slot' });
  await expect(homework).toContainText('Tursunova Gulnora');
  await expect(homework).toContainText(texts.none);
});

// edge-cases/timetable.md, Structure: "all parts have equal lessons per week
// and different teachers"; 06-timetable.md, Building a timetable, steps 2 and
// 3; task 3.4b, pull request #100. An Academic Vice Principal gives the two
// halves of a split of 7 Oxford their rows: the first half's teacher is not
// offered for the second, a change of lessons on one half is written to both,
// and the weekly totals count the split once. All names are invented.
test('an Academic Vice Principal gives a split its two parts and changes their lessons together', async ({
  page,
}) => {
  const account = accountOf('teachingBlocks');
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

  await page.goto('/timetable/load');
  await expect(heading(page, en.timetable.load.title)).toBeVisible();
  const texts = en.timetable.load;
  await page.getByRole('button', { name: texts.newDraft, exact: true }).click();
  await page
    .getByRole('form', { name: texts.newDraftTitle })
    .getByRole('button', { name: en.form.save, exact: true })
    .click();
  await expect(page.getByLabel(texts.version, { exact: true })).toContainText('Version 1');

  async function addPart(group: string, offered: string[], chosen: string): Promise<void> {
    await page.getByRole('button', { name: texts.add, exact: true }).first().click();
    const create = page.getByRole('form', { name: texts.newRow });
    await create.getByLabel(texts.unit, { exact: true }).selectOption({ label: group });
    await create.getByLabel(texts.subject, { exact: true }).selectOption({ label: 'Geometry' });
    const teacher = create.getByLabel(texts.teacher, { exact: true });
    await expect(teacher.locator('option')).toHaveText([texts.chooseTeacher, ...offered]);
    await teacher.selectOption({ label: chosen });
    await create.getByLabel(texts.lessons, { exact: true }).fill('3');
    await create.getByRole('button', { name: en.form.save, exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: group }).first()).toBeVisible();
  }

  await addPart('7-G-1', ['Olimova Zarina', 'Saidova Madina'], 'Saidova Madina');
  // The first half's teacher is not offered for the second half.
  await addPart('7-G-2', ['Olimova Zarina'], 'Olimova Zarina');
  await screenshot(page, 'split-rows');

  const first = page
    .getByRole('row')
    .filter({ hasText: '7-G-1, 7-G-2' })
    .filter({ hasText: 'Saidova Madina' });
  await first.getByRole('button').first().click();
  await page.getByRole('button', { name: en.form.edit, exact: true }).click();
  const edit = page.getByRole('form', { name: '7-G-1, Geometry' });
  await expect(
    edit.getByText(texts.blockLessonsNote.replace('{{min}}', '1').replace('{{max}}', '40')),
  ).toBeVisible();
  await edit.getByLabel(texts.lessons, { exact: true }).fill('4');
  await edit.getByRole('button', { name: en.form.save, exact: true }).click();
  for (const teacher of ['Saidova Madina', 'Olimova Zarina']) {
    // The lessons cell of each half (spec review of the build, should-fix 6).
    await expect(
      page.getByRole('row').filter({ hasText: teacher }).first().locator('td').nth(4),
    ).toHaveText('4');
  }

  // The split counts once for 7 Oxford in the weekly totals.
  const totals = page.locator('[data-totals="classes"]');
  await expect(
    totals.getByRole('row').filter({ hasText: '7 Oxford' }).locator('td').nth(1),
  ).toHaveText(/^4(?!\d)/);
  await screenshot(page, 'weekly-totals');
});

// 06-timetable.md, Building a timetable, step 1: "confirms the day templates
// of each weekday in force on that date ... Ready when: The start date is set
// and the table of templates per weekday and grade is confirmed"; task 5.3a,
// pull request #127. An Academic Vice Principal starts a draft, opens the
// builder from the Timetable page, sees step 1 not ready, confirms the
// templates and sees it ready. All names are invented.
test('an Academic Vice Principal confirms the day templates of a draft in the builder', async ({
  page,
}) => {
  const account = accountOf('draftBuilder');
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

  await page.goto('/timetable/load');
  const texts = en.timetable.load;
  await page.getByRole('button', { name: texts.newDraft, exact: true }).click();
  await page
    .getByRole('form', { name: texts.newDraftTitle })
    .getByRole('button', { name: en.form.save, exact: true })
    .click();
  await expect(page.getByLabel(texts.version, { exact: true })).toContainText('Version 1');

  await page.goto('/timetable');
  await page.getByRole('link', { name: en.timetable.builderLink, exact: true }).click();
  const builder = en.timetable.builder;
  await expect(heading(page, builder.title)).toBeVisible();
  const step = page.locator('[data-step="templates"]');
  await expect(step).toContainText(builder.notReady);
  await expect(step).toContainText(builder.steps.templates);
  // The table of grade 7, the one grade with a class, names the template.
  await expect(page.getByRole('table').getByRole('cell').filter({ hasText: 'Main' })).toHaveCount(
    5,
  );
  await expect(page.getByText(builder.notConfirmed, { exact: true })).toBeVisible();
  await screenshot(page, 'builder-step-1');
  await page.getByRole('button', { name: builder.confirm, exact: true }).click();
  await expect(page.getByText(builder.confirmed, { exact: true })).toBeVisible();
  await expect(step).not.toContainText(builder.notReady);
  await expect(step).toContainText(builder.ready);
  // The load is still empty: the draft is not ready for generation.
  await expect(page.locator('[data-step="load"]')).toContainText(builder.notReady);
  await expect(page.locator('[data-ready]')).toHaveAttribute('data-ready', 'false');
});

// docs/spec/06-timetable.md, Editing in the grid ("While dragging, each slot
// shows free, warning or blocked, with the reason"); 14, Timetable, One rule
// engine ("The same checking code runs in the browser while dragging and on
// the server when saving"); task 5.4a, pull request #130. Done when: a lesson
// is moved, a blocked move is refused with the rule named, and the same move
// is refused when the API is called directly. All names are invented.
test('an Academic Vice Principal drags a lesson in the grid, and a blocked slot is refused here and by the API', async ({
  page,
}) => {
  const account = accountOf('draftGrid');
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

  await page.goto('/timetable/builder');
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  const gridRead = page.waitForRequest((request) => request.url().endsWith('/grid'));
  await page.locator('[data-step="grid"] button').click();
  const branchId = (await gridRead).headers()['x-branch-id'] ?? '';
  const versionId = new URL(page.url()).searchParams.get('version') ?? '';
  const board = page.locator('[data-board]');
  await expect(board).toBeVisible();

  const cell = (weekday: number, position: number) =>
    page.locator(`[data-cell="${String(weekday)}:${String(position)}"]`);
  // 7 Oxford's Geometry on Monday at 08:00, moved to Tuesday at 08:00.
  const lesson = cell(1, 1).locator('[data-block]');
  await expect(lesson).toContainText('Geometry');
  const blockId = (await lesson.getAttribute('data-block')) ?? '';
  await lesson.dragTo(cell(2, 1));
  await expect(cell(2, 1).locator(`[data-block="${blockId}"]`)).toBeVisible();
  await expect(cell(1, 1).locator('[data-block]')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: en.form.saved })).toBeVisible();
  await screenshot(page, 'grid-moved');

  // Monday at 08:45 the same teacher has 7 Princeton: the slot shows blocked
  // with the rule while the lesson is dragged, and the drop is refused.
  const moved = cell(2, 1).locator(`[data-block="${blockId}"]`);
  await moved.hover();
  await page.mouse.down();
  await cell(1, 2).hover();
  await cell(1, 2).hover({ position: { x: 20, y: 20 } });
  await expect(cell(1, 2)).toHaveAttribute('data-status', 'blocked');
  await expect(cell(1, 2).locator('[data-reason="teacher_double"]')).toContainText(
    en.timetable.rule.teacher_double,
  );
  await screenshot(page, 'grid-blocked');
  await page.mouse.up();
  await expect(page.locator('[data-refusal]')).toContainText(en.timetable.rule.teacher_double);
  await expect(cell(2, 1).locator(`[data-block="${blockId}"]`)).toBeVisible();

  // The same move sent to the API directly is refused with the same rule.
  const answer = await page.request.post(
    `/api/timetable/versions/${versionId}/pattern/${blockId}/move`,
    {
      headers: { 'X-Branch-Id': branchId },
      data: { weekday: 1, slotPosition: 2 },
    },
  );
  expect(answer.status()).toBe(409);
  const body = (await answer.json()) as {
    error: { code: string; details?: { code: string }[] };
  };
  expect(body.error.code).toBe('pattern_blocked');
  expect(body.error.details?.map((detail) => detail.code)).toEqual(['teacher_double']);
  await page.reload();
  await expect(cell(2, 1).locator(`[data-block="${blockId}"]`)).toBeVisible();
});

// Task 5.4b-2a (Done when): 06, Editing in the grid: "A side panel lists what
// still has to be placed ... Lessons are dragged onto the grid"; "The room
// picker lists only rooms that are free in that slot"; "A conflict panel lists
// every error and warning in the draft, with a button that jumps to the
// lesson". The same scene as the drag test, in a branch of its own with two
// rooms. All names are invented.
test('an Academic Vice Principal places a lesson from "To place", changes its room and shows a conflict’s lesson', async ({
  page,
}) => {
  const account = accountOf('draftGridPanels');
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

  await page.goto('/timetable/builder');
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  await page.locator('[data-step="grid"] button').click();
  await expect(page.locator('[data-board]')).toBeVisible();
  const cell = (weekday: number, position: number) =>
    page.locator(`[data-cell="${String(weekday)}:${String(position)}"]`);

  // 7 Oxford's Geometry, one of three placed, dragged from the panel to Tuesday 08:00.
  const entry = page
    .locator('[data-to-place]')
    .filter({ hasText: 'Geometry, 7 Oxford: 1 of 3 lessons placed' });
  await expect(entry).toBeVisible();
  // A pointer drag in steps: a single jump starts no native drag from the panel.
  await entry.hover({ position: { x: 12, y: 8 } });
  await page.mouse.down();
  await page.mouse.move(600, 300, { steps: 5 });
  await cell(2, 1).hover();
  await cell(2, 1).hover({ position: { x: 20, y: 20 } });
  await page.mouse.up();
  await expect(cell(2, 1).locator('[data-block]')).toContainText('Geometry');
  await expect(
    page
      .locator('[data-to-place]')
      .filter({ hasText: 'Geometry, 7 Oxford: 2 of 3 lessons placed' }),
  ).toBeVisible();
  await screenshot(page, 'grid-to-place');

  // The room picker of the Monday lesson: both rooms are free; Room 21 is chosen.
  await cell(1, 1)
    .getByRole('button', { name: /Room of Geometry/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-room-choice]')).toHaveCount(2);
  await dialog
    .locator('[data-room-choice]')
    .filter({ hasText: 'Room 21' })
    .getByRole('button')
    .click();
  await expect(cell(1, 1).locator('[data-block]')).toContainText('Room 21');

  // Princeton is short of its load: "Show" on that warning opens its board and focuses its lesson.
  const warning = page
    .locator('[data-conflict="load_mismatch"]')
    .filter({ hasText: '1 of 3 lessons placed.' })
    .filter({ hasText: 'Princeton' });
  await warning.getByRole('button', { name: en.timetable.grid.show }).click();
  const shown = cell(1, 2).locator('[data-block]');
  await expect(shown).toBeFocused();
  await expect(shown).toContainText('Princeton');
  await screenshot(page, 'grid-conflict-shown');
});

// Task 5.4b-2b (Done when): 06, Editing in the grid: "'Suggest a place' on a
// selected lesson shows the best free slots, or a swap of two or three lessons
// that makes room for it"; applying it is checked by the rule engine and
// refused by the API like a move. The same scene as the drag test, in a branch
// of its own. All names are invented.
test('an Academic Vice Principal applies a suggested place, and the API refuses a blocked rearrangement', async ({
  page,
}) => {
  const account = accountOf('draftGridSuggest');
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

  await page.goto('/timetable/builder');
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  const gridRead = page.waitForRequest((request) => request.url().endsWith('/grid'));
  await page.locator('[data-step="grid"] button').click();
  const branchId = (await gridRead).headers()['x-branch-id'] ?? '';
  const versionId = new URL(page.url()).searchParams.get('version') ?? '';
  await expect(page.locator('[data-board]')).toBeVisible();
  const cell = (weekday: number, position: number) =>
    page.locator(`[data-cell="${String(weekday)}:${String(position)}"]`);

  // 7 Oxford's Geometry on Monday at 08:00; its teacher has 7 Princeton at 08:45.
  const lesson = cell(1, 1).locator('[data-block]');
  const blockId = (await lesson.getAttribute('data-block')) ?? '';
  await lesson.getByRole('button', { name: en.timetable.grid.suggest }).click();
  const dialog = page.getByRole('dialog');
  const free = dialog.locator('[data-suggestion="free"]');
  await expect(free.first()).toBeVisible();
  await expect(free.filter({ hasText: 'Monday, 08:45' })).toHaveCount(0);
  await expect(free.first()).toContainText('Monday, 09:30');
  await screenshot(page, 'grid-suggest');
  await free.first().getByRole('button').click();
  await expect(cell(1, 3).locator(`[data-block="${blockId}"]`)).toBeVisible();
  await expect(cell(1, 1).locator('[data-block]')).toHaveCount(0);

  // The API refuses a rearrangement that puts the teacher in two lessons at once.
  const refused = await page.request.post(
    `/api/timetable/versions/${versionId}/pattern/rearrange`,
    {
      headers: { 'X-Branch-Id': branchId },
      data: { changes: [{ blockId, weekday: 1, slotPosition: 2 }] },
    },
  );
  expect(refused.status()).toBe(409);
  const body = (await refused.json()) as {
    error: { code: string; details?: { code: string }[] };
  };
  expect(body.error.code).toBe('pattern_blocked');
  expect(body.error.details?.map((detail) => detail.code)).toEqual(['teacher_double']);
  await page.reload();
  await expect(cell(1, 3).locator(`[data-block="${blockId}"]`)).toBeVisible();
});

/** The first sign-in of a seeded Academic Vice Principal: the forced change and the second step. */
async function firstSignInWithStep(page: Page, account: { login: string; password: string }) {
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
}

// docs/spec/edge-cases/timetable.md, Generator and editing: "The person
// editing a draft closes the laptop. The edit lock is released after 5 minutes
// without activity. Another Academic Vice Principal can take over; the earlier
// holder is told." Task 5.4c-1, pull request #135. The seed leaves the lock
// with the first Academic Vice Principal, last active 10 minutes ago; the
// second applies a suggested place, which takes the lock over; the first finds
// the notice, the draft read only with the new holder named, and a Take over
// refused while the new holder is active. Two accounts, used by this test only.
test('a second Academic Vice Principal takes over a draft and the first is told', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const taker = accountOf('draftLockTaker');
  const holder = accountOf('draftLockHolder');

  const takerContext = await browser.newContext();
  const takerPage = await takerContext.newPage();
  await firstSignInWithStep(takerPage, taker);
  await takerPage.goto('/timetable/builder');
  await expect(heading(takerPage, en.timetable.builder.title)).toBeVisible();
  await takerPage.locator('[data-step="grid"] button').click();
  await expect(takerPage.locator('[data-board]')).toBeVisible();
  await expect(takerPage.locator('[data-edit-lock]')).toHaveCount(0);
  const cell = (page: Page, weekday: number, position: number) =>
    page.locator(`[data-cell="${String(weekday)}:${String(position)}"]`);
  const lesson = cell(takerPage, 1, 1).locator('[data-block]');
  const blockId = (await lesson.getAttribute('data-block')) ?? '';
  await lesson.getByRole('button', { name: en.timetable.grid.suggest }).click();
  const free = takerPage.getByRole('dialog').locator('[data-suggestion="free"]');
  await free.first().getByRole('button').click();
  await expect(cell(takerPage, 1, 3).locator(`[data-block="${blockId}"]`)).toBeVisible();

  const holderContext = await browser.newContext();
  const page = await holderContext.newPage();
  await firstSignInWithStep(page, holder);
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread', exact: true });
  await expect(bell).toBeVisible({ timeout: 20_000 });
  await bell.click();
  const notices = page.getByRole('dialog', { name: en.notifications.title });
  await expect(notices.getByRole('listitem').first()).toContainText(taker.login);
  await expect(notices.getByRole('listitem').first()).toContainText('took over draft 1');
  await notices.getByRole('button', { name: en.notifications.close, exact: true }).click();

  await page.goto('/timetable/builder');
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  await page.locator('[data-step="grid"] button').click();
  await expect(page.locator('[data-board]')).toBeVisible();
  const banner = page.locator('[data-edit-lock]');
  await expect(banner).toContainText(taker.login);
  await expect(
    cell(page, 1, 3).getByRole('button', { name: en.timetable.grid.move, exact: true }),
  ).toHaveCount(0);
  await screenshot(page, 'grid-edit-lock');
  await banner.getByRole('button', { name: en.timetable.editLock.takeOver }).click();
  await expect(page.getByText(en.errors.draft_edit_locked)).toBeVisible();

  await takerContext.close();
  await holderContext.close();
});

// Task 5.4c-2 (Done when): 06, Editing in the grid: "Undo and redo". A move
// is undone and redone, a removal is undone, each through the routes; the
// room change and the applied suggestion are covered by grid-step.test.tsx.
// All names are invented.
test('an Academic Vice Principal undoes and redoes a move, and undoes a removal', async ({
  page,
}) => {
  const account = accountOf('draftGridUndo');
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

  await page.goto('/timetable/builder');
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  const gridRead = page.waitForRequest((request) => request.url().endsWith('/grid'));
  await page.locator('[data-step="grid"] button').click();
  const branchId = (await gridRead).headers()['x-branch-id'] ?? '';
  const versionId = new URL(page.url()).searchParams.get('version') ?? '';
  await expect(page.locator('[data-board]')).toBeVisible();
  const cell = (weekday: number, position: number) =>
    page.locator(`[data-cell="${String(weekday)}:${String(position)}"]`);
  const history = en.timetable.grid.history;
  const undo = page.locator('[data-history]').getByRole('button', { name: /^Undo/ });
  const redo = page.locator('[data-history]').getByRole('button', { name: /^Redo/ });
  /** Where the server holds the block now. */
  const slotOnServer = async (blockId: string) => {
    const answer = await page.request.get(`/api/timetable/versions/${versionId}/grid`, {
      headers: { 'X-Branch-Id': branchId },
    });
    const grid = (await answer.json()) as {
      blocks: { id: string; weekday: number; slotPosition: number }[];
    };
    const block = grid.blocks.find((one) => one.id === blockId);
    return block === undefined ? null : [block.weekday, block.slotPosition];
  };

  // 7 Oxford's Geometry on Monday at 08:00, moved to Tuesday at 08:00.
  const lesson = cell(1, 1).locator('[data-block]');
  await expect(lesson).toContainText('Geometry');
  const blockId = (await lesson.getAttribute('data-block')) ?? '';
  await expect(undo).toBeDisabled();
  await lesson.dragTo(cell(2, 1));
  await expect(cell(2, 1).locator(`[data-block="${blockId}"]`)).toBeVisible();
  await expect(undo).toHaveAccessibleName(/^Undo: moving Geometry/);
  await undo.click();
  await expect(cell(1, 1).locator(`[data-block="${blockId}"]`)).toBeVisible();
  expect(await slotOnServer(blockId)).toEqual([1, 1]);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(cell(2, 1).locator(`[data-block="${blockId}"]`)).toBeVisible();
  expect(await slotOnServer(blockId)).toEqual([2, 1]);
  await screenshot(page, 'grid-undo');

  // Removed, then put back by Undo in the same slot.
  await cell(2, 1)
    .locator(`[data-block="${blockId}"]`)
    .getByRole('button', { name: en.timetable.grid.remove })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: en.timetable.grid.remove })
    .click();
  await expect(cell(2, 1).locator('[data-block]')).toHaveCount(0);
  await expect(undo).toHaveAccessibleName(/^Undo: removing Geometry/);
  await undo.click();
  await expect(cell(2, 1).locator('[data-block]')).toContainText('Geometry');
  await expect(redo).toHaveAccessibleName(new RegExp(`^${history.redo}: removing Geometry`));
});

// Task 5.4c-3a: edge/timetable, Structure: "Two linked lessons in consecutive
// lesson slots with the same teacher and room. They are moved, cancelled and
// substituted together." The scene's day has three lesson slots, 08:00, 08:45
// and 09:30.
test('an Academic Vice Principal places, moves and removes a double lesson as one', async ({
  page,
}) => {
  const account = accountOf('draftGridDouble');
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

  await page.goto('/timetable/builder');
  await expect(heading(page, en.timetable.builder.title)).toBeVisible();
  await page.locator('[data-step="grid"] button').click();
  await expect(page.locator('[data-board]')).toBeVisible();
  const cell = (weekday: number, position: number) =>
    page.locator(`[data-cell="${String(weekday)}:${String(position)}"]`);
  const doubles = page.locator('[data-tile-double]');

  // 7 Oxford's Geometry from "To place" as a double on Wednesday at 08:00.
  const entry = page.locator('[aria-labelledby="grid-to-place"] [data-to-place]').first();
  await expect(entry).toContainText('Geometry');
  await entry.getByRole('checkbox', { name: en.timetable.grid.placeDouble }).check();
  await entry.getByRole('button', { name: en.timetable.grid.place, exact: true }).click();
  const dialog = page.getByRole('dialog');
  // The last slot of the day has no slot after it for the second half.
  await expect(dialog.locator('[data-move-cell="3:3"] button')).toBeDisabled();
  await dialog.locator('[data-move-cell="3:1"] button').click();
  await expect(cell(3, 1).locator('[data-tile-double]')).toBeVisible();
  await expect(cell(3, 2).locator('[data-tile-double]')).toBeVisible();
  await expect(doubles).toHaveCount(2);
  const first = (await cell(3, 1).locator('[data-block]').getAttribute('data-block')) ?? '';
  const second = (await cell(3, 2).locator('[data-block]').getAttribute('data-block')) ?? '';
  await screenshot(page, 'grid-double');

  // Dragged by its first half to Thursday at 08:00: the second half goes to 08:45.
  // The first row: the status lines of a drag make the rows below taller.
  await cell(3, 1).locator(`[data-block="${first}"]`).dragTo(cell(4, 1));
  await expect(cell(4, 1).locator(`[data-block="${first}"]`)).toBeVisible();
  await expect(cell(4, 2).locator(`[data-block="${second}"]`)).toBeVisible();
  await expect(cell(3, 1).locator('[data-block]')).toHaveCount(0);

  // Removed by its second half: both go.
  await cell(4, 2)
    .locator(`[data-block="${second}"]`)
    .getByRole('button', { name: en.timetable.grid.remove })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: en.timetable.grid.remove })
    .click();
  await expect(doubles).toHaveCount(0);
  await expect(cell(4, 1).locator('[data-block]')).toHaveCount(0);
});
