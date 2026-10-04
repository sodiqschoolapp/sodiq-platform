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
  (count === 1 ? en.list.selected_one : en.list.selected_other).replace('{{count}}', String(count));

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
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
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
    expect(router.state.location.search).toEqual({ f: { status: 'archived' } });

    fireEvent.change(screen.getByRole('combobox', { name: en.sample.status }), {
      target: { value: '' },
    });

    expect(await screen.findByText(countText(ROWS_AT_ONCE, ROWS.length))).toBeDefined();
    expect(router.state.location.search).toEqual({});
  });

  it('sorts by a column from the start, then from the end, then not at all', async () => {
    const { router } = await openList();
    const header = () => screen.getByRole('columnheader', { name: en.sample.score });
    const sortButton = () => within(header()).getByRole('button', { name: en.sample.score });
    const scores = ROWS.flatMap((row) => (row.score === null ? [] : [row.score]));
    expect(header().getAttribute('aria-sort')).toBe('none');

    fireEvent.click(sortButton());

    await waitFor(() => {
      expect(header().getAttribute('aria-sort')).toBe('ascending');
    });
    const firstScore = () => document.querySelector('tbody tr td:nth-child(6)')?.textContent;
    expect(firstScore()).toBe(String(Math.min(...scores)));
    expect(router.state.location.search).toEqual({ sort: 'score' });

    fireEvent.click(sortButton());

    await waitFor(() => {
      expect(header().getAttribute('aria-sort')).toBe('descending');
    });
    expect(firstScore()).toBe(String(Math.max(...scores)));

    fireEvent.click(sortButton());

    await waitFor(() => {
      expect(header().getAttribute('aria-sort')).toBe('none');
    });
    expect(drawnNames()[0]).toBe('Aziza Abdullayev');
    expect(router.state.location.search).toEqual({});
  });

  it('does not offer an order for a column that cannot be sorted', async () => {
    await openList();

    const header = screen.getByRole('columnheader', { name: en.sample.status });
    expect(header.getAttribute('aria-sort')).toBeNull();
    expect(within(header).queryByRole('button')).toBeNull();
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
      expect(screen.queryByRole('columnheader', { name: en.sample.score })).toBeNull();
    });
    expect(screen.getByRole('columnheader', { name: en.sample.status })).toBeDefined();
    expect(window.localStorage.getItem('sodiq.list.sample.hidden')).toBe('["score"]');
  });

  it('opens with the columns hidden before', async () => {
    window.localStorage.setItem('sodiq.list.sample.hidden', '["score","name","gone"]');

    await openList();

    expect(screen.queryByRole('columnheader', { name: en.sample.score })).toBeNull();
    // The column that opens the record cannot be hidden, whatever the browser kept.
    expect(screen.getByRole('columnheader', { name: en.sample.name })).toBeDefined();
  });
});

// docs/spec/12-ux-standards.md, Lists: checkboxes with bulk actions. Decided by
// the owner (task 0.8b): "tick all" means every row that matches the search
// and filters.
describe('the checkboxes and bulk actions of a list', () => {
  it('shows no actions while nothing is ticked, and the count when rows are', async () => {
    await openList();
    expect(screen.queryByRole('group', { name: en.list.bulkActions })).toBeNull();

    fireEvent.click(tickRow('Aziza Abdullayev'));
    fireEvent.click(tickRow('Bekzod Abdullayev'));

    const bar = screen.getByRole('group', { name: en.list.bulkActions });
    expect(within(bar).getByRole('status').textContent).toBe(selectedText(2));
    expect(tickAll().indeterminate).toBe(true);

    fireEvent.click(tickRow('Aziza Abdullayev'));
    expect(within(bar).getByRole('status').textContent).toBe(selectedText(1));

    fireEvent.click(within(bar).getByRole('button', { name: en.list.clearSelection }));
    expect(screen.queryByRole('group', { name: en.list.bulkActions })).toBeNull();
    expect(tickRow('Bekzod Abdullayev').checked).toBe(false);
  });

  it('ticks every row that matches the search, and only those', async () => {
    await openList();
    type('ergashev');

    fireEvent.click(tickAll());

    expect(screen.getByRole('status').textContent).toBe(selectedText(20));
    expect(tickAll().checked).toBe(true);

    type('');

    expect(screen.getByRole('status').textContent).toBe(selectedText(20));
    expect(tickAll().checked).toBe(false);
    expect(tickAll().indeterminate).toBe(true);
    expect(tickRow('Aziza Abdullayev').checked).toBe(false);
    expect(tickRow('Aziza Ergashev').checked).toBe(true);
  });

  it('ticks every matching row of a long list, also those not drawn yet', async () => {
    await openList(`${PATH}?demo=many`);
    expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);

    fireEvent.click(tickAll());

    expect(screen.getByRole('status').textContent).toBe(selectedText(2500));

    fireEvent.click(tickAll());

    expect(screen.queryByRole('group', { name: en.list.bulkActions })).toBeNull();
  });

  it('says how many ticked rows the search does not show', async () => {
    await openList();
    fireEvent.click(tickRow('Aziza Abdullayev'));
    fireEvent.click(tickRow('Bekzod Abdullayev'));

    type('bekzod');

    expect(screen.getByRole('status').textContent).toBe(
      `${selectedText(2)} ${en.list.selectedNotShown_one.replace('{{count}}', '1')}`,
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

    expect(screen.getByRole('status').textContent).toBe(
      ru.list.selected_few.replace('{{count}}', '2'),
    );
  });
});

// docs/spec/12-ux-standards.md, Lists: export. The file is made by the server
// (CLAUDE.md: exports follow the role); the list says which rows and columns.
describe('the export of a list', () => {
  it('asks for the rows that match the search and filters', async () => {
    await openList();
    type('ergashev');

    fireEvent.click(screen.getByRole('button', { name: en.list.export }));

    expect(screen.getByRole('status').textContent).toBe(
      en.sample.exported_other.replace('{{count}}', '20'),
    );
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

    fireEvent.click(screen.getByRole('button', { name: 'Bekzod Abdullayev' }));

    const opened = await panel('Bekzod Abdullayev');
    expect(within(opened).getByText('6 Cambridge')).toBeDefined();
    expect(router.state.location.search).toEqual({ open: 'sample-0002' });
    // The list is still there, and its row is marked as the open one.
    expect(drawnNames()).toHaveLength(ROWS_AT_ONCE);
    expect(document.querySelectorAll('tbody tr')[1]?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(
      within(opened).getByRole('heading', { name: 'Bekzod Abdullayev' }),
    );
  });

  it('closes with its button and with Escape, and gives the focus back to the row', async () => {
    const { router } = await openList();
    const row = screen.getByRole('button', { name: 'Bekzod Abdullayev' });

    fireEvent.click(row);
    fireEvent.click(
      within(await panel('Bekzod Abdullayev')).getByRole('button', { name: en.list.closePanel }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    expect(router.state.location.search).toEqual({});
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
    fireEvent.click(screen.getByRole('button', { name: 'Bekzod Abdullayev' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Farida Abdullayev' }));

    expect(await panel('Farida Abdullayev')).toBeDefined();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
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

    const outline = screen.getByRole('status');
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
