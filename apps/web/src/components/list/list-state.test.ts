import { describe, expect, it } from 'vitest';
import {
  ALL_ROWS,
  appliedSearch,
  appliedValue,
  chosenValue,
  OPENS_ON_ACTIVE,
  hideable,
  listSearch,
  shownValue,
  matchingRows,
  nextSort,
  readHiddenColumns,
  searchKey,
  sortOf,
  storeHiddenColumns,
  type Column,
  type Filter,
} from './list-state';

interface Person {
  name: string;
  city: string;
  age: number | null;
}

// Invented.
const PEOPLE: Person[] = [
  { name: 'Oʻgʻiloy Karimova', city: 'Buxoro', age: 31 },
  { name: 'anvar Salimov', city: 'Termiz', age: null },
  { name: 'Zilola Ahmedova', city: 'Buxoro', age: 9 },
  { name: 'Botir Salimov', city: 'Nukus', age: 31 },
  { name: 'Элина Ким', city: 'Termiz', age: 102 },
];

const COLUMNS: Column<Person>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    searchText: (row) => row.name,
    opens: true,
  },
  { key: 'city', header: 'City', cell: (row) => row.city, searchText: (row) => row.city },
  { key: 'age', header: 'Age', cell: (row) => row.age, sortValue: (row) => row.age, fixed: true },
];

const FILTERS: Filter<Person>[] = [
  {
    key: 'city',
    label: 'City',
    options: ['Buxoro', 'Termiz', 'Nukus'].map((city) => ({ value: city, label: city })),
    matches: (row, value) => row.city === value,
  },
];

const names = (search: Parameters<typeof matchingRows>[3], language = 'en') =>
  matchingRows(PEOPLE, COLUMNS, FILTERS, search, language).map((row) => row.name);

// docs/spec/12-ux-standards.md, Navigation: every page has its own address. An
// address can be typed by hand, so everything in it is checked.
describe('the list state of an address', () => {
  it('keeps the search, the order, the filters and the open record', () => {
    expect(
      listSearch({ q: 'ali', sort: '-name', f: { city: 'Nukus' }, open: 'id-1', other: 'x' }),
    ).toEqual({ q: 'ali', sort: '-name', f: { city: 'Nukus' }, open: 'id-1' });
  });

  it('reads a number as the text a person typed', () => {
    expect(listSearch({ q: 2607001, open: 14 })).toEqual({ q: '2607001', open: '14' });
  });

  it('drops what is empty or is not a list state', () => {
    expect(listSearch({ q: '', sort: null, f: ['city'], open: { id: 1 } })).toEqual({});
    expect(listSearch({ f: { city: '', age: true } })).toEqual({});
    expect(listSearch({ f: 'city' })).toEqual({});
  });
});

// docs/spec/12-ux-standards.md, Lists: every list has search.
describe('the search of a list', () => {
  it('finds a row whatever the case of the letters', () => {
    expect(names({ q: 'ANVAR' })).toEqual(['anvar Salimov']);
    expect(names({ q: 'элина' })).toEqual(['Элина Ким']);
  });

  it('needs every typed word, in any column and any order', () => {
    expect(names({ q: 'salimov' })).toEqual(['anvar Salimov', 'Botir Salimov']);
    expect(names({ q: 'nukus salimov' })).toEqual(['Botir Salimov']);
    expect(names({ q: 'salimov buxoro' })).toEqual([]);
  });

  it('finds oʻ and gʻ typed with the apostrophe of the keyboard, and the other way round', () => {
    expect(names({ q: "o'g'iloy" })).toEqual(['Oʻgʻiloy Karimova']);
    expect(names({ q: 'o`g’iloy' })).toEqual(['Oʻgʻiloy Karimova']);
    expect(searchKey('Oʻgʻiloy')).toBe(searchKey("O'G'ILOY"));
    // Answer 18: a Cyrillic spelling finds the Latin one (task 2.4a).
    expect(searchKey('Ўткир')).toBe(searchKey('Oʻtkir'));
  });

  it('does not look into a column that is not searched', () => {
    expect(names({ q: '31' })).toEqual([]);
  });

  it('shows every row for a search of spaces', () => {
    expect(names({ q: '   ' })).toHaveLength(PEOPLE.length);
  });
});

describe('the filters of a list', () => {
  it('keep the rows of the chosen value', () => {
    expect(names({ f: { city: 'Termiz' } })).toEqual(['anvar Salimov', 'Элина Ким']);
  });

  it('work together with the search', () => {
    expect(names({ q: 'salimov', f: { city: 'Termiz' } })).toEqual(['anvar Salimov']);
  });

  it('pass over a filter the list does not have and a value it does not offer', () => {
    expect(names({ f: { country: 'x' } })).toHaveLength(PEOPLE.length);
    expect(names({ f: { city: 'Samarqand' } })).toHaveLength(PEOPLE.length);
  });
});

// docs/spec/12-ux-standards.md, Lists: sorting.
describe('the order of a list', () => {
  it('is the order the rows came in when nothing is sorted', () => {
    expect(names({})).toEqual(PEOPLE.map((row) => row.name));
  });

  it('sorts texts by the alphabet, whatever the case', () => {
    expect(names({ sort: 'name' })).toEqual([
      'anvar Salimov',
      'Botir Salimov',
      'Oʻgʻiloy Karimova',
      'Zilola Ahmedova',
      'Элина Ким',
    ]);
    expect(names({ sort: '-name' })[0]).toBe('Элина Ким');
  });

  it('sorts numbers as numbers, and keeps rows that sort alike in their order', () => {
    expect(names({ sort: 'age' })).toEqual([
      'Zilola Ahmedova',
      'Oʻgʻiloy Karimova',
      'Botir Salimov',
      'Элина Ким',
      'anvar Salimov',
    ]);
  });

  it('puts a row without a value last in both directions', () => {
    expect(names({ sort: '-age' })).toEqual([
      'Элина Ким',
      'Oʻgʻiloy Karimova',
      'Botir Salimov',
      'Zilola Ahmedova',
      'anvar Salimov',
    ]);
  });

  it('passes over a column that does not exist or cannot be sorted', () => {
    expect(names({ sort: 'nothing' })).toEqual(PEOPLE.map((row) => row.name));
    expect(names({ sort: 'city' })).toEqual(PEOPLE.map((row) => row.name));
  });

  it('goes from the start, then from the end, then back to the order of the list', () => {
    expect(nextSort(null, 'name')).toBe('name');
    expect(nextSort(sortOf({ sort: 'name' }), 'name')).toBe('-name');
    expect(nextSort(sortOf({ sort: '-name' }), 'name')).toBeUndefined();
    expect(nextSort(sortOf({ sort: '-name' }), 'age')).toBe('age');
  });
});

// docs/spec/12-ux-standards.md, Lists: column chooser.
describe('the hidden columns of a list', () => {
  it('can be every column but the one that opens the record and a fixed one', () => {
    expect(hideable(COLUMNS).map((column) => column.key)).toEqual(['city']);
  });

  it('are remembered by the browser, per list', () => {
    storeHiddenColumns('people', ['city']);

    expect(readHiddenColumns('people')).toEqual(['city']);
    expect(readHiddenColumns('rooms')).toEqual([]);
  });

  it('are none when what the browser kept cannot be read', () => {
    window.localStorage.setItem('sodiq.list.people.hidden', '{not json');
    expect(readHiddenColumns('people')).toEqual([]);

    window.localStorage.setItem('sodiq.list.people.hidden', '{"city":true}');
    expect(readHiddenColumns('people')).toEqual([]);
  });

  // Task 10.7: the journal hides its figures in a browser with no choice of its own.
  it('are the default of the list when the browser holds no choice, and the stored choice otherwise', () => {
    expect(readHiddenColumns('journal', ['uid', 'grade'])).toEqual(['uid', 'grade']);

    storeHiddenColumns('journal', []);
    expect(readHiddenColumns('journal', ['uid', 'grade'])).toEqual([]);

    storeHiddenColumns('journal', ['grade']);
    expect(readHiddenColumns('journal', ['uid', 'grade'])).toEqual(['grade']);

    window.localStorage.setItem('sodiq.list.journal.hidden', '{not json');
    expect(readHiddenColumns('journal', ['uid'])).toEqual(['uid']);
    window.localStorage.setItem('sodiq.list.journal.hidden', '{"uid":true}');
    expect(readHiddenColumns('journal', ['uid'])).toEqual(['uid']);
  });
});

interface Kept {
  name: string;
  archived: boolean;
}

// Invented.
const KEPT: Kept[] = [
  { name: 'Algebra', archived: false },
  { name: 'Drawing', archived: true },
  { name: 'Geometry', archived: false },
];

const KEPT_COLUMNS: Column<Kept>[] = [
  { key: 'name', header: 'Name', cell: (row) => row.name, searchText: (row) => row.name },
];

const STATE: Filter<Kept> = {
  key: 'state',
  label: 'State',
  options: [
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
  ],
  matches: (row, value) => (value === 'archived') === row.archived,
  ...OPENS_ON_ACTIVE,
};

const keptNames = (search: Parameters<typeof matchingRows>[3]) =>
  matchingRows(KEPT, KEPT_COLUMNS, [STATE], search, 'en').map((row) => row.name);

// Owner, 28 November 2026: archived records are not in the active list; they
// are one click away, and the choice is kept in the address.
describe('a filter with a default value', () => {
  it('applies its default while the address names none', () => {
    expect(keptNames({})).toEqual(['Algebra', 'Geometry']);
    expect(appliedValue(STATE, {})).toBe('active');
    expect(shownValue(STATE, {})).toBe('active');
  });

  it('keeps an address that names a value, as links have always written it', () => {
    expect(keptNames({ f: { state: 'archived' } })).toEqual(['Drawing']);
    expect(keptNames({ f: { state: 'active' } })).toEqual(['Algebra', 'Geometry']);
  });

  it('shows every row for "All", which the address holds apart from nothing chosen', () => {
    expect(keptNames({ f: { state: ALL_ROWS } })).toEqual(['Algebra', 'Drawing', 'Geometry']);
    expect(appliedValue(STATE, { f: { state: ALL_ROWS } })).toBeUndefined();
    expect(shownValue(STATE, { f: { state: ALL_ROWS } })).toBe('');
    expect(listSearch({ f: { state: ALL_ROWS } })).toEqual({ f: { state: ALL_ROWS } });
  });

  it('passes over a value it does not offer, as before', () => {
    expect(keptNames({ f: { state: 'gone' } })).toEqual(['Algebra', 'Drawing', 'Geometry']);
  });

  it('writes "All" as a value of its own and its default as nothing', () => {
    expect(chosenValue(STATE, '')).toBe(ALL_ROWS);
    expect(chosenValue(STATE, 'active')).toBeUndefined();
    expect(chosenValue(STATE, 'archived')).toBe('archived');
    // A filter without a default: "All" is nothing chosen, as before.
    const city = FILTERS[0];
    if (city === undefined) throw new Error('No filter.');
    expect(chosenValue(city, '')).toBeUndefined();
    expect(chosenValue(city, 'Nukus')).toBe('Nukus');
  });

  it('is named in the search an export records as it chose the rows', () => {
    expect(appliedSearch([STATE], { q: 'a' })).toEqual({ q: 'a', f: { state: 'active' } });
    expect(appliedSearch([STATE], { f: { state: ALL_ROWS } })).toEqual({});
    expect(appliedSearch([STATE], { f: { state: 'archived', other: 'x' } })).toEqual({
      f: { state: 'archived', other: 'x' },
    });
    // A filter without a default is recorded as before.
    expect(appliedSearch(FILTERS, { f: { city: 'Nukus' } })).toEqual({ f: { city: 'Nukus' } });
    expect(appliedSearch(FILTERS, {})).toEqual({});
  });
});
