import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { LANGUAGE_NAMES } from '../src/i18n/languages';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { accountOf } from './accounts';
import { pdfText, readPdf } from './pdf-text';
import { xlsxTexts } from './xlsx-text';
import { changeFirstPassword, heading, languageChooser, openPersonMenu, signIn } from './steps';
import { codeNow } from './totp';

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
 * The file of a button as the browser saves it, and the name the server gave
 * it (`filename*`): the name the browser keeps depends on the machine's
 * locale, a Cyrillic one is dropped without a UTF-8 one.
 */
async function download(
  page: Page,
  button: string,
  within: Page | Locator = page,
): Promise<{ name: string; bytes: Buffer }> {
  const started = page.waitForEvent('download');
  const answered = page.waitForResponse((response) => response.url().endsWith('/export'));
  await within.getByRole('button', { name: button, exact: true }).click();
  const disposition = (await answered).headers()['content-disposition'] ?? '';
  const file = await started;
  const path = await file.path();
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '');
  return { name, bytes: await readFile(path) };
}

/** Switches the account's language from the person menu; the page then speaks it. */
async function speak(
  page: Page,
  from: typeof en,
  to: 'ru' | 'uz',
  texts: typeof en,
  title = texts.timetable.views.title,
) {
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/language') && response.status() === 204,
  );
  await openPersonMenu(page, from);
  await page.getByRole('menuitemradio', { name: LANGUAGE_NAMES[to], exact: true }).click();
  await saved;
  await expect(heading(page, title)).toBeVisible();
}

/** The fonts the server may embed: Golos Text, and Bitter for U+02BB alone (decision 16). */
const EMBEDDED = /^(GolosText|Bitter)-/;

// docs/spec/06-timetable.md, Views and outputs: "Print, PDF and Excel for one
// class, one teacher, one room or the whole school"; edge/timetable, "The
// wall timetable is out of date": "A printed day or week includes them with
// an 'as of' time"; edge/system-behaviour: "PDFs are made on the server with
// fonts that cover Uzbek Latin and Cyrillic" (task 5.9c-1, pull request #199,
// Done when: "exported PDFs show Uzbek Latin and Cyrillic correctly"). The
// publishable grid scene: the Academic Vice Principal publishes, downloads
// the school week in Russian and a teacher's week in Uzbek, and the text of
// every page is read back from the files. All names are invented.
test('an Academic Vice Principal downloads the timetable as PDF and Excel in Russian and Uzbek', async ({
  page,
}) => {
  const account = accountOf('timetableFiles');
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

  // Publish the draft from its default start, as the publish test does.
  const builder = en.timetable.builder;
  const texts = en.timetable.publish;
  await page.goto('/timetable/builder');
  await expect(heading(page, builder.title)).toBeVisible();
  await page.getByRole('button', { name: builder.confirm, exact: true }).click();
  await expect(page.getByText(builder.confirmed, { exact: true })).toBeVisible();
  await page.locator('[data-step="publish"] button').click();
  await expect(page.locator('[data-can-publish]')).toHaveText(texts.nothingRefused);
  await page.getByRole('button', { name: texts.action, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: texts.action, exact: true })
    .click();
  await expect(page.locator('[data-published]')).toBeVisible();

  // The school week, two weeks after the version starts, in Russian.
  const [, , week = ''] = mondaysAhead(3);
  await page.goto(`/timetable/views?kind=branch&date=${week}&span=week`);
  await expect(heading(page, en.timetable.views.title)).toBeVisible();
  await speak(page, en, 'ru', ru);
  const school = await download(page, ru.timetable.views.pdf);
  expect(school.name).toMatch(/^школа-\d{4}-\d{2}-\d{2}\.pdf$/);
  const russian = readPdf(school.bytes);
  expect(russian.fonts.length).toBeGreaterThan(0);
  for (const font of russian.fonts) expect(font).toMatch(EMBEDDED);
  // A week of the school runs to two pages; "as of" and the number are on each.
  expect(russian.pages.length).toBeGreaterThanOrEqual(2);
  for (const [index, text] of russian.pages.entries()) {
    expect(text).toContain(pdfText('По состоянию на'));
    expect(text).toContain(pdfText(`Страница ${String(index + 1)}`));
    expect(text).not.toContain('�');
  }
  const all = russian.pages.join('');
  expect(all).toContain(pdfText('Расписание школы'));
  expect(all).toContain(pdfText('7 Oxford'));
  // Uzbek Cyrillic letters, which only the cyrillic-ext file of Golos Text draws.
  expect(all).toContain(pdfText('7 Ғўзақаҳ'));
  expect(all).toContain(pdfText('Версия 1, действует с'));

  // Excel of the same view.
  const sheet = await download(page, ru.timetable.views.excel);
  expect(sheet.name).toMatch(/^школа-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const cells = xlsxTexts(sheet.bytes);
  // The preamble: the title, then "as of" (correction of the plan: the file opens with them).
  expect(cells[0]).toMatch(/^Расписание школы · Неделя /);
  expect(cells[1]).toMatch(/^По состоянию на \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  expect(cells).toContain('7 Ғўзақаҳ');

  // A teacher's week in Uzbek: "Oʻqituvchi" with U+02BB, drawn from the embedded fonts.
  await speak(page, ru, 'uz', uz);
  const views = uz.timetable.views;
  await page.getByRole('radio', { name: views.kind_teacher, exact: true }).check({ force: true });
  await expect(page.getByRole('combobox', { name: views.kind_teacher, exact: true })).toBeVisible();
  const teacher = await download(page, views.pdf);
  expect(teacher.name).toMatch(/^oqituvchi-.+\.pdf$/);
  const uzbek = readPdf(teacher.bytes);
  for (const font of uzbek.fonts) expect(font).toMatch(EMBEDDED);
  expect(uzbek.fonts.some((font) => font.startsWith('Bitter-'))).toBe(true);
  const text = uzbek.pages.join('');
  expect(text).toContain(pdfText('Oʻqituvchi dars jadvali'));
  expect(text).toContain(pdfText('holatiga'));
  expect(text).not.toContain('�');
});

// edge/timetable, "The wall timetable is out of date": "A printed pattern
// carries the version, 'valid from', the print time and 'one-day changes not
// included'. ... A draft print is marked DRAFT" (task 5.9c-2, pull request
// #200, Done when: "a draft print reads DRAFT and the PDFs show Uzbek Latin
// and Cyrillic correctly"). The seed's draft is left unpublished; the
// Academic Vice Principal prints it from Version history in English, Russian
// and Uzbek, and every page is read back. All names are invented.
test('an Academic Vice Principal prints a draft version, marked DRAFT, in three languages', async ({
  page,
}) => {
  const account = accountOf('versionFiles');
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

  await page.goto('/timetable/versions');
  await expect(heading(page, en.timetable.history.title)).toBeVisible();
  const open = async () => {
    await page.getByRole('button', { name: /^(Version 1|Версия 1|1-versiya)$/ }).click();
    const panel = page.getByRole('complementary', { name: /^(Version 1|Версия 1|1-versiya)$/ });
    await expect(panel.locator('[data-view-files]')).toBeVisible();
    return panel;
  };

  // English: DRAFT on every page.
  const english = await download(page, en.timetable.views.pdf, await open());
  expect(english.name).toBe('version-1-school.pdf');
  const draft = readPdf(english.bytes);
  expect(draft.pages.length).toBeGreaterThan(0);
  for (const font of draft.fonts) expect(font).toMatch(EMBEDDED);
  for (const text of draft.pages) {
    expect(text).toContain(pdfText('DRAFT'));
    expect(text).toContain(pdfText('Version 1, planned from'));
    expect(text).toContain(pdfText('One-day changes not included'));
    expect(text).not.toContain('�');
  }

  // Russian: ЧЕРНОВИК and a class named in Uzbek Cyrillic.
  await speak(page, en, 'ru', ru, ru.timetable.history.title);
  const russian = readPdf((await download(page, ru.timetable.views.pdf, await open())).bytes);
  for (const font of russian.fonts) expect(font).toMatch(EMBEDDED);
  for (const text of russian.pages) {
    expect(text).toContain(pdfText('ЧЕРНОВИК'));
    expect(text).toContain(pdfText('Изменения на один день не учтены'));
    expect(text).not.toContain('�');
  }
  expect(russian.pages.join('')).toContain(pdfText('7 Ғўзақаҳ'));

  // Uzbek: oʻ with U+02BB, drawn from the embedded fonts.
  await speak(page, ru, 'uz', uz, uz.timetable.history.title);
  const uzbek = readPdf((await download(page, uz.timetable.views.pdf, await open())).bytes);
  for (const font of uzbek.fonts) expect(font).toMatch(EMBEDDED);
  expect(uzbek.fonts.some((font) => font.startsWith('Bitter-'))).toBe(true);
  const text = uzbek.pages.join('');
  expect(text).toContain(pdfText('QORALAMA'));
  expect(text).toContain(pdfText('Bir kunlik oʻzgarishlar kiritilmagan'));
  expect(text).not.toContain('�');
});
