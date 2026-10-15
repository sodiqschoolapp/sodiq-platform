import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '@/api/failure';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { CHECKBOX_TARGET } from '@/components/ui/control';
import { setWindowWidth } from '@/testing/window-width';
import {
  ListPage,
  ROWS_AT_ONCE,
  type BulkAction,
  type ExportExtra,
  type ExportState,
  type NewRecord,
} from './list-page';
import type { Column, Filter, ListSearch } from './list-state';

// What the sample list cannot show: rows that change under the list, a failed
// later load, and what exactly the export and a bulk action are handed.

interface Room {
  id: string;
  name: string;
  seats: number;
}

// Invented.
const ROOMS: Room[] = [
  { id: 'r1', name: 'Room 12', seats: 30 },
  { id: 'r2', name: 'Room 4', seats: 18 },
  { id: 'r3', name: 'Laboratory', seats: 24 },
];

const COLUMNS: Column<Room>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    searchText: (row) => row.name,
    opens: true,
  },
  { key: 'seats', header: 'Seats', cell: (row) => row.seats, sortValue: (row) => row.seats },
];

interface HarnessProps {
  rows: readonly Room[] | undefined;
  error?: unknown;
  start?: ListSearch;
  onExport?: (
    rows: Room[],
    columnKeys: string[],
    search: ListSearch,
    selection: 'ticked' | 'matching',
  ) => void;
  exportState?: ExportState;
  exportExtras?: ExportExtra[];
  actions?: BulkAction<Room>[];
  panel?: (row: Room) => React.ReactNode;
  more?: { onMore: () => void; loading: boolean };
  columns?: Column<Room>[];
  creating?: NewRecord;
  onOpenRow?: (row: Room) => void;
  view?: (shown: {
    rows: readonly Room[];
    sorted: boolean;
    open: (id: string) => void;
  }) => React.ReactNode;
  /** Sees every address the list writes. */
  onAddress?: (search: ListSearch) => void;
  filters?: Filter<Room>[];
}

/** A list whose address is a piece of state. */
function Harness({
  rows,
  error,
  start = {},
  onExport,
  exportState,
  exportExtras,
  actions,
  panel,
  more,
  columns = COLUMNS,
  creating,
  onOpenRow,
  view,
  onAddress,
  filters,
}: HarnessProps) {
  const [search, setSearch] = useState(start);
  return (
    <ListPage
      listId="rooms"
      caption="Rooms"
      rows={rows}
      error={error}
      rowId={(row) => row.id}
      rowName={(row) => row.name}
      columns={columns}
      filters={filters}
      search={search}
      onSearchChange={(next) => {
        onAddress?.(next);
        setSearch(next);
      }}
      empty={{ title: 'No rooms yet', text: 'Rooms are listed here.' }}
      bulkActions={actions ?? [{ key: 'close', label: 'Close the rooms', run: () => undefined }]}
      onExport={onExport}
      exportState={exportState}
      exportExtras={exportExtras}
      panel={panel}
      creating={creating}
      onOpenRow={onOpenRow}
      view={view}
      more={more}
    />
  );
}

const i18n = createI18n('en');

const show = (props: HarnessProps) =>
  render(
    <I18nextProvider i18n={i18n}>
      <Harness {...props} />
    </I18nextProvider>,
  );

const selected = (count: number): string =>
  (count === 1 ? en.list.selected_one : en.list.selected_other).replace('{{n}}', String(count));

/** The one live region of the selection, read from that element (task 2.7b-2, finding 13). */
const status = (): HTMLElement => {
  const found = screen
    .getAllByRole('status')
    .filter((one) => one.dataset.slot === 'selection-status');
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
};

const tick = (name: string) =>
  screen.getByLabelText<HTMLInputElement>(en.list.selectRow.replace('{{name}}', name));

const names = (): string[] =>
  [...document.querySelectorAll('tbody tr')].map(
    (row) => row.querySelector('td:nth-child(2)')?.textContent ?? '',
  );

// docs/spec/12-ux-standards.md, Lists: checkboxes with bulk actions.
describe('ticked rows of a list whose rows change', () => {
  it('are no longer ticked once they left the list, and a bulk action is not given them', () => {
    const run = vi.fn<(rows: Room[]) => void>();
    const actions = [{ key: 'close', label: 'Close the rooms', run }];
    const { rerender } = show({ rows: ROOMS, actions });
    fireEvent.click(tick('Room 12'));
    fireEvent.click(tick('Room 4'));
    expect(status().textContent).toBe(selected(2));

    // Room 4 was archived by somebody else and the list was loaded again.
    rerender(
      <I18nextProvider i18n={i18n}>
        <Harness rows={ROOMS.filter((room) => room.id !== 'r2')} actions={actions} />
      </I18nextProvider>,
    );

    expect(status().textContent).toBe(selected(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close the rooms' }));
    expect(run).toHaveBeenCalledExactlyOnceWith([ROOMS[0]]);
  });
});

// docs/spec/12-ux-standards.md, Lists: export. CLAUDE.md: exports follow the
// role, so the server makes the file; the list says which rows, in which
// order, and which columns.
describe('what the export of a list is handed', () => {
  it('is the matching rows in the order shown, and the keys of the columns shown', () => {
    window.localStorage.setItem('sodiq.list.rooms.hidden', '["seats"]');
    const onExport =
      vi.fn<
        (
          rows: Room[],
          columnKeys: string[],
          search: ListSearch,
          selection: 'ticked' | 'matching',
        ) => void
      >();
    show({ rows: ROOMS, start: { q: 'room', sort: 'name' }, onExport });
    expect(names()).toEqual(['Room 4', 'Room 12']);

    fireEvent.click(screen.getByRole('button', { name: en.list.export }));

    expect(onExport).toHaveBeenCalledExactlyOnceWith(
      [ROOMS[1], ROOMS[0]],
      ['name'],
      { q: 'room', sort: 'name' },
      'matching',
    );
  });

  // `04`, Student record: "Bulk actions on ticked rows: ... export".
  it('is the ticked rows when some are ticked, those the search hides too, and names their count', () => {
    const onExport =
      vi.fn<
        (
          rows: Room[],
          columnKeys: string[],
          search: ListSearch,
          selection: 'ticked' | 'matching',
        ) => void
      >();
    show({ rows: ROOMS, start: { sort: 'name' }, onExport });
    fireEvent.click(tick('Room 12'));
    fireEvent.click(tick('Laboratory'));
    fireEvent.change(screen.getByRole('searchbox', { name: en.list.search }), {
      target: { value: 'room' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: en.list.exportTicked_other.replace('{{n}}', '2') }),
    );

    expect(onExport).toHaveBeenCalledExactlyOnceWith(
      [ROOMS[0], ROOMS[2]],
      ['name', 'seats'],
      {
        q: 'room',
        sort: 'name',
      },
      'ticked',
    );
  });

  it('is off while no row matches and while a file is being made', () => {
    const onExport =
      vi.fn<
        (
          rows: Room[],
          columnKeys: string[],
          search: ListSearch,
          selection: 'ticked' | 'matching',
        ) => void
      >();
    const { unmount } = show({ rows: ROOMS, start: { q: 'nothing like this' }, onExport });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.list.export }).disabled).toBe(
      true,
    );
    unmount();

    show({ rows: ROOMS, onExport, exportState: { pending: true, error: null, leftOut: [] } });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: en.list.exporting }).disabled,
    ).toBe(true);
  });

  it('shows a failed export, and names the columns the server left out by their headers', () => {
    show({
      rows: ROOMS,
      onExport: () => undefined,
      exportState: {
        pending: false,
        error: new ApiFailure('permission_denied'),
        leftOut: ['seats'],
      },
    });

    expect(screen.getByRole('alert').textContent).toBe(en.errors.permission_denied);
    expect(
      screen.getByText(en.list.exportColumnsLeftOut.replace('{{columns}}', 'Seats')),
    ).toBeTruthy();
  });
});

// docs/spec/12-ux-standards.md, Look and feel: error messages say what
// happened and what to do next.
describe('a list whose load failed', () => {
  it('shows the failure in place of the table when it has no rows', () => {
    show({ rows: undefined, error: new ApiFailure('no_answer') });

    expect(screen.getByRole('alert').textContent).toBe(en.problems.noAnswer);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps the rows it has when a later load failed, and says so above them', () => {
    show({ rows: ROOMS, error: new ApiFailure('no_answer') });

    expect(screen.getByRole('alert').textContent).toBe(en.problems.noAnswer);
    expect(names()).toEqual(ROOMS.map((room) => room.name));
  });
});

// 0.8b-1 left open, settled in 2.2a: a record that leaves the list while its
// panel is open (archived by somebody else, a reload) keeps what was typed.
describe('a record that leaves the list while it is open', () => {
  it('stays in the panel with a note, and what was typed stays', () => {
    const panel = (row: Room) => <input aria-label={`Note on ${row.name}`} defaultValue="" />;
    const view = render(
      <I18nextProvider i18n={i18n}>
        <Harness rows={ROOMS} start={{ open: 'r2' }} panel={panel} />
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText('Note on Room 4'), { target: { value: 'typed' } });

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <Harness
          rows={ROOMS.filter((room) => room.id !== 'r2')}
          start={{ open: 'r2' }}
          panel={panel}
        />
      </I18nextProvider>,
    );

    expect(screen.getByLabelText<HTMLInputElement>('Note on Room 4').value).toBe('typed');
    expect(screen.getByText(en.list.recordLeft)).toBeDefined();
  });
});

// Task 2.4b-2, pull request #70: groups of export-only columns, off until ticked.
describe('the export-only columns of a list', () => {
  const EXTRAS: ExportExtra[] = [
    { key: 'contact', label: 'Phone and email', columns: [{ key: 'phone', header: 'Phone' }] },
    {
      key: 'identity',
      label: 'Documents',
      columns: [
        { key: 'document', header: 'Document' },
        { key: 'address', header: 'Address' },
      ],
    },
  ];

  it('adds the columns of the groups ticked after the columns shown, in the order of the groups', async () => {
    window.localStorage.removeItem('sodiq.list.rooms.hidden');
    const onExport = vi.fn<(rows: Room[], columnKeys: string[]) => void>();
    show({ rows: ROOMS, onExport, exportExtras: EXTRAS });
    fireEvent.click(screen.getByRole('button', { name: en.list.exportAlso }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Documents' }));
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Phone and email' }));
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(
      screen.getByRole('button', {
        name: en.list.exportAlsoChosen_other.replace('{{n}}', '2'),
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.list.export }));
    expect(onExport.mock.calls[0]?.[1]).toEqual(['name', 'seats', 'phone', 'document', 'address']);
  });

  it('names a left-out export-only column by its words, never its key', () => {
    show({
      rows: ROOMS,
      onExport: () => undefined,
      exportState: { pending: false, error: null, leftOut: ['seats', 'address'] },
      exportExtras: EXTRAS,
    });
    expect(
      screen.getByText(en.list.exportColumnsLeftOut.replace('{{columns}}', 'Seats, Address')),
    ).toBeTruthy();
  });

  it('draws no "Also export" without groups', () => {
    show({ rows: ROOMS, onExport: () => undefined });
    expect(screen.queryByRole('button', { name: en.list.exportAlso })).toBeNull();
  });
});

// Task 2.6a: a list whose rows come from the server a page at a time.
describe('a list with server paging', () => {
  it('asks for the next page, and says so while it comes', () => {
    const onMore = vi.fn();
    const { rerender } = show({ rows: ROOMS, more: { onMore, loading: false } });
    fireEvent.click(screen.getByRole('button', { name: en.list.loadMore }));
    expect(onMore).toHaveBeenCalledTimes(1);
    rerender(
      <I18nextProvider i18n={i18n}>
        <Harness rows={ROOMS} more={{ onMore, loading: true }} />
      </I18nextProvider>,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.app.loading }).disabled).toBe(
      true,
    );
  });

  it('offers no next page without one', () => {
    show({ rows: ROOMS });
    expect(screen.queryByRole('button', { name: en.list.loadMore })).toBeNull();
  });
});

// Issue #39, hand test of 13 October 2026, finding 13 (task 2.7b-2): the bar
// of the bulk actions only once a row is ticked.
describe('the bar of the bulk actions', () => {
  it('is not there with nothing ticked, comes with a tick and goes with "Clear selection"', () => {
    show({ rows: ROOMS });
    const bar = () => screen.queryByRole('group', { name: en.list.bulkActions });
    expect(bar()).toBeNull();
    expect(status().textContent).toBe('');

    fireEvent.click(tick('Room 12'));
    expect(bar()).not.toBeNull();
    expect(status().textContent).toBe(selected(1));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Close the rooms' }).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: en.list.clearSelection }));
    expect(bar()).toBeNull();
    expect(status().textContent).toBe('');
  });
});

// docs/design-system.md, Accessibility: "touch targets of 44 px at phone
// width" (task 2.7c-2a, pull request #81, decision 8).
describe('the checkboxes of a list', () => {
  it('sit in a label that is the 44 px target at phone width, and a press on it ticks the row', () => {
    show({ rows: ROOMS });
    const all = screen.getByLabelText(en.list.selectAll);
    for (const box of [all, tick('Room 12')]) {
      expect(box.closest('label')?.className.split(' ')).toEqual(
        expect.arrayContaining(CHECKBOX_TARGET.split(' ')),
      );
    }
    fireEvent.click(tick('Room 4').closest('label') as HTMLElement);
    expect(tick('Room 4').checked).toBe(true);
  });
});

// Issue #39, finding 14, and the owner's confirmation of 13 October 2026:
// "tables that hide less important columns first" (task 2.7b-2, decision 3).
describe('the narrow columns of a list', () => {
  const WITH_FLOOR: Column<Room>[] = [
    ...COLUMNS,
    { key: 'floor', header: 'Floor', cell: () => 'Ground floor', narrow: true },
  ];
  const headers = (): string[] =>
    [...document.querySelectorAll('thead th')].map((cell) => cell.textContent);

  it('are left out of the table below 1280 px, unticked in the chooser and kept in the export', async () => {
    setWindowWidth(1047);
    const onExport = vi.fn<(rows: Room[], columnKeys: string[]) => void>();
    show({ rows: ROOMS, columns: WITH_FLOOR, onExport });

    expect(headers()).not.toContain('Floor');
    expect(headers()).toContain('Seats');

    fireEvent.click(screen.getByRole('button', { name: en.list.export }));
    expect(onExport.mock.calls[0]?.[1]).toEqual(['name', 'seats', 'floor']);

    fireEvent.click(screen.getByRole('button', { name: en.list.columns }));
    const floor = await screen.findByRole('menuitemcheckbox', { name: 'Floor' });
    expect(floor.getAttribute('aria-checked')).toBe('false');

    // Ticked in the chooser: shown at this width, and kept for the next visit.
    fireEvent.click(floor);
    expect(headers()).toContain('Floor');
    expect(window.localStorage.getItem('sodiq.list.rooms.shown')).toBe('["floor"]');
  });

  it('are left out of the outline while the rows are on the way', () => {
    setWindowWidth(1047);
    show({ rows: undefined, columns: WITH_FLOOR });
    expect(headers()).toContain('Seats');
    expect(headers()).not.toContain('Floor');
  });

  it('are drawn from 1280 px', () => {
    setWindowWidth(1280);
    show({ rows: ROOMS, columns: WITH_FLOOR });
    expect(headers()).toContain('Floor');
  });

  it('stay hidden at every width once the person hid them', () => {
    window.localStorage.setItem('sodiq.list.rooms.hidden', '["floor"]');
    setWindowWidth(1440);
    show({ rows: ROOMS, columns: WITH_FLOOR });
    expect(headers()).not.toContain('Floor');
  });
});

// Task 2.7c-2a (pull request #81): a new record in the side panel, in the
// place of an opened record. The prompts and Back need the whole app: they
// are tested on the buildings page (buildings-page.test.tsx).
describe('a new record in the side panel', () => {
  const newRecord = (onSaved = vi.fn(), id?: string): NewRecord => ({
    key: 'room',
    title: 'New room',
    content: ({ saved }) => (
      <button
        type="button"
        onClick={() => {
          saved(id);
        }}
      >
        Done
      </button>
    ),
    onClose: vi.fn(),
    onReplaced: vi.fn(),
    onSaved,
  });

  it('takes the place of an opened record and of the list on a narrow screen', () => {
    show({ rows: ROOMS, panel: (row) => row.name, creating: newRecord() });
    expect(screen.getByRole('complementary', { name: 'New room' })).toBeDefined();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    const list = screen.getByRole('table', { name: 'Rooms' }).closest('[class*="lg:grid"]');
    expect(list?.className).toContain('hidden lg:grid');
  });

  it('writes the saved record into the address with what is typed in the search box', () => {
    const addresses: ListSearch[] = [];
    const onSaved = vi.fn();
    show({
      rows: ROOMS,
      panel: (row) => row.name,
      creating: newRecord(onSaved, 'r2'),
      onAddress: (next) => {
        addresses.push(next);
      },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: en.list.search }), {
      target: { value: 'Room' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(addresses.at(-1)).toEqual({ q: 'Room', open: 'r2' });
  });

  it('draws nothing without a panel for the records', () => {
    show({ rows: ROOMS, creating: newRecord() });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  // Task 2.7c-3 (the Branches list, decision 4): a list whose rows open elsewhere.
  it('is drawn for a list whose rows open elsewhere, and hands the saved id to the page without an address', () => {
    const addresses: ListSearch[] = [];
    const onSaved = vi.fn();
    show({
      rows: ROOMS,
      onOpenRow: vi.fn(),
      creating: newRecord(onSaved, 'r2'),
      onAddress: (next) => {
        addresses.push(next);
      },
    });
    expect(screen.getByRole('complementary', { name: 'New room' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledWith('r2');
    expect(addresses).toEqual([]);
  });
});

// Task 2.7c-3, decision 4: the Branches list opens a branch by switching to it.
describe('a list whose rows open elsewhere', () => {
  it('opens a row through the shared open button and writes no record into the address', async () => {
    const addresses: ListSearch[] = [];
    const onOpenRow = vi.fn();
    show({
      rows: ROOMS,
      onOpenRow,
      onAddress: (next) => {
        addresses.push(next);
      },
    });
    const button = screen.getByRole('button', { name: 'Room 4' });
    expect(button.closest('td')).not.toBeNull();
    fireEvent.click(button);
    await waitFor(() => {
      expect(onOpenRow).toHaveBeenCalledWith(ROOMS[1]);
    });
    expect(addresses).toEqual([]);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

// Task 2.7c-3, decision 8: another view of the same rows (Rooms "By floor").
describe('another view of the rows', () => {
  const cards = ({
    rows,
    sorted,
    open,
  }: {
    rows: readonly Room[];
    sorted: boolean;
    open: (id: string) => void;
  }) => (
    <ul aria-label="Cards" data-sorted={String(sorted)}>
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => {
              open(row.id);
            }}
          >
            {`Card ${row.name}`}
          </button>
        </li>
      ))}
    </ul>
  );
  const cardNames = () =>
    within(screen.getByRole('list', { name: 'Cards' }))
      .getAllByRole('button')
      .map((one) => one.textContent);

  it('gets every row the search leaves, past the rows drawn at once, in the order the list chose', () => {
    const many = Array.from({ length: ROWS_AT_ONCE + 20 }, (_, index) => ({
      id: `m${String(index)}`,
      name: `Room ${String(index).padStart(3, '0')}`,
      seats: index,
    }));
    show({ rows: many, view: cards, start: { sort: '-seats', q: 'Room' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(cardNames()).toHaveLength(ROWS_AT_ONCE + 20);
    expect(cardNames()[0]).toBe(`Card Room ${String(ROWS_AT_ONCE + 19).padStart(3, '0')}`);
    expect(screen.getByRole('list', { name: 'Cards' }).dataset.sorted).toBe('true');
    expect(screen.queryByRole('button', { name: en.list.showMore })).toBeNull();
  });

  it('hands the rows in their own order when the list chose none, and narrows them with the search', () => {
    show({ rows: ROOMS, view: cards });
    expect(screen.getByRole('list', { name: 'Cards' }).dataset.sorted).toBe('false');
    expect(cardNames()).toEqual(['Card Room 12', 'Card Room 4', 'Card Laboratory']);
    fireEvent.change(screen.getByRole('searchbox', { name: en.list.search }), {
      target: { value: 'Lab' },
    });
    expect(cardNames()).toEqual(['Card Laboratory']);
  });

  it('opens a row in the side panel as the table does', () => {
    const addresses: ListSearch[] = [];
    show({
      rows: ROOMS,
      view: cards,
      panel: (row) => `Panel of ${row.name}`,
      onAddress: (next) => {
        addresses.push(next);
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Card Room 4' }));
    expect(addresses.at(-1)).toEqual({ open: 'r2' });
    expect(screen.getByRole('complementary', { name: 'Room 4' }).textContent).toContain(
      'Panel of Room 4',
    );
  });

  it('has no checkboxes, and rows ticked in the table are cleared when it is shown', () => {
    const exported = vi.fn();
    function Switching() {
      const [cardsShown, setCardsShown] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setCardsShown((before) => !before);
            }}
          >
            Switch
          </button>
          <Harness rows={ROOMS} onExport={exported} view={cardsShown ? cards : undefined} />
        </>
      );
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Switching />
      </I18nextProvider>,
    );
    fireEvent.click(tick('Room 4'));
    expect(status().textContent).toBe(selected(1));
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.list.export }));
    expect(exported.mock.calls[0]?.[3]).toBe('matching');
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(tick('Room 4').checked).toBe(false);
  });
});

// Issue #105, H1: the footer counts in words, the short form without a
// search or a filter.
describe('the count under a list', () => {
  it('says "Shown: 3 of 3" when nothing is left out', () => {
    show({ rows: ROOMS });
    expect(screen.getByText('Shown: 3 of 3')).toBeDefined();
  });

  it('names what matches when a search leaves rows out', () => {
    show({ rows: ROOMS, start: { q: 'Room' } });
    expect(screen.getByText('Shown: 2. Matching: 2. In the list: 3.')).toBeDefined();
  });
});

// Issue #105, H17: below 640 px two or more filters fold behind one button
// with the number in use; search stays visible.
describe('the filters of a list at phone width', () => {
  const FILTERS: Filter<Room>[] = [
    {
      key: 'size',
      label: 'Size',
      options: [
        { value: 'big', label: 'Big' },
        { value: 'small', label: 'Small' },
      ],
      matches: (row, value) => (value === 'big') === row.seats >= 24,
    },
    {
      key: 'kind',
      label: 'Kind',
      options: [{ value: 'lab', label: 'Laboratory' }],
      matches: (row) => row.name === 'Laboratory',
    },
  ];
  const sizeField = () => screen.queryByLabelText<HTMLSelectElement>('Size');

  it('folds them behind "Filters" with the number in use, and opens them', () => {
    setWindowWidth(375);
    show({ rows: ROOMS, filters: FILTERS, start: { f: { size: 'big' } } });
    expect(screen.getByLabelText(en.list.search)).toBeDefined();
    const button = screen.getByRole('button', { name: 'Filters · 1' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(sizeField()?.closest('[hidden]')).not.toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(sizeField()?.closest('[hidden]')).toBeNull();
    expect(sizeField()?.value).toBe('big');
  });

  it('says "Filters" with none in use', () => {
    setWindowWidth(375);
    show({ rows: ROOMS, filters: FILTERS });
    expect(screen.getByRole('button', { name: en.list.filters })).toBeDefined();
  });

  it('keeps one filter, and every filter at desktop width, in the toolbar', () => {
    setWindowWidth(375);
    const one = show({ rows: ROOMS, filters: FILTERS.slice(0, 1) });
    expect(screen.queryByRole('button', { name: en.list.filters })).toBeNull();
    expect(sizeField()?.closest('[hidden]')).toBeNull();
    one.unmount();
    setWindowWidth(1440);
    show({ rows: ROOMS, filters: FILTERS });
    expect(screen.queryByRole('button', { name: en.list.filters })).toBeNull();
    expect(sizeField()?.closest('[hidden]')).toBeNull();
  });
});
