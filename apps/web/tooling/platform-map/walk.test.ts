// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURE } from './walk.fixture';
import { walkApp, type Walk } from './walk';

// Task 11.19, plan test 2: the walk finds each kind (a button, a field, a column, a tab, a
// panel), narrows a control's roles by a `permits(...)` that guards it, lists a panel drawn by
// two pages for both, reads a label through a constant and through a local helper's calls,
// and names a label it cannot read (review correction 7), so the test of the map cannot pass
// with a kind silently skipped.

const dir = mkdtempSync(path.join(tmpdir(), 'platform-map-'));
for (const [file, text] of Object.entries(FIXTURE)) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const byId = (walk: Walk, id: string) => walk.controls.find((control) => control.id === id);

describe('the walk of the code', () => {
  const walk = walkApp({
    src: dir,
    router: 'app/router.tsx',
    layoutRoute: 'appRoute',
    sharedParts: [],
  });

  it('reads the pages under the layout, their guards, parameters, search and titles', () => {
    expect(walk.pages.map((page) => [page.path, page.guard, page.params, page.titleKey])).toEqual([
      ['/other', { area: 'rooms', action: 'edit' }, [], 'other.title'],
      ['/things/$thingId', { area: 'rooms', action: 'view' }, ['thingId'], 'things.title'],
    ]);
    expect(walk.pages[1]?.search).toEqual({
      open: { kind: 'string' },
      tab: { kind: 'enum', values: ['one', 'two'] },
    });
    expect(walk.shellFiles).toContain('features/things/layout.tsx');
  });

  it('finds each kind of control with its label key', () => {
    const page = 'features/things/things-page.tsx';
    expect(byId(walk, `${page}#button:things.add`)?.kind).toBe('button');
    expect(byId(walk, `${page}#field:things.field`)?.kind).toBe('field');
    expect(byId(walk, `${page}#column:things.name`)?.kind).toBe('column');
    expect(byId(walk, `${page}#panel:things.dialog`)?.kind).toBe('panel');
    expect(byId(walk, 'features/things/thing-panel.tsx#tab:things.tabs.one')?.kind).toBe('tab');
    expect(byId(walk, 'features/things/layout.tsx#button:shell.signOut')?.kind).toBe('button');
  });

  it('puts a control inside its dialog, and a panel file’s controls inside the panel', () => {
    const page = 'features/things/things-page.tsx';
    expect(byId(walk, `${page}#button:things.inside`)?.parent).toBe(`${page}#panel:things.dialog`);
    expect(byId(walk, 'features/things/thing-panel.tsx#button:things.archive')?.parent).toBe(
      'features/things/thing-panel.tsx#panel',
    );
  });

  it('narrows a control by the permits(...) that guards it', () => {
    expect(byId(walk, 'features/things/thing-panel.tsx#button:things.archive')?.shownWith).toEqual([
      { area: 'rooms', action: 'archive' },
    ]);
    expect(byId(walk, 'features/things/things-page.tsx#button:things.add')?.shownWith).toEqual([]);
  });

  it('lists a panel drawn by two pages on both', () => {
    const drawing = walk.pages.filter((page) =>
      page.files.includes('features/things/thing-panel.tsx'),
    );
    expect(drawing.map((page) => page.path)).toEqual(['/other', '/things/$thingId']);
  });

  it('reads a label handed to a local helper at each of its calls', () => {
    expect(byId(walk, 'features/things/thing-panel.tsx#button:things.first')).toBeDefined();
    expect(byId(walk, 'features/things/thing-panel.tsx#button:things.second')).toBeDefined();
  });

  it('records the API calls of a file, and of a control’s action through its mutation (review must fix 1)', () => {
    expect(walk.calls['features/things/things-page.tsx']).toEqual(['POST /api/things']);
    expect(byId(walk, 'features/things/things-page.tsx#button:things.add')?.calls).toEqual([
      'POST /api/things',
    ]);
    expect(byId(walk, 'features/things/other-page.tsx#button:other.remove')?.calls).toEqual([
      'DELETE /api/things/{id}',
    ]);
  });

  it('reads a row of tabs drawn as links from a list, one tab per element with the route it opens (review must fix 2)', () => {
    const tabs = walk.controls.filter((control) =>
      control.id.startsWith('features/things/other-page.tsx#tab:'),
    );
    expect(tabs.map((tab) => [tab.keys[0], tab.opens])).toEqual([
      ['other.tabs.one', '/other'],
      ['other.tabs.two', '/things/$thingId'],
    ]);
  });

  it('reads the key of each filter of a list and the values its options offer, and names one it cannot read (review of #386, must fix 1)', () => {
    expect(
      walk.filters['features/things/things-page.tsx']?.map(({ key, values, ids, unread }) => ({
        key,
        values,
        ids,
        unread,
      })),
    ).toEqual([
      { key: 'state', values: ['open', 'shut'], ids: false, unread: false },
      { key: 'level', values: ['5', '6'], ids: false, unread: false },
      { key: 'place', values: ['none'], ids: true, unread: false },
      { key: 'odd', values: [], ids: false, unread: true },
    ]);
  });

  it('names a control whose label is not a key it can read (correction 7)', () => {
    expect(walk.problems).toEqual([
      expect.objectContaining({
        file: 'features/things/things-page.tsx',
        problem: 'The Button has a label the walk cannot read (not a literal key)',
      }),
    ]);
  });
});
