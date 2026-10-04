import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROWS_AT_ONCE } from '@/components/list/list-page';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, renderApp, sessionOf } from '@/testing/render-app';
import { sampleRows } from './sample-rows';

const ROWS = sampleRows();

const PATH = '/dev/patterns';

/** The sample list at an address, once its page is drawn. */
async function openList(address = PATH, language: 'en' | 'ru' = 'en') {
  fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
  const shell = renderApp(address, language);
  await screen.findByRole('heading', { name: (language === 'en' ? en : ru).sample.title });
  return shell;
}

/**
 * The names in the first column of the rows drawn, from the top. Read from the
 * table itself: a query by role over hundreds of rows takes seconds in jsdom.
 */
const drawnNames = (): string[] =>
  [...document.querySelectorAll('tbody tr')].map(
    (row) => row.querySelector('td:nth-child(2)')?.textContent ?? '',
  );

const hasHeader = (name: string): boolean =>
  [...document.querySelectorAll('thead th')].some((cell) => cell.textContent === name);

const header = (name: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('thead th')].find(
    (cell) => cell.textContent === name,
  );
  if (found === undefined) {
    throw new Error(`The table has no column "${name}".`);
  }
  return found;
};

/** The button in a row that opens its record. */
const rowButton = (name: string) => screen.getByText(name, { selector: 'button' });

const searchBox = () => screen.getByRole<HTMLInputElement>('searchbox', { name: en.list.search });

const type = (value: string): void => {
  fireEvent.change(searchBox(), { target: { value } });
};

const countText = (shown: number, matching: number, total = ROWS.length): string =>
  en.list.count
    .replace('{{shown}}', String(shown))
    .replace('{{matching}}', String(matching))
    .replace('{{total}}', String(total));

const selectedText = (count: number): string =>
  (count === 1 ? en.list.selected_one : en.list.selected_other).replace('{{n}}', String(count));

/**
 * The status of the page. The top bar has one of its own (the sign of unsaved
 * changes, task 0.8b-2), so a test looks inside `main`.
 */
const pageStatus = () => within(screen.getByRole('main')).getByRole('status');

const tickAll = () => screen.getByRole<HTMLInputElement>('checkbox', { name: en.list.selectAll });

const tickRow = (name: string) =>
  screen.getByLabelText<HTMLInputElement>(en.list.selectRow.replace('{{name}}', name));

afterEach(() => {
  vi.unstubAllEnvs();
});

// docs/build-plan.md, task 0.8b-1: a sample list uses only the shared pieces.
describe('the sample list', () => {
  it('draws the first rows of the list at once and more when asked', async () => {
    await openList();

    expect(screen.getByRole('table', { name: en.sample.caption })).toBeDefined();
    expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);
    expect(drawnNames()[0]).toBe('Aziza Abdullayev');
    expect(screen.getByText(countText(ROWS_AT_ONCE, ROWS.length))).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: en.list.showMore }));

    expect(drawnNames()).toHaveLength(2 * ROWS_AT_ONCE);
  });

  // docs/spec/12-ux-standards.md, Navigation: breadcrumbs on inner pages.
  it('has breadcrumbs that lead to the home page', async () => {
    await openList();

    const crumbs = screen.getByRole('navigation', { name: en.layout.breadcrumbs });
    expect(within(crumbs).getByRole('link', { name: en.home.title }).getAttribute('href')).toBe(
      '/',
    );
    expect(within(crumbs).getByText(en.sample.title).getAttribute('aria-current')).toBe('page');
  });

  it('does not exist in the built app', async () => {
    vi.stubEnv('DEV', false);
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });

    renderApp(PATH);

    expect(await screen.findByRole('heading', { name: en.problems.notFoundTitle })).toBeDefined();
  });
});

// docs/spec/12-ux-standards.md, Lists: search. Speed targets: results while typing.
describe('the search of a list', () => {
  it('narrows the rows as it is typed and writes itself into the address', async () => {
    const { router } = await openList();

    type('ergashev');

    expect(drawnNames()).toHaveLength(20);
    expect(drawnNames().every((name) => name.endsWith('Ergashev'))).toBe(true);
    expect(screen.getByText(countText(20, 20))).toBeDefined();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: 'ergashev' });
    });
    // Typing does not fill the history: Back leaves the list.
    expect(router.history.length).toBe(1);
  });

  it('finds a name with oʻ and gʻ typed with the apostrophe of the keyboard', async () => {
    await openList();

    type("o'g'iloy ham");

    expect(drawnNames()).toEqual(['Oʻgʻiloy Hamidov']);
  });

  it('is read from the address, with the order and the filters', async () => {
    const filters = encodeURIComponent(JSON.stringify({ language: 'ru' }));
    await openList(`${PATH}?q=ergashev&sort=-name&f=${filters}`);

    expect(searchBox().value).toBe('ergashev');
    expect(
      within(screen.getByRole('main')).getByRole<HTMLSelectElement>('combobox', {
        name: en.sample.language,
      }).value,
    ).toBe('ru');
    const expected = ROWS.filter((row) => row.name.endsWith('Ergashev') && row.language === 'ru')
      .map((row) => row.name)
      .sort()
      .reverse();
    expect(expected.length).toBeGreaterThan(1);
    expect(drawnNames()).toEqual(expected);
  });

  it('follows the address when the person goes back', async () => {
    const { router } = await openList(`${PATH}?q=ergashev`);
    await act(() => router.navigate({ to: PATH, search: { q: 'komilov' } }));
    expect(searchBox().value).toBe('komilov');

    act(() => {
      router.history.back();
    });

    await waitFor(() => {
      expect(searchBox().value).toBe('ergashev');
    });
    expect(drawnNames().every((name) => name.endsWith('Ergashev'))).toBe(true);
  });

  it('says so when nothing matches, and offers to clear the search and filters', async () => {
    const { router } = await openList();

    type('no such name');

    expect(screen.getByText(en.list.noMatch)).toBeDefined();
    expect(drawnNames()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: en.list.clearSearch }));

    expect(searchBox().value).toBe('');
    expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);
    // The button went away with its click: the keyboard goes on from the search box.
    expect(document.activeElement).toBe(searchBox());
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
  });

  it('keeps what is typed when a column is sorted before the address has the search', async () => {
    const { router } = await openList();
    type('ergashev');

    // At once, before the typed search was written into the address.
    fireEvent.click(within(header(en.sample.name)).getByRole('button'));

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: 'ergashev', sort: 'name' });
    });
    expect(searchBox().value).toBe('ergashev');
    expect(drawnNames()).toHaveLength(20);
    expect(drawnNames()[0]).toBe('Aziza Ergashev');
    // Nothing is written a second time, and nothing takes the order back.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(router.state.location.search).toEqual({ q: 'ergashev', sort: 'name' });
    expect(router.history.length).toBe(2);
  });

  it('starts from the top again after "Show more" when the search changes', async () => {
    await openList();
    fireEvent.click(screen.getByRole('button', { name: en.list.showMore }));
    expect(drawnNames()).toHaveLength(2 * ROWS_AT_ONCE);

    type('a');
    type('');

    expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);
  });

  it('passes over an order and a filter the list does not have', async () => {
    const filters = encodeURIComponent(JSON.stringify({ status: 'gone', town: 'x' }));
    await openList(`${PATH}?sort=nothing&f=${filters}`);

    expect(screen.getByText(countText(ROWS_AT_ONCE, ROWS.length))).toBeDefined();
    expect(drawnNames()[0]).toBe('Aziza Abdullayev');
  });
});

// docs/spec/12-ux-standards.md, Lists: filters and sorting.
describe('the filters and the order of a list', () => {
  it('keeps the rows of the chosen filter value and writes it into the address', async () => {
    const { router } = await openList();
    const archived = ROWS.filter((row) => row.status === 'archived');

    fireEvent.change(screen.getByRole('combobox', { name: en.sample.status }), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(drawnNames()).toEqual(archived.map((row) => row.name));
    });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ f: { status: 'archived' } });
    });

    fireEvent.change(screen.getByRole('combobox', { name: en.sample.status }), {
      target: { value: '' },
    });

    expect(await screen.findByText(countText(ROWS_AT_ONCE, ROWS.length))).toBeDefined();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
  });

  it('sorts by a column from the start, then from the end, then not at all', async () => {
    const { router } = await openList();
    const scoreHeader = () => header(en.sample.score);
    const sortButton = () => within(scoreHeader()).getByRole('button', { name: en.sample.score });
    const scores = ROWS.flatMap((row) => (row.score === null ? [] : [row.score]));
    expect(scoreHeader().getAttribute('aria-sort')).toBe('none');

    fireEvent.click(sortButton());

    await waitFor(() => {
      expect(scoreHeader().getAttribute('aria-sort')).toBe('ascending');
    });
    const firstScore = () => document.querySelector('tbody tr td:nth-child(6)')?.textContent;
    expect(firstScore()).toBe(String(Math.min(...scores)));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ sort: 'score' });
    });

    fireEvent.click(sortButton());

    await waitFor(() => {
      expect(scoreHeader().getAttribute('aria-sort')).toBe('descending');
    });
    expect(firstScore()).toBe(String(Math.max(...scores)));

    fireEvent.click(sortButton());

    await waitFor(() => {
      expect(scoreHeader().getAttribute('aria-sort')).toBe('none');
    });
    expect(drawnNames()[0]).toBe('Aziza Abdullayev');
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
  });

  it('does not offer an order for a column that cannot be sorted', async () => {
    await openList();

    const statusHeader = header(en.sample.status);
    expect(statusHeader.getAttribute('aria-sort')).toBeNull();
    expect(within(statusHeader).queryByRole('button')).toBeNull();
  });
});

// docs/spec/12-ux-standards.md, Lists: column chooser.
describe('the column chooser of a list', () => {
  it('hides a column, remembers it in the browser, and never offers the column that opens the record', async () => {
    await openList();

    fireEvent.click(screen.getByRole('button', { name: en.list.columns }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitemcheckbox', { name: en.sample.name })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: en.sample.score }));

    await waitFor(() => {
      expect(hasHeader(en.sample.score)).toBe(false);
    });
    expect(hasHeader(en.sample.status)).toBe(true);
    expect(window.localStorage.getItem('sodiq.list.sample.hidden')).toBe('["score"]');
  });

  it('opens with the columns hidden before', async () => {
    window.localStorage.setItem('sodiq.list.sample.hidden', '["score","name","gone"]');

    await openList();

    expect(hasHeader(en.sample.score)).toBe(false);
    // The column that opens the record cannot be hidden, whatever the browser kept.
    expect(hasHeader(en.sample.name)).toBe(true);
  });
});

// docs/spec/12-ux-standards.md, Lists: checkboxes with bulk actions. Decided by
// the owner (task 0.8b): "tick all" means every row that matches the search
// and filters.
describe('the checkboxes and bulk actions of a list', () => {
  it('offers no action while nothing is ticked, and says the count when rows are', async () => {
    await openList();
    // The bar is there from the start, so the table does not move at the first tick.
    const bar = screen.getByRole('group', { name: en.list.bulkActions });
    const archive = () =>
      within(bar).getByRole<HTMLButtonElement>('button', { name: en.sample.archive });
    const clear = () =>
      within(bar).getByRole<HTMLButtonElement>('button', { name: en.list.clearSelection });
    expect(within(bar).getByRole('status').textContent).toBe(selectedText(0));
    expect(archive().disabled).toBe(true);
    expect(clear().disabled).toBe(true);

    fireEvent.click(tickRow('Aziza Abdullayev'));
    fireEvent.click(tickRow('Bekzod Abdullayev'));

    expect(within(bar).getByRole('status').textContent).toBe(selectedText(2));
    expect(archive().disabled).toBe(false);
    expect(tickAll().indeterminate).toBe(true);

    fireEvent.click(tickRow('Aziza Abdullayev'));
    expect(within(bar).getByRole('status').textContent).toBe(selectedText(1));

    fireEvent.click(clear());
    expect(within(bar).getByRole('status').textContent).toBe(selectedText(0));
    expect(tickRow('Bekzod Abdullayev').checked).toBe(false);
    // The button turned itself off: the keyboard goes on from "tick all".
    expect(document.activeElement).toBe(tickAll());
  });

  it('ticks every row that matches the search, and only those', async () => {
    await openList();
    type('ergashev');

    fireEvent.click(tickAll());

    expect(pageStatus().textContent).toBe(selectedText(20));
    expect(tickAll().checked).toBe(true);

    type('');

    expect(pageStatus().textContent).toBe(selectedText(20));
    expect(tickAll().checked).toBe(false);
    expect(tickAll().indeterminate).toBe(true);
    expect(tickRow('Aziza Abdullayev').checked).toBe(false);
    expect(tickRow('Aziza Ergashev').checked).toBe(true);
  });

  it('ticks every matching row of a long list, also those not drawn yet', async () => {
    await openList(`${PATH}?demo=many`);
    expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);

    fireEvent.click(tickAll());

    // docs/spec/12-ux-standards.md, Language: numbers follow the chosen language.
    expect(pageStatus().textContent).toBe(en.list.selected_other.replace('{{n}}', '2,500'));

    fireEvent.click(tickAll());

    expect(pageStatus().textContent).toBe(selectedText(0));
  });

  it('says how many ticked rows the search does not show', async () => {
    await openList();
    fireEvent.click(tickRow('Aziza Abdullayev'));
    fireEvent.click(tickRow('Bekzod Abdullayev'));

    type('bekzod');

    expect(pageStatus().textContent).toBe(
      `${selectedText(2)} ${en.list.selectedNotShown_one.replace('{{n}}', '1')}`,
    );
  });

  it('hands a bulk action every ticked row', async () => {
    await openList();
    const before = ROWS.filter((row) => row.status === 'archived').length;
    fireEvent.click(tickRow('Bekzod Abdullayev'));
    fireEvent.click(tickRow('Dilshod Abdullayev'));
    // One of the two is not shown by the search when the action runs.
    type('bekzod');

    fireEvent.click(screen.getByRole('button', { name: en.sample.archive }));
    // The action asks first (task 0.8b-2) and names both rows, the hidden one too.
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Dilshod Abdullayev')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.sample.archive }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    type('');
    fireEvent.change(screen.getByRole('combobox', { name: en.sample.status }), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(drawnNames()).toHaveLength(before + 2);
    });
    expect(drawnNames()).toContain('Bekzod Abdullayev');
    expect(drawnNames()).toContain('Dilshod Abdullayev');
  });

  it('counts in the forms of the language', async () => {
    await openList(PATH, 'ru');

    for (const box of [...document.querySelectorAll('tbody input[type=checkbox]')].slice(0, 2)) {
      fireEvent.click(box);
    }

    expect(pageStatus().textContent).toBe(ru.list.selected_few.replace('{{n}}', '2'));
  });
});

// docs/spec/12-ux-standards.md, Lists: export. The file is made by the server
// (CLAUDE.md: exports follow the role); the list says which rows and columns.
describe('the export of a list', () => {
  it('asks for the rows that match the search and filters', async () => {
    await openList();
    type('ergashev');

    fireEvent.click(screen.getByRole('button', { name: en.list.export }));

    expect(screen.getByText(en.sample.exported_other.replace('{{n}}', '20'))).toBeDefined();
  });

  it('is off when no row matches', async () => {
    await openList();

    type('no such name');

    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.list.export }).disabled).toBe(
      true,
    );
  });
});

// docs/spec/12-ux-standards.md, Lists: a side panel that opens a record
// without leaving the list. Navigation: links and the Back button work.
describe('the side panel of a list', () => {
  const panel = (name: string) => screen.findByRole('complementary', { name });

  it('opens a record beside the list, with an address of its own', async () => {
    const { router } = await openList();

    fireEvent.click(rowButton('Bekzod Abdullayev'));

    const opened = await panel('Bekzod Abdullayev');
    // The record is a form (task 0.8b-2): its fields hold the values of the row.
    expect(within(opened).getByLabelText<HTMLInputElement>(en.sample.grade).value).toBe('6');
    expect(within(opened).getByLabelText<HTMLInputElement>(en.sample.className).value).toBe(
      'Cambridge',
    );
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ open: 'sample-0002' });
    });
    // The list is still there, and its row is marked as the open one.
    expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);
    expect(document.querySelectorAll('tbody tr')[1]?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(
      within(opened).getByRole('heading', { name: 'Bekzod Abdullayev' }),
    );
  });

  it('closes with its button and with Escape, and gives the focus back to the row', async () => {
    const { router } = await openList();
    const row = rowButton('Bekzod Abdullayev');

    fireEvent.click(row);
    fireEvent.click(
      within(await panel('Bekzod Abdullayev')).getByRole('button', { name: en.list.closePanel }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(document.activeElement).toBe(row);

    fireEvent.click(row);
    await panel('Bekzod Abdullayev');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    expect(document.activeElement).toBe(row);
  });

  it('closes with the Back button of the browser', async () => {
    const { router } = await openList();
    fireEvent.click(rowButton('Bekzod Abdullayev'));
    await panel('Bekzod Abdullayev');

    act(() => {
      router.history.back();
    });

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    expect(router.state.location.pathname).toBe(PATH);
  });

  it('opens from an address, and moves to another record of the list', async () => {
    await openList(`${PATH}?open=sample-0003`);

    expect(await panel('Dilshod Abdullayev')).toBeDefined();

    fireEvent.click(rowButton('Farida Abdullayev'));

    expect(await panel('Farida Abdullayev')).toBeDefined();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
  });

  it('gives the focus to the search box when the row of the record is not drawn', async () => {
    // The 150th row: beyond the rows drawn at first.
    await openList(`${PATH}?open=sample-0150`);
    const opened = await panel(ROWS[149]?.name ?? '');

    fireEvent.click(within(opened).getByRole('button', { name: en.list.closePanel }));

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    expect(document.activeElement).toBe(searchBox());
  });

  it('leaves Escape in the search box to the search box', async () => {
    await openList(`${PATH}?open=sample-0003`);
    const opened = await panel('Dilshod Abdullayev');

    fireEvent.keyDown(searchBox(), { key: 'Escape' });
    expect(screen.getByRole('complementary')).toBe(opened);

    // Inside the panel, and anywhere that is not a field, Escape closes it.
    fireEvent.keyDown(within(opened).getByRole('heading'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
  });

  // docs/spec/12-ux-standards.md, Look and feel: the page never jumps as it loads.
  it('has its place while the rows are on the way', async () => {
    await openList(`${PATH}?demo=loading&open=sample-0003`);

    const waiting = await panel(en.app.loading);
    expect(within(waiting).getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('says so when the record of the address is not in the list', async () => {
    await openList(`${PATH}?open=sample-9999`);

    const opened = await panel(en.list.recordGoneTitle);
    expect(within(opened).getByText(en.list.recordGone)).toBeDefined();
  });
});

// docs/spec/12-ux-standards.md, Look and feel: empty pages say what the page
// is for and offer the first action; error messages say what happened and what
// to do next; loading shows the page outline at once.
describe('the states of a list', () => {
  it('shows the outline of the table while the rows are on the way', async () => {
    await openList(`${PATH}?demo=loading`);

    const outline = pageStatus();
    expect(outline.getAttribute('aria-busy')).toBe('true');
    expect(within(outline).getByRole('columnheader', { name: en.sample.name })).toBeDefined();
    expect(within(outline).getAllByRole('row')).toHaveLength(9);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('says what the page is for when the list has no row, with the first action', async () => {
    await openList(`${PATH}?demo=empty`);

    expect(screen.getByText(en.sample.empty)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.sample.showRows }));

    await waitFor(() => {
      expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);
    });
  });

  it('says what happened when the rows could not be loaded, and tries again', async () => {
    await openList(`${PATH}?demo=error`);

    expect(screen.getByRole('alert').textContent).toBe(en.problems.noAnswer);
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.problems.retry }));

    await waitFor(() => {
      expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);
    });
  });
});
