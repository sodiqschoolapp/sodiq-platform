// @vitest-environment node
import { GRADES } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { buildMap } from './build';
import type { Walk } from './walk';

// Task 11.19, plan test 1 (build plan, Done when: "a walk test fails when a page, tab, button,
// field or column of the app is missing from the map or has no description"): each fault the
// map's test names, on a walk of one page and two controls.

const walk: Walk = {
  pages: [
    {
      path: '/setup/rooms',
      file: 'features/setup/rooms-page.tsx',
      guard: { area: 'rooms', action: 'view' },
      params: [],
      search: { open: { kind: 'string' }, odd: { kind: 'string' } },
      titleKey: 'rooms.title',
      files: ['features/setup/rooms-page.tsx'],
    },
  ],
  shellFiles: [],
  controls: [
    {
      id: 'features/setup/rooms-page.tsx#button:rooms.add',
      kind: 'button',
      file: 'features/setup/rooms-page.tsx',
      keys: ['rooms.add'],
      parent: null,
      shownWith: [{ area: 'rooms', action: 'create' }],
      calls: ['POST /api/setup/rooms'],
      opens: null,
      line: 10,
    },
    {
      id: 'features/setup/rooms-page.tsx#button:rooms.missing',
      kind: 'button',
      file: 'features/setup/rooms-page.tsx',
      keys: ['rooms.missing'],
      parent: null,
      shownWith: [],
      calls: [],
      opens: null,
      line: 11,
    },
  ],
  calls: { 'features/setup/rooms-page.tsx': ['POST /api/setup/rooms'] },
  filters: {},
  componentFilesWithControls: [],
  problems: [],
};

const texts = (language: string) => ({
  rooms: { title: `Rooms ${language}`, add: `Add ${language}` },
});

const inputs = {
  walk,
  locales: { uz: texts('uz'), ru: texts('ru'), en: texts('en') },
  openapi: { paths: { '/api/setup/rooms': { post: { operationId: 'RoomsController_create' } } } },
  commonActions: {},
  shownWith: {},
  calls: {},
};

const problemsOf = (descriptions: Record<string, string>) =>
  buildMap({ ...inputs, descriptions }).problems.map((one) => one.problem);

describe('the build of the map', () => {
  const all = {
    'page:/setup/rooms': 'Lists the rooms.',
    'features/setup/rooms-page.tsx#button:rooms.add': 'Adds a room.',
    'features/setup/rooms-page.tsx#button:rooms.missing': 'Does nothing.',
  };

  it('names a control with no description, and a description of no control', () => {
    const rest = Object.fromEntries(
      Object.entries(all).filter(([id]) => id !== 'features/setup/rooms-page.tsx#button:rooms.add'),
    );
    expect(problemsOf({ ...rest, 'features/gone.tsx#button:x': 'Gone.' })).toEqual(
      expect.arrayContaining([
        'features/setup/rooms-page.tsx#button:rooms.add has no description',
        'The description of features/gone.tsx#button:x names no node of the map',
      ]),
    );
  });

  it('names a label key without a text in every language, and a search key of no kind', () => {
    // The app's own UNREAD_LABELS and SHARED_PARTS lines do not meet this walk of one page.
    expect(
      problemsOf(all).filter((one) => !/^(UNREAD_LABELS|UNREAD_FILTERS|SHARED_PARTS)/.test(one)),
    ).toEqual([
      'The search key odd of /setup/rooms has no kind in SEARCH_KINDS',
      'The label key rooms.missing has no text in every language',
    ]);
  });

  it('gives a page the roles of its area and a guarded control only those of its action (review must fix 3)', () => {
    const { map } = buildMap({ ...inputs, descriptions: all });
    const page = map.pages[0];
    const add = map.nodes.find((node) => node.id.endsWith('rooms.add'));
    // The Academic Vice Principal views the rooms and does not create them.
    expect(page?.roles).toContain('academic_vice_principal');
    expect(add?.roles).not.toContain('academic_vice_principal');
    expect(add?.roles).toContain('super_admin');
    // The button's own call, by operation id, and the page's from its controls.
    expect(add?.operations).toEqual(['RoomsController_create']);
    expect(page?.operations).toEqual(['RoomsController_create']);
    expect(add?.label).toEqual({ uz: 'Add uz', ru: 'Add ru', en: 'Add en' });
    expect(page?.search.open).toEqual({ kind: 'id' });
  });

  it('names a shown-with of an area the table lacks and a call of no operation (review must fix 4)', () => {
    const problems = buildMap({
      ...inputs,
      descriptions: all,
      shownWith: {
        'features/setup/rooms-page.tsx#button:rooms.missing': {
          area: 'no_such_area',
          action: 'edit',
        },
      },
      calls: { 'features/setup/rooms-page.tsx#button:rooms.missing': 'NoSuchController_run' },
    }).problems.map((one) => one.problem);
    expect(problems).toEqual(
      expect.arrayContaining([
        'No area no_such_area in the permission table',
        'features/setup/rooms-page.tsx#button:rooms.missing calls NoSuchController_run, which is no operation of the API',
      ]),
    );
  });

  it('gives a list page its filter keys with the values their options offer, and names a filter it cannot read (review of #386, must fix 1)', () => {
    const page = walk.pages[0];
    if (page === undefined) throw new Error('the walk has a page');
    const { map, problems } = buildMap({
      ...inputs,
      descriptions: all,
      walk: {
        ...walk,
        pages: [{ ...page, search: { open: { kind: 'string' }, f: { kind: 'record' } } }],
        filters: {
          'features/setup/rooms-page.tsx': [
            {
              key: 'type',
              values: ['hall', 'other'],
              ids: false,
              constants: [],
              unread: false,
              line: 1,
            },
            { key: 'floor', values: [], ids: true, constants: [], unread: false, line: 2 },
            { key: 'class', values: ['none'], ids: true, constants: [], unread: false, line: 3 },
            { key: 'grade', values: [], ids: false, constants: ['GRADES'], unread: false, line: 4 },
            { key: 'odd', values: [], ids: false, constants: [], unread: true, line: 5 },
          ],
        },
      },
    });
    expect(map.pages[0]?.search.f).toEqual({
      kind: 'record',
      keys: {
        class: { kind: 'idOrEnum', values: ['none'] },
        floor: { kind: 'id' },
        grade: { kind: 'enum', values: GRADES.map(String).sort((a, b) => a.localeCompare(b)) },
        type: { kind: 'enum', values: ['hall', 'other'] },
      },
    });
    expect(problems.map((one) => one.problem)).toContain(
      'The options of the filter features/setup/rooms-page.tsx#odd cannot be read; add it to UNREAD_FILTERS',
    );
  });
});
