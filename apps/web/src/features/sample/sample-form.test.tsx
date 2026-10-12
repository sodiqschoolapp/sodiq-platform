import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NAMES_SHOWN } from '@/components/confirm-dialog';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, nothing, renderApp, sessionOf } from '@/testing/render-app';

const PATH = '/dev/patterns';

// The second sample row: grade 6, class Cambridge, Uzbek, score 77.
const BEKZOD = 'Bekzod Abdullayev';
const DILSHOD = 'Dilshod Abdullayev';

/** The sample list with the record of Bekzod open in the side panel. */
async function openForm(query = '', language: 'en' | 'ru' = 'en') {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf()),
    'POST /api/auth/sign-out': () => nothing(),
  });
  const shell = renderApp(`${PATH}?q=abdullayev&open=sample-0002${query}`, language);
  const panel = await screen.findByRole('complementary', { name: BEKZOD });
  return { ...shell, calls, panel };
}

const field = (panel: HTMLElement, label: string) =>
  within(panel).getByLabelText<HTMLInputElement>(label);

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

/** What a field says is wrong with it, read the way a screen reader does. */
const errorOf = (input: HTMLElement): string | null => {
  if (input.getAttribute('aria-invalid') !== 'true') {
    return null;
  }
  const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
  return document.getElementById(ids.at(-1) ?? '')?.textContent ?? null;
};

const save = (panel: HTMLElement): void => {
  fireEvent.click(within(panel).getByRole('button', { name: en.form.save }));
};

/** The sign in the top bar, which is the first header of the page (a page has a header of its own). */
const banner = () => {
  const topBar = document.querySelector<HTMLElement>('header');
  if (topBar === null) {
    throw new Error('The page has no top bar.');
  }
  return within(topBar).getByRole('status');
};

const leaveDialog = () => screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });

const noDialog = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
};

const rowButton = (name: string) => screen.getByText(name, { selector: 'button' });

// docs/build-plan.md, task 0.8b-2: a sample form uses only the shared pieces.
// docs/spec/12-ux-standards.md, No lost work: "Forms check each field as it is
// typed and say in plain words what to fix."
describe('the fields of a record form', () => {
  it('opens with the values of the record and says nothing', async () => {
    const { panel } = await openForm();

    expect(within(panel).getByRole('form', { name: BEKZOD })).toBeDefined();
    expect(field(panel, en.sample.name).value).toBe(BEKZOD);
    expect(field(panel, en.sample.grade).value).toBe('6');
    expect(field(panel, en.sample.className).value).toBe('Cambridge');
    expect(field(panel, en.sample.language).value).toBe('uz');
    expect(field(panel, en.sample.score).value).toBe('77');
    expect(panel.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(banner().textContent).toBe('');
  });

  it('says what to fix in a field as it is typed, and stops when it is fixed', async () => {
    const { panel } = await openForm();
    const name = field(panel, en.sample.name);

    type(name, 'B');
    expect(errorOf(name)).toBe(en.form.tooShort_other.replace('{{n}}', '2'));
    // The other fields were not typed into: they say nothing.
    expect(panel.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);

    type(name, '   ');
    expect(errorOf(name)).toBe(en.form.required);

    type(name, 'x'.repeat(101));
    expect(errorOf(name)).toBe(en.form.tooLong_other.replace('{{n}}', '100'));

    type(name, 'Bekzod Aliyev');
    expect(errorOf(name)).toBeNull();
  });

  // CLAUDE.md: typed scores and totals are whole numbers.
  it('takes whole numbers only in a number field, within its limits', async () => {
    const { panel } = await openForm();
    const grade = field(panel, en.sample.grade);
    const score = field(panel, en.sample.score);

    for (const fraction of ['6.5', '6,5', '1e1', 'six', '0x6']) {
      type(grade, fraction);
      expect(errorOf(grade)).toBe(en.form.wholeNumber);
    }
    type(grade, '12');
    expect(errorOf(grade)).toBe(en.form.tooBig.replace('{{max}}', '11'));
    type(grade, '0');
    expect(errorOf(grade)).toBe(en.form.tooSmall.replace('{{min}}', '1'));
    type(grade, '');
    expect(errorOf(grade)).toBe(en.form.required);
    type(grade, ' 7 ');
    expect(errorOf(grade)).toBeNull();

    type(score, '101');
    expect(errorOf(score)).toBe(en.form.tooBig.replace('{{max}}', '100'));
    type(score, '-1');
    expect(errorOf(score)).toBe(en.form.tooSmall.replace('{{min}}', '0'));
    // An empty score is a record without a score.
    type(score, '');
    expect(errorOf(score)).toBeNull();
  });

  it('says it in the language of the person, with its plural forms', async () => {
    const { panel } = await openForm('', 'ru');
    const name = within(panel).getByLabelText(ru.sample.name);

    type(name, 'Б');

    expect(errorOf(name)).toBe(ru.form.tooShort_few.replace('{{n}}', '2'));
  });
});

// Decided by the owner (task 0.8b): a Save button on record forms.
describe('the Save button of a record form', () => {
  it('sends nothing while a field is wrong, says what to fix everywhere and goes to the first', async () => {
    const { panel } = await openForm();
    type(field(panel, en.sample.className), '');
    type(field(panel, en.sample.grade), 'x');

    save(panel);

    await waitFor(() => {
      expect(document.activeElement).toBe(field(panel, en.sample.grade));
    });
    expect(errorOf(field(panel, en.sample.className))).toBe(en.form.required);
    expect(within(panel).getByRole('status').textContent).toBe('');
    expect(banner().textContent).toBe(en.unsent.typed);
  });

  it('saves the record, says so, and the list shows it', async () => {
    const { panel } = await openForm();
    type(field(panel, en.sample.score), '90');
    type(field(panel, en.sample.grade), '7');
    expect(banner().textContent).toBe(en.unsent.typed);

    save(panel);

    await waitFor(() => {
      expect(within(panel).getByRole('status').textContent).toBe(en.form.saved);
    });
    const row = document.querySelectorAll('tbody tr')[1];
    expect(row?.querySelector('td:nth-child(3)')?.textContent).toBe('7 Cambridge');
    expect(row?.querySelector('td:nth-child(6)')?.textContent).toBe('90');
    expect(banner().textContent).toBe('');

    // "Saved" is said of what was saved, not of what is typed afterwards.
    type(field(panel, en.sample.score), '91');
    expect(within(panel).getByRole('status').textContent).toBe('');
    expect(banner().textContent).toBe(en.unsent.typed);
  });

  // docs/spec/12-ux-standards.md, Look and feel: full keyboard use.
  it('leaves the focus in the field when the saved name changes the title of the panel', async () => {
    const { panel } = await openForm();
    const name = field(panel, en.sample.name);
    name.focus();
    type(name, 'Bekzod Aliyev');

    save(panel);

    const renamed = await screen.findByRole('complementary', { name: 'Bekzod Aliyev' });
    await waitFor(() => {
      expect(within(renamed).getByRole('status').textContent).toBe(en.form.saved);
    });
    expect(document.activeElement).toBe(field(renamed, en.sample.name));
  });

  it('keeps what was typed when the save is refused, and says what happened', async () => {
    const { panel } = await openForm('&demo=save-fails');
    type(field(panel, en.sample.score), '90');

    save(panel);

    expect((await within(panel).findByRole('alert')).textContent).toBe(en.problems.noAnswer);
    expect(field(panel, en.sample.score).value).toBe('90');
    expect(within(panel).getByRole('status').textContent).toBe('');
    expect(banner().textContent).toBe(en.unsent.failed);
  });
});

// docs/build-plan.md, task 0.8b-2: the unsent-changes banner (typed and not
// saved, or a save that failed).
describe('the sign of unsaved changes in the top bar', () => {
  it('leads to the form', async () => {
    const { panel } = await openForm();
    type(field(panel, en.sample.score), '90');

    fireEvent.click(within(banner()).getByRole('button', { name: en.unsent.typed }));

    expect(document.activeElement).toBe(field(panel, en.sample.name));
  });

  it('goes away when what was typed is taken back', async () => {
    const { panel } = await openForm();

    type(field(panel, en.sample.score), '90');
    type(field(panel, en.sample.score), '77');

    expect(banner().textContent).toBe('');
  });
});

// Decided by the owner (task 0.8b): a warning before leaving with typed changes.
describe('leaving a record form with typed changes', () => {
  it('asks before another record is opened, and stays when the person stays', async () => {
    const { panel, router } = await openForm();
    type(field(panel, en.sample.score), '90');

    fireEvent.click(rowButton(DILSHOD));

    const dialog = await leaveDialog();
    // The dialog names what will be affected.
    expect(within(dialog).getByText(BEKZOD)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));

    await noDialog();
    expect(field(screen.getByRole('complementary', { name: BEKZOD }), en.sample.score).value).toBe(
      '90',
    );
    expect(router.state.location.search).toEqual({ q: 'abdullayev', open: 'sample-0002' });
    expect(banner().textContent).toBe(en.unsent.typed);
  });

  it('opens the other record when the person leaves, and drops what was typed', async () => {
    const { panel } = await openForm();
    type(field(panel, en.sample.score), '90');

    fireEvent.click(rowButton(DILSHOD));
    fireEvent.click(within(await leaveDialog()).getByRole('button', { name: en.unsent.leave }));

    expect(await screen.findByRole('complementary', { name: DILSHOD })).toBeDefined();
    expect(banner().textContent).toBe('');

    // Back at the first record: it has what was saved, not what was typed.
    fireEvent.click(rowButton(BEKZOD));
    const again = await screen.findByRole('complementary', { name: BEKZOD });
    expect(field(again, en.sample.score).value).toBe('77');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks when the panel is closed with its button and with Escape', async () => {
    const { panel } = await openForm();
    type(field(panel, en.sample.score), '90');

    fireEvent.click(within(panel).getByRole('button', { name: en.list.closePanel }));
    fireEvent.click(within(await leaveDialog()).getByRole('button', { name: en.unsent.stay }));
    await noDialog();
    expect(screen.getByRole('complementary', { name: BEKZOD })).toBeDefined();

    fireEvent.keyDown(field(panel, en.sample.score), { key: 'Escape' });
    fireEvent.click(within(await leaveDialog()).getByRole('button', { name: en.unsent.leave }));

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
  });

  it('takes Escape on the question as "stay", once: the panel stays open', async () => {
    const { panel } = await openForm();
    type(field(panel, en.sample.score), '90');
    fireEvent.click(rowButton(DILSHOD));

    fireEvent.keyDown(await leaveDialog(), { key: 'Escape' });

    await noDialog();
    expect(field(screen.getByRole('complementary', { name: BEKZOD }), en.sample.score).value).toBe(
      '90',
    );
  });

  it('asks also when a save was refused and nothing was typed since', async () => {
    const { panel } = await openForm('&demo=save-fails');
    type(field(panel, en.sample.score), '90');
    save(panel);
    await within(panel).findByRole('alert');

    fireEvent.click(rowButton(DILSHOD));

    const dialog = await leaveDialog();
    expect(within(dialog).getByText(BEKZOD)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await noDialog();
    expect(field(panel, en.sample.score).value).toBe('90');
  });

  it('asks before a link leads to another page', async () => {
    const { panel, router } = await openForm();
    type(field(panel, en.sample.score), '90');
    const home = () =>
      within(screen.getByRole('navigation', { name: en.layout.breadcrumbs })).getByRole('link', {
        name: en.home.title,
      });

    fireEvent.click(home());
    fireEvent.click(within(await leaveDialog()).getByRole('button', { name: en.unsent.stay }));

    await noDialog();
    expect(router.state.location.pathname).toBe(PATH);
    expect(field(panel, en.sample.score).value).toBe('90');

    fireEvent.click(home());
    fireEvent.click(within(await leaveDialog()).getByRole('button', { name: en.unsent.leave }));

    expect(await screen.findByRole('heading', { name: en.home.title })).toBeDefined();
  });

  // The Back button and the closing of the tab are asked by the history of a
  // real browser only: the history of these tests lets both pass. They are
  // checked in the browser test (apps/web/e2e/forms.spec.ts).

  it('does not ask when the list behind the record is searched or sorted', async () => {
    const { panel, router } = await openForm();
    type(field(panel, en.sample.score), '90');

    fireEvent.change(screen.getByRole('searchbox', { name: en.list.search }), {
      target: { value: 'bekzod' },
    });

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: 'bekzod', open: 'sample-0002' });
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(field(panel, en.sample.score).value).toBe('90');
  });

  it('does not ask when nothing is typed', async () => {
    await openForm();

    fireEvent.click(rowButton(DILSHOD));

    expect(await screen.findByRole('complementary', { name: DILSHOD })).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before sign-out, and sends nothing when the person stays', async () => {
    const { panel, calls } = await openForm();
    type(field(panel, en.sample.score), '90');
    const signOut = (): void => {
      // The sign-out button at the foot of the menu (docs/design-system.md,
      // Layout shell), focused by the click as in a browser.
      const button = screen.getByRole('button', { name: en.layout.signOut });
      button.focus();
      fireEvent.click(button);
    };
    const sent = () => calls.filter((call) => call.route === 'POST /api/auth/sign-out');

    signOut();
    fireEvent.click(within(await leaveDialog()).getByRole('button', { name: en.unsent.stay }));
    await noDialog();
    expect(sent()).toHaveLength(0);
    expect(field(panel, en.sample.score).value).toBe('90');
    // The keyboard goes on from the sign-out button.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: en.layout.signOut }));
    });

    signOut();
    fireEvent.click(within(await leaveDialog()).getByRole('button', { name: en.unsent.leave }));

    expect(await screen.findByRole('heading', { name: en.signIn.title })).toBeDefined();
    expect(sent()).toHaveLength(1);
  });
});

// docs/spec/12-ux-standards.md, No lost work: "Actions that cannot be undone
// ask for confirmation and name what will be affected."
describe('the confirmation of a bulk action', () => {
  const tick = (name: string): void => {
    fireEvent.click(screen.getByLabelText(en.list.selectRow.replace('{{name}}', name)));
  };
  const archive = () => screen.getByRole('button', { name: en.sample.archive });
  const archivedRows = (): number =>
    [...document.querySelectorAll('tbody tr td:nth-child(5)')].filter(
      (cell) => cell.textContent === en.sample.archived,
    ).length;

  async function openList() {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp(`${PATH}?q=abdullayev`);
    await screen.findByRole('heading', { name: en.sample.title });
  }

  it('names the rows, runs nothing on Cancel and gives the focus back', async () => {
    await openList();
    const before = archivedRows();
    tick(BEKZOD);
    tick(DILSHOD);
    archive().focus();

    fireEvent.click(archive());

    const dialog = await screen.findByRole('alertdialog', {
      name: en.sample.archiveTitle_other.replace('{{n}}', '2'),
    });
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([BEKZOD, DILSHOD]);
    // The focus starts on the button that changes nothing.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: en.confirm.cancel }),
      );
    });

    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));

    await noDialog();
    expect(archivedRows()).toBe(before);
    await waitFor(() => {
      expect(document.activeElement).toBe(archive());
    });
  });

  it('runs nothing on Escape, and the action on its button', async () => {
    await openList();
    const before = archivedRows();
    tick(BEKZOD);

    fireEvent.click(archive());
    const title = en.sample.archiveTitle_one.replace('{{n}}', '1');
    fireEvent.keyDown(await screen.findByRole('alertdialog', { name: title }), { key: 'Escape' });
    await noDialog();
    expect(archivedRows()).toBe(before);

    fireEvent.click(archive());
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: title })).getByRole('button', {
        name: en.sample.archive,
      }),
    );

    await waitFor(() => {
      expect(archivedRows()).toBe(before + 1);
    });
  });

  it('writes out the first names and counts the rest', async () => {
    await openList();
    fireEvent.click(screen.getByRole('checkbox', { name: en.list.selectAll }));

    fireEvent.click(archive());

    const dialog = await screen.findByRole('alertdialog');
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(NAMES_SHOWN + 1);
    expect(items.at(-1)?.textContent).toBe(
      en.confirm.more.replace('{{n}}', String(20 - NAMES_SHOWN)),
    );
  });
});
