import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { accountOf, type AccountKey } from './accounts';
import { changeFirstPassword, heading, languageChooser, signIn } from './steps';
import { codeNow } from './totp';

// Task 3.5b (issue #105, Part C), each test with an account of its own
// (seeded in "Hand test 3.5b branch"): a full class marked in the choice
// (H24), a number pasted after the prefilled "+998 " and Save pressed at once
// linking the parent it finds (H25, H26), the side panel closed by a branch
// switch with no request for the old record sent with the new branch (H32),
// and a parent and the child found by the parent's phone with Ctrl+K (H33).
// All names and phones are invented.

async function signedIn(page: Page, key: AccountKey): Promise<void> {
  const account = accountOf(key);
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
}

test('a new student: the full class marked, the parent found by a pasted phone on the first Save', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signedIn(page, 'handTest35bForms');
  const texts = en.people.students;
  const relatives = en.people.relatives;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now());
  await page.goto('/people/students');
  await expect(heading(page, texts.title)).toBeVisible();
  await page.getByRole('button', { name: texts.add, exact: true }).first().click();
  const form = page.getByRole('form', { name: texts.newTitle });
  await form.getByLabel(texts.uid, { exact: true }).fill('9999813');
  await form.getByLabel(texts.lastName, { exact: true }).fill('Qodirov');
  await form.getByLabel(texts.firstName, { exact: true }).fill('Javohir');
  await form.getByLabel(texts.sex, { exact: true }).selectOption('male');
  await form.getByLabel(texts.birthDate, { exact: true }).fill('2013-09-14');
  await form.getByLabel(texts.grade, { exact: true }).selectOption('7');
  await form.getByLabel(texts.startsOn, { exact: true }).fill(today);

  // H24: 7 Yale holds its one seat: marked full, still offered.
  const classField = form.getByLabel(texts.class, { exact: true });
  await expect(
    classField.locator('option', { hasText: en.classes.seatsFull.replace('{{class}}', '7 Yale') }),
  ).toHaveCount(1);
  const oxford = await classField.locator('option', { hasText: /^7 Oxford/ }).getAttribute('value');
  await classField.selectOption(oxford ?? '');

  await form.getByLabel(texts.contractNumber, { exact: true }).fill('E2E-3-5B-1');
  await form.getByLabel(texts.contractSignedOn, { exact: true }).fill(today);
  // H25: the prefilled "+998 " and a whole number pasted after it.
  const phone = form.getByLabel(relatives.phone, { exact: true });
  await expect(phone).toHaveValue('+998 ');
  await phone.fill('+998 +998935553311');
  await form.getByLabel(relatives.relationship, { exact: true }).selectOption('mother');
  // H26: Save at once, whether or not the lookup has answered yet.
  await form.getByRole('button', { name: en.form.save, exact: true }).click();
  const question = page.getByRole('alertdialog', { name: texts.setTitle });
  const saved = page.getByRole('complementary', { name: 'Javohir Qodirov' });
  await expect(question.or(saved)).toBeVisible();
  if (await question.isVisible()) {
    await question.getByRole('button', { name: texts.saveAnyway, exact: true }).click();
  }
  await expect(saved).toBeVisible();
  await expect(page.getByText(en.errors.relative_phone_exists)).toHaveCount(0);
  await saved.getByText(texts.tabs.relatives, { exact: true }).click();
  await expect(saved.getByText('Qodirova Dilbar').first()).toBeVisible();
  await expect(saved.getByText('+998 93 555 33 11').first()).toBeVisible();
});

test('a branch switch closes the side panel of the old record, asking first', async ({ page }) => {
  test.setTimeout(120_000);
  await signedIn(page, 'handTest35bSwitch');
  const branches = page.getByRole('combobox', { name: en.switcher.branch, exact: true });
  await branches.selectOption({ label: 'Hand test 3.5b branch' });
  await page.goto('/classes');
  await expect(heading(page, en.classes.title)).toBeVisible();
  await page.getByRole('button', { name: '7 Oxford', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '7 Oxford' });
  await expect(panel).toBeVisible();
  const classId = new URL(page.url()).searchParams.get('open') ?? '';
  expect(classId).not.toBe('');
  await panel.getByRole('button', { name: en.form.edit, exact: true }).click();
  await panel.getByLabel(en.classes.maxSize, { exact: true }).fill('30');

  const sent: { url: string; branch: string | null }[] = [];
  page.on('request', (request) => {
    sent.push({ url: request.url(), branch: request.headers()['x-branch-id'] ?? null });
  });
  const second = await branches
    .locator('option', { hasText: 'Hand test 3.5b second branch' })
    .getAttribute('value');
  await branches.selectOption(second ?? '');
  const question = page.getByRole('alertdialog');
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: en.unsent.leave, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(branches).toHaveValue(second ?? '');
  expect(new URL(page.url()).searchParams.get('open')).toBeNull();
  await expect(page.getByRole('button', { name: '7 Cambridge', exact: true })).toBeVisible();
  // H32: nothing about the old branch's class went with the new branch.
  expect(sent.filter((one) => one.url.includes(classId) && one.branch === second)).toEqual([]);
});

test('Ctrl+K finds a parent and the child by the parent’s phone', async ({ page }) => {
  test.setTimeout(120_000);
  await signedIn(page, 'handTest35bSearch');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: en.search.label });
  await box.fill('935553311');
  const parents = page.getByRole('group', { name: en.search.relatives });
  await expect(parents.getByRole('option', { name: /^Qodirova Dilbar/ })).toBeVisible();
  const students = page.getByRole('group', { name: en.search.students });
  await expect(students.getByRole('option', { name: /^Qodirova Sevinch/ })).toContainText(
    en.search.relativeOf.replace('{{name}}', 'Qodirova Dilbar'),
  );
});
