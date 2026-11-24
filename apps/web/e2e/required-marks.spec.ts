import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { languageChooser, type PageTexts } from './steps';

// Task 11.18, docs/spec/12-ux-standards.md, No lost work: "A field that must be
// filled is marked with a red asterisk (*) after its label, on every form and
// in every language, and a screen reader announces it as required." The red is
// `--destructive` of docs/design-system.md: #A3221A in the light theme,
// #FF8F85 in the dark one, which the browser reports as the oklch of index.css. The sign-in form needs no account: its login and
// password are required by `passwordSignInSchema`, "Trust this device" is not.

const RED = {
  light: 'oklch(0.468 0.1662 28.87)',
  dark: 'oklch(0.7681 0.137 26.09)',
} as const;
const LANGUAGES = [
  ['uz', uz],
  ['ru', ru],
  ['en', en],
] as const;

async function checkMarks(page: Page, texts: PageTexts, theme: keyof typeof RED) {
  const form = page.locator('form').first();
  const marks = form.locator('[data-required-mark]');
  await expect(marks).toHaveCount(2);
  for (const mark of await marks.all()) {
    await expect(mark).toBeVisible();
    await expect(mark).toHaveText('*');
    await expect(mark).toHaveAttribute('aria-hidden', 'true');
    await expect(mark).toHaveCSS('color', RED[theme]);
  }
  // The name is the label's words alone; the screen reader hears "required".
  const login = form.getByLabel(texts.signIn.login, { exact: true });
  const password = form.getByLabel(texts.signIn.password, { exact: true });
  await expect(login).toHaveAttribute('aria-required', 'true');
  await expect(password).toHaveAttribute('aria-required', 'true');
  // The browser's own bubble never: the form says what to fix in plain words.
  await expect(form.locator('[required]')).toHaveCount(0);
  // Each mark stands right after its label.
  const markBox = await marks.first().boundingBox();
  const labelBox = await form.getByText(texts.signIn.login, { exact: true }).boundingBox();
  expect(markBox !== null && labelBox !== null).toBe(true);
  if (markBox !== null && labelBox !== null) {
    expect(markBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width - 1);
    expect(Math.abs(markBox.y - labelBox.y)).toBeLessThan(labelBox.height);
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`the sign-in form marks its required fields in red in three languages, ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/sign-in');
    if (theme === 'dark') {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
    let shown: PageTexts = en;
    for (const [code, texts] of LANGUAGES) {
      await languageChooser(page, shown).selectOption(code);
      shown = texts;
      await expect(page.getByLabel(texts.signIn.login, { exact: true })).toBeVisible();
      await checkMarks(page, texts, theme);
    }
  });
}
