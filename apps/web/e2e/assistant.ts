import { expect, type Page } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { heading } from './steps';

/**
 * Task 11.12 (build plan, Done when: "with the fake model the Super Admin asks 'which classes have
 * no Tutor' and gets the platform's own list"), a step of the setup Super Admin's test (the seed
 * holds no fourth Super Admin, correction 1 of #87). The browser tests' API runs the scripted
 * model (`ASSISTANT_SCRIPTED_MODEL=1`, `src/testing/e2e/server.ts`): it reads the classes through
 * the platform's own route as the person and names those with no Tutor. The seed gave the branch
 * "Assistant browser test branch" two classes with no Tutor; the assistant is off until the step
 * switches it on.
 */
export async function askTheAssistant(page: Page): Promise<void> {
  // Off until switched on: no button in the top bar.
  await expect(page.getByRole('button', { name: en.assistant.open, exact: true })).toHaveCount(0);
  await page.goto('/setup/settings');
  const section = page.getByRole('region', { name: en.assistant.settings.title });
  await section.getByLabel(en.assistant.settings.schoolOn, { exact: true }).check();
  await section
    .getByLabel(en.assistant.settings.roleOn.replace('{{role}}', en.roles.super_admin), {
      exact: true,
    })
    .check();
  await section.getByRole('button', { name: en.form.save, exact: true }).click();
  await expect(section.getByText(en.form.saved)).toBeVisible();

  await page
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Assistant browser test branch' });
  await page.getByRole('button', { name: en.assistant.open, exact: true }).click();
  const panel = page.getByRole('complementary', { name: en.assistant.title });
  await expect(panel).toBeVisible();
  await panel
    .getByLabel(en.assistant.question, { exact: true })
    .fill('Which classes have no Tutor?');
  await panel.getByRole('button', { name: en.assistant.send, exact: true }).click();

  // The answer is the platform's own list: the read went through GET /api/classes as the person.
  await expect(panel.getByText('Assistant A, Assistant B', { exact: true })).toBeVisible();
  await expect(
    panel.getByText(en.assistant.read.replace('{{what}}', en.assistant.groups.classes), {
      exact: true,
    }),
  ).toBeVisible();
  await panel.getByRole('button', { name: en.assistant.close, exact: true }).click();

  await theOpenRecord(page);
  await whileItWorks(page);

  // Every conversation, for the Super Admin.
  await page.goto('/assistant-conversations');
  await expect(heading(page, en.assistant.conversationsPage.title)).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Which classes have no Tutor?' }),
  ).toBeVisible();
}

/**
 * Task 11.19 (build plan, Done when: "a question sent from a student's panel resolves 'this
 * student'; a link opens the named record"; `02`, Knows where the person is): from a record
 * open in its side panel, here a class, the question carries the page and the record; the
 * scripted model reads the class open there through the platform's own route, links its
 * record and names it. The link of the answer opens that record again.
 */
async function theOpenRecord(page: Page): Promise<void> {
  await page.goto('/classes');
  await page
    .getByRole('button', { name: /Assistant A/ })
    .first()
    .click();
  await expect(page).toHaveURL(/[?&]open=[0-9a-f-]{36}/);
  const opened = new URL(page.url()).searchParams.get('open');
  await page.getByRole('button', { name: en.assistant.open, exact: true }).click();
  const panel = page.getByRole('complementary', { name: en.assistant.title });
  await panel.getByLabel(en.assistant.question, { exact: true }).fill('Which class is this?');
  await panel.getByRole('button', { name: en.assistant.send, exact: true }).click();
  await expect(panel.getByText('This is Assistant A.', { exact: true })).toBeVisible();

  // The link opens the named record: the class's panel closed first, then opened by the link.
  await page
    .getByRole('complementary', { name: /Assistant A/ })
    .getByRole('button', { name: en.list.closePanel, exact: true })
    .click();
  await expect(page).not.toHaveURL(/open=/);
  await panel.getByRole('link', { name: 'Classes', exact: true }).last().click();
  await expect(page).toHaveURL(new RegExp(`[?&]open=${opened ?? ''}`));
  await expect(page.getByRole('heading', { name: /Assistant A/ }).first()).toBeVisible();
  await panel.getByRole('button', { name: en.assistant.close, exact: true }).click();
}

/**
 * Task 11.16 (build plan, Done when; `02`, While it works; `edge/people-roles-accounts`, "A person
 * closes the panel while the assistant is still working" and "… or in two tabs"): the scripted
 * model waits 4 s before its answer (`ASSISTANT_SCRIPTED_DELAY_MS`, `server.ts`). On the Assistant
 * page, opened from the menu: the question and an empty box before the answer, "Reading: …" while
 * the model waits, then the answer; a second tab of the same conversation sees a question sent in
 * the first, and a second question sent there while one runs is refused; a page left mid-answer
 * shows the stored answer once when it is opened again.
 */
async function whileItWorks(page: Page): Promise<void> {
  const answer = 'Assistant A, Assistant B';
  const reading = en.assistant.reading.replace('{{what}}', en.assistant.groups.classes);
  await page.getByRole('link', { name: en.menu.assistant, exact: true }).first().click();
  await expect(heading(page, en.assistant.page.title)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: en.assistant.conversations, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: en.assistant.newConversation, exact: true }).click();
  const box = page.getByLabel(en.assistant.question, { exact: true });
  await box.fill('Which classes have no Tutor, please?');
  await page.getByRole('button', { name: en.assistant.send, exact: true }).click();
  const chat = page.getByRole('region', { name: en.assistant.title, exact: true });
  // At once: the question, an empty box, and what the assistant reads while the model waits.
  await expect(
    chat.getByText('Which classes have no Tutor, please?', { exact: true }),
  ).toBeVisible();
  await expect(box).toHaveValue('');
  await expect(chat.getByText(reading, { exact: true })).toBeVisible();
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(0);
  await expect(chat.getByText(answer, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/conversation=[0-9a-f-]{36}/);
  const address = new URL(page.url());

  // A second tab of the same conversation, in the same branch.
  const other = await page.context().newPage();
  await other.goto(`${address.pathname}${address.search}`);
  await other
    .getByRole('combobox', { name: en.switcher.branch, exact: true })
    .selectOption({ label: 'Assistant browser test branch' });
  await other.goto(`${address.pathname}${address.search}`);
  const otherChat = other.getByRole('region', { name: en.assistant.title, exact: true });
  await expect(otherChat.getByText(answer, { exact: true })).toBeVisible();

  // A question sent in the first tab shows in the second.
  await box.fill('And once more?');
  await page.getByRole('button', { name: en.assistant.send, exact: true }).click();
  await expect(otherChat.getByText('And once more?', { exact: true })).toBeVisible();
  // While it is answered, a second question of the person is refused with its message.
  await other.getByRole('button', { name: en.assistant.newConversation, exact: true }).click();
  await other.getByLabel(en.assistant.question, { exact: true }).fill('A second question now?');
  await other.getByRole('button', { name: en.assistant.send, exact: true }).click();
  await expect(
    other.getByText(en.assistant.refusals.assistant_question_running, { exact: true }),
  ).toBeVisible();
  await expect(other.getByLabel(en.assistant.question, { exact: true })).toHaveValue(
    'A second question now?',
  );
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(2, { timeout: 15_000 });
  await other.close();

  // A page left while the assistant works: the answer is stored, and shows once.
  await box.fill('One more, then I leave.');
  await page.getByRole('button', { name: en.assistant.send, exact: true }).click();
  await expect(chat.getByText(reading, { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(heading(page, en.home.title)).toBeVisible();
  await page.goto(`${address.pathname}${address.search}`);
  await expect(chat.getByText('One more, then I leave.', { exact: true })).toHaveCount(1);
  // The answer written while the page was away: once, whenever it is stored (code review, should
  // fix 8: no fixed wait).
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(3, { timeout: 15_000 });
  await expect(chat.getByText(en.assistant.working, { exact: true })).toHaveCount(0);
}
