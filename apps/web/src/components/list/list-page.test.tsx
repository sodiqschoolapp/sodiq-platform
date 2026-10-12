import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '@/api/failure';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { ListPage, type BulkAction, type ExportState } from './list-page';
import type { Column, ListSearch } from './list-state';

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
  onExport?: (rows: Room[], columnKeys: string[], search: ListSearch) => void;
  exportState?: ExportState;
  actions?: BulkAction<Room>[];
  panel?: (row: Room) => React.ReactNode;
}

/** A list whose address is a piece of state. */
function Harness({ rows, error, start = {}, onExport, exportState, actions, panel }: HarnessProps) {
  const [search, setSearch] = useState(start);
  return (
    <ListPage
      listId="rooms"
      caption="Rooms"
      rows={rows}
      error={error}
      rowId={(row) => row.id}
      rowName={(row) => row.name}
      columns={COLUMNS}
      search={search}
      onSearchChange={setSearch}
      empty={{ text: 'Rooms are listed here.' }}
      bulkActions={actions ?? [{ key: 'close', label: 'Close the rooms', run: () => undefined }]}
      onExport={onExport}
      exportState={exportState}
      panel={panel}
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

const status = () =>
  within(screen.getByRole('group', { name: en.list.bulkActions })).getByRole('status');

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
    const onExport = vi.fn<(rows: Room[], columnKeys: string[], search: ListSearch) => void>();
    show({ rows: ROOMS, start: { q: 'room', sort: 'name' }, onExport });
    expect(names()).toEqual(['Room 4', 'Room 12']);

    fireEvent.click(screen.getByRole('button', { name: en.list.export }));

    expect(onExport).toHaveBeenCalledExactlyOnceWith([ROOMS[1], ROOMS[0]], ['name'], {
      q: 'room',
      sort: 'name',
    });
  });

  // `04`, Student record: "Bulk actions on ticked rows: ... export".
  it('is the ticked rows when some are ticked, those the search hides too, and names their count', () => {
    const onExport = vi.fn<(rows: Room[], columnKeys: string[], search: ListSearch) => void>();
    show({ rows: ROOMS, start: { sort: 'name' }, onExport });
    fireEvent.click(tick('Room 12'));
    fireEvent.click(tick('Laboratory'));
    fireEvent.change(screen.getByRole('searchbox', { name: en.list.search }), {
      target: { value: 'room' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: en.list.exportTicked_other.replace('{{n}}', '2') }),
    );

    expect(onExport).toHaveBeenCalledExactlyOnceWith([ROOMS[0], ROOMS[2]], ['name', 'seats'], {
      q: 'room',
      sort: 'name',
    });
  });

  it('is off while no row matches and while a file is being made', () => {
    const onExport = vi.fn<(rows: Room[], columnKeys: string[], search: ListSearch) => void>();
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
