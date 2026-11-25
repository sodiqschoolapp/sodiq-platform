import {
  MENU_ITEMS,
  PERMISSIONS,
  PLATFORM_SHELL,
  ROLES,
  permits,
  visibleMenu,
  type Action,
  type MenuItem,
  type PlatformMap,
  type PlatformMapLabel,
  type PlatformMapNode,
  type PlatformMapPage,
  type PlatformValueKind,
  type Role,
} from '@sodiq/shared';
import {
  LEFT_OUT_PAGES,
  PAGE_GUARDS,
  PAGE_TITLES,
  PARAM_VALUES,
  PRIMITIVES,
  SEARCH_KINDS,
  SHARED_PARTS,
  UNREAD_LABELS,
  type PageGuard,
} from './source';
import type { Walk, WalkedControl, WalkProblem } from './walk';

// Task 11.19: the map of the platform from the walk of the code, the locale files, the
// permission table, the OpenAPI document and the descriptions. Everything the map cannot
// settle is a problem, and the test of the map fails on any.

/** The roles of the staff layout: every role but a student's and a parent's. */
export const STAFF_ROLES: readonly Role[] = ROLES.filter(
  (role) => role !== 'student' && role !== 'parent',
);

export type Texts = Readonly<Record<string, unknown>>;

export interface MapInputs {
  walk: Walk;
  locales: { uz: Texts; ru: Texts; en: Texts };
  /** The OpenAPI document's paths. */
  openapi: { paths: Record<string, Record<string, { operationId?: string }>> };
  /** One English description per node id (a page's id is `page:<path>`). */
  descriptions: Readonly<Record<string, string>>;
  /** The common action keys with the one description each (plan decision 2, closed list). */
  commonActions: Readonly<Record<string, string>>;
  /** Nodes shown only to a role the walk cannot see from the code, by id. */
  shownWith: Readonly<Record<string, { area: string; action: Action }>>;
  /** The API operation of a control, by id, where the map names one. */
  calls: Readonly<Record<string, string>>;
}

function textAt(texts: Texts, key: string): string | undefined {
  let value: unknown = texts;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

/** A key's text in one language; a key of plural forms reads its `_other` (or `_one`). */
function textOf(texts: Texts, key: string): string | undefined {
  return textAt(texts, key) ?? textAt(texts, `${key}_other`) ?? textAt(texts, `${key}_one`);
}

/** `{{name}}` of a text with a value left out: a hint of what goes there. */
function plain(text: string): string {
  return text.replace(/\{\{\s*([A-Za-z]+)[^}]*\}\}/g, '…').replace(/<\/?\d+>/g, '');
}

/** The base id of a second control with the same key in one file (`…:2` → `…`). */
export function baseId(id: string): string {
  return id.replace(/:\d+$/, '');
}

const SORT = (a: string, b: string): number => a.localeCompare(b);

export function buildMap(inputs: MapInputs): { map: PlatformMap; problems: WalkProblem[] } {
  const { walk, locales } = inputs;
  const problems: WalkProblem[] = [...walk.problems];
  const problem = (file: string, line: number, text: string): void => {
    problems.push({ file, line, problem: text });
  };

  // The walk's unread labels: each file as many as `UNREAD_LABELS` names, no more, no fewer.
  const unread = new Map<string, number>();
  const kept: WalkProblem[] = [];
  for (const one of problems) {
    if (/label the walk/.test(one.problem) && Object.hasOwn(UNREAD_LABELS, one.file)) {
      unread.set(one.file, (unread.get(one.file) ?? 0) + 1);
      continue;
    }
    if (/^The page of (\S+) cannot be read$/.test(one.problem)) {
      const path = /^The page of (\S+)/.exec(one.problem)?.[1] ?? '';
      if (Object.hasOwn(LEFT_OUT_PAGES, path)) continue;
    }
    kept.push(one);
  }
  problems.length = 0;
  problems.push(...kept);
  for (const [file, { count }] of Object.entries(UNREAD_LABELS)) {
    const found = unread.get(file) ?? 0;
    if (found !== count) {
      problem(
        file,
        0,
        `UNREAD_LABELS names ${String(count)} for this file; the walk finds ${String(found)}`,
      );
    }
  }

  // Every file of `components/` with a control is a shared part or a primitive.
  for (const file of walk.componentFilesWithControls) {
    if (!SHARED_PARTS.includes(file) && !Object.hasOwn(PRIMITIVES, file)) {
      problem(
        file,
        0,
        'A file of components/ draws controls: add it to SHARED_PARTS or PRIMITIVES',
      );
    }
  }
  for (const file of SHARED_PARTS) {
    if (!walk.componentFilesWithControls.includes(file) && !Object.hasOwn(UNREAD_LABELS, file)) {
      problem(file, 0, 'SHARED_PARTS names a file with no control');
    }
  }

  const label = (key: string, file: string, line: number): PlatformMapLabel | null => {
    const uz = textOf(locales.uz, key);
    const ru = textOf(locales.ru, key);
    const en = textOf(locales.en, key);
    if (uz === undefined || ru === undefined || en === undefined) {
      problem(file, line, `The label key ${key} has no text in every language`);
      return null;
    }
    return { uz: plain(uz), ru: plain(ru), en: plain(en) };
  };

  const operations = new Map<string, string>();
  for (const [route, methods] of Object.entries(inputs.openapi.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.operationId !== undefined) {
        operations.set(`${method.toUpperCase()} ${route}`, operation.operationId);
      }
    }
  }
  const knownOperations = new Set(operations.values());

  const used = new Set<string>();
  const describe = (id: string, key: string | undefined, file: string, line: number): string => {
    const own = inputs.descriptions[id] ?? inputs.descriptions[baseId(id)];
    if (own !== undefined) {
      used.add(inputs.descriptions[id] === undefined ? baseId(id) : id);
      return own;
    }
    if (key !== undefined && Object.hasOwn(inputs.commonActions, key)) {
      return inputs.commonActions[key] ?? '';
    }
    problem(file, line, `${id} has no description`);
    return '';
  };

  const rolesOfGuard = (guard: PageGuard | { area: string; action: string }): Role[] => {
    if ('every' in guard) return [...STAFF_ROLES];
    if ('menu' in guard) {
      const built = new Set<MenuItem>(MENU_ITEMS);
      return STAFF_ROLES.filter((role) =>
        visibleMenu(role, built, PERMISSIONS).includes(guard.menu),
      );
    }
    const list = 'anyOf' in guard ? guard.anyOf : [guard];
    for (const one of list) {
      if (!Object.hasOwn(PERMISSIONS, one.area)) {
        problem('tooling/platform-map/source.ts', 0, `No area ${one.area} in the permission table`);
      }
    }
    return STAFF_ROLES.filter((role) =>
      list.some(
        (one) =>
          Object.hasOwn(PERMISSIONS, one.area) &&
          permits(PERMISSIONS, role, one.area, one.action as Action),
      ),
    );
  };

  const pages: PlatformMapPage[] = [];
  const pagesOfFile = new Map<string, string[]>();
  const rolesOfPage = new Map<string, Role[]>();
  for (const page of walk.pages) {
    const guard = page.guard ?? PAGE_GUARDS[page.path];
    if (guard === undefined) {
      problem('app/router.tsx', 0, `The page ${page.path} is not guarded and not in PAGE_GUARDS`);
      continue;
    }
    const roles = rolesOfGuard(guard);
    rolesOfPage.set(page.path, roles);
    const titleKey = PAGE_TITLES[page.path] ?? page.titleKey;
    if (PAGE_TITLES[page.path] !== undefined && page.titleKey !== null) {
      problem(
        'tooling/platform-map/source.ts',
        0,
        `PAGE_TITLES names ${page.path}, whose header the walk reads`,
      );
    }
    const title = titleKey === null ? null : label(titleKey, page.file, 0);
    if (titleKey === null)
      problem(
        page.file,
        0,
        `The page ${page.path} has no title the walk reads; add it to PAGE_TITLES`,
      );
    const params: Record<string, PlatformValueKind> = {};
    for (const name of page.params) {
      const kind = /(^id|Id)$/.test(name) ? { kind: 'id' as const } : PARAM_VALUES[name];
      if (kind === undefined)
        problem(
          'app/router.tsx',
          0,
          `The parameter ${name} of ${page.path} has no kind in PARAM_VALUES`,
        );
      else params[name] = { ...kind } as PlatformValueKind;
    }
    const search: Record<string, PlatformValueKind> = {};
    for (const [name, type] of Object.entries(page.search)) {
      if (type.kind === 'enum') search[name] = { kind: 'enum', values: type.values };
      else if (type.kind === 'number' || type.kind === 'boolean' || type.kind === 'record')
        search[name] = { kind: type.kind };
      else {
        const kind = SEARCH_KINDS[name];
        if (kind === undefined)
          problem(
            'app/router.tsx',
            0,
            `The search key ${name} of ${page.path} has no kind in SEARCH_KINDS`,
          );
        else search[name] = { ...kind } as PlatformValueKind;
      }
    }
    const pageOperations = new Set<string>();
    for (const file of page.files) {
      for (const call of walk.calls[file] ?? []) {
        const [method, route] = call.split(' ');
        const id = operations.get(`${method ?? ''} ${route ?? ''}`);
        if (id !== undefined) pageOperations.add(id);
      }
      pagesOfFile.set(file, [...(pagesOfFile.get(file) ?? []), page.path]);
    }
    const id = `page:${page.path}`;
    pages.push({
      id,
      path: page.path,
      title: title ?? { uz: '', ru: '', en: '' },
      roles,
      params,
      search,
      operations: [...pageOperations].sort(SORT),
      description: describe(id, undefined, page.file, 0),
    });
  }
  for (const file of walk.shellFiles) {
    pagesOfFile.set(file, [PLATFORM_SHELL]);
  }

  const nodes: PlatformMapNode[] = [];
  const seen = new Set<string>();
  for (const control of walk.controls) {
    if (seen.has(control.id)) continue;
    seen.add(control.id);
    const onPages = pagesOfFile.get(control.file) ?? [];
    if (onPages.length === 0) continue;
    nodes.push(nodeOf(control, onPages));
  }

  function nodeOf(control: WalkedControl, onPages: string[]): PlatformMapNode {
    const key = control.keys[0];
    const shownWith = [...control.shownWith];
    const extra = inputs.shownWith[control.id];
    if (extra !== undefined) {
      used.add(`shownWith:${control.id}`);
      shownWith.push(extra);
    }
    let roles: Role[] = onPages.includes(PLATFORM_SHELL)
      ? [...STAFF_ROLES]
      : STAFF_ROLES.filter((role) => onPages.some((path) => rolesOfPage.get(path)?.includes(role)));
    for (const one of shownWith) {
      if (!Object.hasOwn(PERMISSIONS, one.area)) {
        problem(control.file, control.line, `No area ${one.area} in the permission table`);
        continue;
      }
      roles = roles.filter((role) => permits(PERMISSIONS, role, one.area, one.action as Action));
    }
    const operation = inputs.calls[control.id] ?? null;
    if (operation !== null && !knownOperations.has(operation)) {
      problem(
        control.file,
        control.line,
        `${control.id} calls ${operation}, which is no operation of the API`,
      );
    }
    return {
      id: control.id,
      kind: control.kind,
      label: key === undefined ? null : label(key, control.file, control.line),
      pages: [...onPages].sort(SORT),
      parent: control.parent,
      roles,
      operation,
      description: describe(control.id, key, control.file, control.line),
    };
  }

  // A description, a shown-with or a call that names nothing is stale.
  const ids = new Set([...pages.map((page) => page.id), ...nodes.map((node) => node.id)]);
  for (const id of Object.keys(inputs.descriptions)) {
    if (!ids.has(id))
      problem(
        'tooling/platform-map/descriptions',
        0,
        `The description of ${id} names no node of the map`,
      );
  }
  for (const id of [...Object.keys(inputs.shownWith), ...Object.keys(inputs.calls)]) {
    if (!ids.has(id))
      problem('tooling/platform-map/source.ts', 0, `${id} names no node of the map`);
  }
  for (const key of Object.keys(inputs.commonActions)) {
    if (label(key, 'tooling/platform-map/descriptions', 0) === null) continue;
  }

  return {
    map: {
      pages: pages.sort((a, b) => SORT(a.id, b.id)),
      nodes: nodes.sort((a, b) => SORT(a.id, b.id)),
    },
    problems,
  };
}
