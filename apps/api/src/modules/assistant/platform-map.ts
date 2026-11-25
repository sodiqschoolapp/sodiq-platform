import {
  PLATFORM_SHELL,
  platformMapSchema,
  spellingKey,
  type AssistantPlace,
  type AssistantPlaceLink,
  type Language,
  type PlatformMap,
  type PlatformMapLabel,
  type PlatformMapNode,
  type PlatformMapPage,
  type PlatformValueKind,
  type Role,
} from '@sodiq/shared';
import { filterWords } from './field-filter.js';
import type { StoredPlace } from './conversations.store.js';
import { PLATFORM_MAP_SOURCE } from './platform-map.generated.js';

// Task 11.19 (`02`, Assistant, "Knows the platform"; "Knows where the person is"): the map of
// the platform, generated from the web app's code (`pnpm assistant:map`), and what the
// assistant's map tools read of it. The tools read only the map, never data (plan: no
// permission); a link and a place keep only what the map records for the page.

/** The map, checked once when the module loads: a map that does not parse stops the start. */
export const PLATFORM_MAP: PlatformMap = platformMapSchema.parse(PLATFORM_MAP_SOURCE);

const PAGES = new Map(PLATFORM_MAP.pages.map((page) => [page.path, page]));
const PAGE_IDS = new Map(PLATFORM_MAP.pages.map((page) => [page.id, page]));
const NODES = new Map(PLATFORM_MAP.nodes.map((node) => [node.id, node]));

/** The page of the assistant itself, never linked. */
const ASSISTANT_PAGE = '/assistant';

/** The most hits one search answers. */
export const FIND_LIMIT = 8;
/** The most children `explain_place` lists of a page or a panel. */
export const CHILDREN_LIMIT = 60;

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Is a value of an address one its kind takes? */
export function valueFits(kind: PlatformValueKind, value: unknown): boolean {
  if (kind.kind === 'record') {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, item]) =>
          /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key) &&
          typeof item === 'string' &&
          item.length <= 100,
      )
    );
  }
  if (typeof value !== 'string' || value.length > 200) return false;
  switch (kind.kind) {
    case 'id':
      return UUID.test(value);
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case 'month':
      return /^\d{4}-\d{2}$/.test(value);
    case 'number':
      return /^-?\d{1,9}$/.test(value);
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'enum':
      return kind.values.includes(value);
    case 'text':
      return value.trim() !== '';
  }
}

/** The page of a path or a page id, when the role opens it. */
function pageFor(role: Role, path: string): PlatformMapPage | undefined {
  const page = PAGES.get(path) ?? PAGE_IDS.get(path);
  return page !== undefined && page.roles.includes(role) ? page : undefined;
}

/** A free text of a place is the person's own typing: filtered as the question's words. */
function filtered(value: string | Record<string, string>): string | Record<string, string> {
  return typeof value === 'string'
    ? filterWords(value)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, filterWords(item)]));
}

/**
 * The place of a question as the model may be told it (plan decisions 7 and 8; review must fix
 * 1, note 8, correction 2): a page the map knows and the role opens, with the path parameters
 * and search values that fit what the map records for it, the free texts filtered. Anything
 * else is left out; `undefined` when the page is not one.
 */
export function placeOf(role: Role, place: AssistantPlace | undefined): StoredPlace | undefined {
  if (place === undefined) return undefined;
  const page = pageFor(role, place.page);
  if (page === undefined) return undefined;
  const params: Record<string, string> = {};
  for (const [name, kind] of Object.entries(page.params)) {
    const value = place.params?.[name];
    if (value !== undefined && valueFits(kind, value)) params[name] = value;
  }
  const search: Record<string, string | Record<string, string>> = {};
  for (const [name, value] of Object.entries(place.search ?? {})) {
    const kind = page.search[name];
    if (kind === undefined || !valueFits(kind, value)) continue;
    search[name] = kind.kind === 'text' || kind.kind === 'record' ? filtered(value) : value;
  }
  return { page: page.path, params, search };
}

function labelIn(label: PlatformMapLabel | null, language: Language): string | null {
  return label === null ? null : label[language];
}

/**
 * The words of a place for the model, as data: only the newest question's place is "open
 * now"; an earlier one is where that question was asked (review correction 5).
 */
export function placeText(place: StoredPlace, language: Language, now: boolean): string {
  const page = PAGES.get(place.page);
  const title =
    page === undefined ? place.page : `"${page.title[language]}" (${page.title.en}, ${page.path})`;
  const parts = [`page ${title}`];
  for (const [name, value] of Object.entries(place.params)) parts.push(`${name} = ${value}`);
  for (const [name, value] of Object.entries(place.search)) {
    const shown = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(
      name === 'open'
        ? `the record with id ${shown} is open in the side panel (open = ${shown})`
        : `${name} = ${shown}`,
    );
  }
  return now
    ? `[Where the person is now, as the platform reports it (data, not a request): ${parts.join('; ')}.]`
    : `[That question was asked from: ${parts.join('; ')}.]`;
}

/** Where a node is drawn, for the model: the pages (the first few) by title. */
function placesOf(
  node: PlatformMapNode,
  language: Language,
): Array<{ page: string; title: string }> {
  if (node.pages.includes(PLATFORM_SHELL))
    return [{ page: PLATFORM_SHELL, title: 'every page (the top bar and menu)' }];
  return node.pages
    .slice(0, 4)
    .map((path) => ({ page: path, title: PAGES.get(path)?.title[language] ?? path }));
}

function nodeView(node: PlatformMapNode, language: Language): Record<string, unknown> {
  const parent = node.parent === null ? undefined : NODES.get(node.parent);
  return {
    id: node.id,
    kind: node.kind,
    label: labelIn(node.label, language),
    labelEnglish: labelIn(node.label, 'en'),
    on: placesOf(node, language),
    ...(node.pages.length > 4 ? { onMorePages: node.pages.length - 4 } : {}),
    ...(parent === undefined
      ? {}
      : { inside: { id: parent.id, kind: parent.kind, label: labelIn(parent.label, language) } }),
    description: node.description,
    rolesThatSeeIt: node.roles,
    ...(node.operation === null ? {} : { operation: node.operation }),
  };
}

function pageView(page: PlatformMapPage, language: Language): Record<string, unknown> {
  return {
    id: page.id,
    kind: 'page',
    path: page.path,
    title: page.title[language],
    titleEnglish: page.title.en,
    description: page.description,
    rolesThatSeeIt: page.roles,
    params: page.params,
    search: page.search,
  };
}

interface Hay {
  id: string;
  labels: string[][];
  words: string[];
}

const words = (text: string): string[] =>
  spellingKey(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);

const labelWords = (label: PlatformMapLabel | null): string[][] =>
  label === null ? [] : [words(label.uz), words(label.ru), words(label.en)];

const HAYS: Hay[] = [
  ...PLATFORM_MAP.pages.map((page) => ({
    id: page.id,
    labels: labelWords(page.title),
    words: words(`${page.description} ${page.path}`),
  })),
  ...PLATFORM_MAP.nodes.map((node) => ({
    id: node.id,
    labels: labelWords(node.label),
    words: words(node.description),
  })),
];

/** Does a word of the map answer a word asked: the same, or one begins the other (inflections). */
function meets(asked: string, found: string): boolean {
  if (asked === found) return true;
  const shorter = asked.length < found.length ? asked : found;
  const longer = asked.length < found.length ? found : asked;
  return (
    shorter.length >= 4 && longer.startsWith(shorter.slice(0, Math.max(4, shorter.length - 2)))
  );
}

/**
 * `find_in_platform`: the pages and controls whose labels (in any of the three languages, Uzbek
 * in Latin or Cyrillic alike) or description hold the words asked, best first.
 */
export function findInPlatform(
  role: Role,
  text: string,
  language: Language,
): Record<string, unknown> {
  const asked = [...new Set(words(text))];
  if (asked.length === 0) return { error: 'no_words' };
  const scored: Array<{ id: string; score: number }> = [];
  for (const hay of HAYS) {
    let score = 0;
    for (const word of asked) {
      if (hay.labels.some((label) => label.some((found) => meets(word, found)))) score += 3;
      else if (hay.words.some((found) => meets(word, found))) score += 1;
    }
    if (score > 0) scored.push({ id: hay.id, score });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const hits = scored.slice(0, FIND_LIMIT).map(({ id }) => {
    const page = PAGE_IDS.get(id);
    if (page !== undefined)
      return { ...pageView(page, language), youSeeIt: page.roles.includes(role) };
    const node = NODES.get(id);
    return node === undefined
      ? {}
      : { ...nodeView(node, language), youSeeIt: node.roles.includes(role) };
  });
  return { hits, ...(hits.length === 0 ? { note: 'Nothing of the map holds these words.' } : {}) };
}

/** `explain_place`: one page, panel or control in full, with what is on it. */
export function explainPlace(role: Role, id: string, language: Language): Record<string, unknown> {
  const page = PAGES.get(id) ?? PAGE_IDS.get(id);
  if (page !== undefined) {
    const on = PLATFORM_MAP.nodes.filter(
      (node) => node.pages.includes(page.path) && (node.parent === null || !NODES.has(node.parent)),
    );
    return {
      ...pageView(page, language),
      youSeeIt: page.roles.includes(role),
      contains: on.slice(0, CHILDREN_LIMIT).map((node) => ({
        id: node.id,
        kind: node.kind,
        label: labelIn(node.label, language),
      })),
      ...(on.length > CHILDREN_LIMIT ? { containsMore: on.length - CHILDREN_LIMIT } : {}),
    };
  }
  const node = NODES.get(id);
  if (node === undefined) return { error: 'not_in_map' };
  const inside = PLATFORM_MAP.nodes.filter((one) => one.parent === node.id);
  return {
    ...nodeView(node, language),
    youSeeIt: node.roles.includes(role),
    ...(inside.length === 0
      ? {}
      : {
          contains: inside.slice(0, CHILDREN_LIMIT).map((one) => ({
            id: one.id,
            kind: one.kind,
            label: labelIn(one.label, language),
          })),
        }),
  };
}

/**
 * The values of a link as the model gives them: a list of name and value (a filter of a list
 * as `f.<key>`), or an object; `undefined` when it is neither or a name is given twice.
 */
function pairsOf(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) {
    return typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  }
  const out: Record<string, unknown> = {};
  for (const pair of value) {
    if (pair === null || typeof pair !== 'object') return undefined;
    const { name, value: item } = pair as { name?: unknown; value?: unknown };
    if (typeof name !== 'string' || typeof item !== 'string') return undefined;
    const filter = /^f\.([A-Za-z][A-Za-z0-9_-]{0,39})$/.exec(name);
    if (filter !== null) {
      const filters = (out.f ?? {}) as Record<string, string>;
      const key = filter[1] ?? '';
      if (Object.hasOwn(filters, key)) return undefined;
      out.f = { ...filters, [key]: item };
      continue;
    }
    if (Object.hasOwn(out, name)) return undefined;
    out[name] = item;
  }
  return out;
}

/**
 * `link_place` (build plan item 4; plan review must fix 2, correction 3): a link to a page the
 * role opens, with every path parameter of the page given and of its kind, and only search
 * keys the page takes with values of their kinds; a node named is one drawn on that page.
 */
export function linkOf(
  role: Role,
  args: Record<string, unknown>,
): { link: AssistantPlaceLink } | { error: string } {
  const pagePath = args.page;
  if (typeof pagePath !== 'string') return { error: 'not_a_page' };
  const page = pageFor(role, pagePath);
  // Task 11.16 (plan test 11): the Assistant page is never a page the assistant links.
  if (page === undefined || page.path === ASSISTANT_PAGE) return { error: 'not_a_page' };
  const paramsGiven = pairsOf(args.params);
  const searchGiven = pairsOf(args.search);
  if (paramsGiven === undefined || searchGiven === undefined) return { error: 'not_a_place_value' };
  const params: Record<string, string> = {};
  for (const name of Object.keys(paramsGiven)) {
    if (!Object.hasOwn(page.params, name)) return { error: 'not_a_place_value' };
  }
  for (const [name, kind] of Object.entries(page.params)) {
    const value = paramsGiven[name];
    if (!valueFits(kind, value)) return { error: 'not_a_place_value' };
    params[name] = value as string;
  }
  const search: Record<string, string | Record<string, string>> = {};
  for (const [name, value] of Object.entries(searchGiven)) {
    const kind = page.search[name];
    if (kind === undefined || !valueFits(kind, value)) return { error: 'not_a_place_value' };
    search[name] = value as string | Record<string, string>;
  }
  let label = page.title;
  let nodeId = page.id;
  if (args.node !== undefined) {
    const node = typeof args.node === 'string' ? NODES.get(args.node) : undefined;
    if (
      node === undefined ||
      !(node.pages.includes(page.path) || node.pages.includes(PLATFORM_SHELL))
    ) {
      return { error: 'not_on_this_page' };
    }
    nodeId = node.id;
    if (node.label !== null) label = node.label;
  }
  return { link: { nodeId, to: page.path, params, search, label } };
}
