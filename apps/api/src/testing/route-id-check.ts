import type { OpenAPIObject } from '@nestjs/swagger';
import { hasTitle, readTestFile, staticSegments } from './route-scope-check.js';

/**
 * What an id a route takes names:
 *
 * - `branch`: a record of one branch, or a shared record (a staff member, a
 *   relative) read through its links to the branch of the request. Another
 *   branch's id and an unknown one are answered 404, with the rows of both
 *   branches and the audit log unchanged (`.claude/rules/api.md`, tasks 1.3 and 1.5);
 * - `school`: a record of the whole school, one of `SCHOOL_RECORDS`; its tests,
 *   when named, send an unknown id;
 * - `own`: a record of the signed-in account (a notification, a session, a
 *   trusted device); another account's id and an unknown one are answered 404;
 * - `none`: no record (the rule says why).
 */
export type IdKind = 'branch' | 'school' | 'own' | 'none';

/**
 * The records the spec makes school-wide: the branches themselves, the
 * divisions and departments (`03`), and the subjects, one list for the whole
 * school (`docs/decisions.md`, answers for tasks 2.1 to 2.6, answer 3; `subjects`
 * has no branch column).
 */
export const SCHOOL_RECORDS: readonly string[] = ['branch', 'division', 'department', 'subject'];

/** One id of a route. */
export interface IdLine {
  /**
   * Where the id is: `path:<param>`, `query:<field>` or `body:<field path>`,
   * an array as `[]` and a variant of a union as `<field=value>`, as
   * `inputIdsOf` writes it (`body:rooms[].roomId`, `body<kind=class>.classId`).
   */
  id: string;
  /** The record it names (`room`, `lesson`, `journal`). */
  record: string;
  kind: IdKind;
  /** The spec line or decision it rests on. */
  rule: string;
  /**
   * The tests that send another branch's id (another account's, for `own`) and
   * an unknown one and see 404 with the rows unchanged, or for a query filter
   * none of the other branch's matching rows answered:
   * `<file under apps/api> > <title of the it, test or describe>`.
   * For `school`, the tests of an unknown id, when there are any; empty for `none`.
   */
  refusedIn: readonly string[];
  /**
   * On a route with a request key (`Idempotency-Key`), the tests that repeat a
   * used key with another branch's id and an unknown one and see 404, never
   * the stored answer (`.claude/rules/api.md`, task 5.5a-1). Same form as `refusedIn`.
   */
  repeatIn?: readonly string[];
}

export type RouteIds = Readonly<Record<string, readonly IdLine[]>>;

/** The ids a route takes, as the OpenAPI document describes its input. */
export interface InputIds {
  ids: string[];
  /** Whether the route takes a request key. */
  requestKey: boolean;
}

type Json = Record<string, unknown>;

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(schema: Json): boolean {
  return schema.format === 'uuid';
}

/** A field named like an id: `id`, `ids`, or ending in `Id` or `Ids`. */
function namedLikeId(name: string): boolean {
  return name === 'id' || name === 'ids' || /(?:Id|Ids)$/.test(name);
}

function isText(schema: Json): boolean {
  return schema.type === 'string' || (isObject(schema.items) && schema.items.type === 'string');
}

/** The one-value field of a variant that tells it apart (`kind: 'class'`), as `<kind=class>`. */
function variantLabel(schema: Json): string {
  if (!isObject(schema.properties)) {
    return '';
  }
  for (const [name, field] of Object.entries(schema.properties)) {
    if (!isObject(field)) {
      continue;
    }
    const values: unknown[] = Array.isArray(field.enum) ? field.enum : [];
    const only: unknown = field.const ?? (values.length === 1 ? values[0] : undefined);
    if (typeof only === 'string' || typeof only === 'number' || typeof only === 'boolean') {
      return `<${name}=${String(only)}>`;
    }
  }
  return '';
}

function resolve(document: Json, schema: Json): Json {
  const reference = schema.$ref;
  if (typeof reference !== 'string' || !reference.startsWith('#/')) {
    return schema;
  }
  let found: unknown = document;
  for (const part of reference.slice(2).split('/')) {
    found = isObject(found) ? found[part] : undefined;
  }
  return isObject(found) ? found : schema;
}

/**
 * Collects into `found` the ids of a schema at `where`: a field whose schema
 * is a uuid, or an array of uuids, or whose name is an id's and whose value is
 * text. Walks objects, arrays, unions and references.
 */
function collect(
  document: Json,
  given: unknown,
  field: string | undefined,
  where: string,
  found: Set<string>,
): void {
  if (!isObject(given)) {
    return;
  }
  const schema = resolve(document, given);
  const items = isObject(schema.items) ? resolve(document, schema.items) : undefined;
  if (
    field !== undefined &&
    (isUuid(schema) ||
      (items !== undefined && isUuid(items)) ||
      (namedLikeId(field) && isText(schema)))
  ) {
    found.add(where);
    return;
  }
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const given: unknown = schema[key];
    const variants: unknown[] = Array.isArray(given) ? given : [];
    if (variants.length === 0) {
      continue;
    }
    for (const variant of variants) {
      const resolved: unknown = isObject(variant) ? resolve(document, variant) : variant;
      collect(
        document,
        resolved,
        field,
        isObject(resolved) ? `${where}${variantLabel(resolved)}` : where,
        found,
      );
    }
  }
  if (isObject(schema.properties)) {
    for (const [name, value] of Object.entries(schema.properties)) {
      collect(document, value, name, `${where}.${name}`, found);
    }
  }
  if (items !== undefined) {
    collect(document, items, undefined, `${where}[]`, found);
  }
  if (isObject(schema.additionalProperties)) {
    collect(document, schema.additionalProperties, undefined, `${where}{}`, found);
  }
}

/** `body.rooms[].roomId` as `body:rooms[].roomId`; `body<kind=class>.classId` stays. */
function bodyName(where: string): string {
  return where.startsWith('body.') ? `body:${where.slice('body.'.length)}` : where;
}

/**
 * The ids every route of the document takes, by the route's name in
 * `ROUTE_ACCESS` (`GET /api/x/:id`; the document writes `get /api/x/{id}`):
 * every path parameter, and every field of the query and the JSON body that
 * is a uuid or named like an id. A route that takes none is left out.
 */
export function inputIdsOf(document: OpenAPIObject): Record<string, InputIds> {
  const json = document as unknown as Json;
  const routes: Record<string, InputIds> = {};
  for (const [pathName, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) {
        continue;
      }
      const name = `${method.toUpperCase()} ${pathName.replace(/\{(\w+)\}/g, ':$1')}`;
      const found = new Set<string>();
      let requestKey = false;
      for (const given of operation.parameters ?? []) {
        const parameter = resolve(json, given as unknown as Json);
        const parameterName = typeof parameter.name === 'string' ? parameter.name : '';
        if (parameter.in === 'path') {
          found.add(`path:${parameterName}`);
        } else if (parameter.in === 'query') {
          collect(json, parameter.schema, parameterName, `query:${parameterName}`, found);
        } else if (parameter.in === 'header' && /^idempotency-key$/i.test(parameterName)) {
          requestKey = true;
        }
      }
      const body = operation.requestBody as Json | undefined;
      const content = isObject(body?.content) ? body.content['application/json'] : undefined;
      if (isObject(content)) {
        collect(json, content.schema, undefined, 'body', found);
      }
      if (found.size > 0) {
        routes[name] = { ids: [...found].map(bodyName), requestKey };
      }
    }
  }
  return routes;
}

function testProblems(
  route: string,
  what: string,
  named: readonly string[],
  readSource: (file: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const test of named) {
    const cut = test.indexOf(' > ');
    if (cut < 0) {
      problems.push(`${route} ${what}: "${test}" is not "<file> > <title>"`);
      continue;
    }
    const file = test.slice(0, cut);
    const title = test.slice(cut + 3);
    const source = readSource(file);
    if (source === undefined) {
      problems.push(`${route} ${what}: ${file} does not exist`);
      continue;
    }
    if (!hasTitle(source, title)) {
      problems.push(`${route} ${what}: ${file} has no test "${title}"`);
    }
    const missing = staticSegments(route).filter((segment) => !source.includes(segment));
    if (missing.length > 0) {
      problems.push(`${route} ${what}: ${file} never names ${missing.join(', ')} of the route`);
    }
    // A guard against a wrong name only: nearly every route test file says 404.
    if (!source.includes('404')) {
      problems.push(`${route} ${what}: ${file} never expects a 404`);
    }
  }
  return problems;
}

/**
 * What is wrong with the list of ids, read against the ids the routes take and
 * the test files: an empty list means every id of every route has exactly one
 * line, every line is of an id the route takes, and every test named exists
 * and names the route.
 */
export function idProblems(
  routes: Readonly<Record<string, InputIds>>,
  lines: RouteIds,
  readSource: (file: string) => string | undefined = readTestFile,
): string[] {
  const problems: string[] = [];
  for (const [route, input] of Object.entries(routes)) {
    const listed = lines[route] ?? [];
    for (const id of input.ids) {
      const count = listed.filter((line) => line.id === id).length;
      if (count !== 1) {
        problems.push(`${route}: ${String(count)} lines for ${id}, it needs exactly one`);
      }
    }
  }
  for (const [route, listed] of Object.entries(lines)) {
    const input = routes[route];
    if (input === undefined) {
      problems.push(`${route}: in the id list, but the route takes no id or does not exist`);
      continue;
    }
    for (const line of listed) {
      const what = line.id;
      if (!input.ids.includes(line.id)) {
        problems.push(`${route}: a line for ${what}, which the route does not take`);
      }
      if (line.record.trim() === '') {
        problems.push(`${route} ${what}: no record named`);
      }
      if (line.rule.trim() === '') {
        problems.push(`${route} ${what}: a ${line.kind} line without the rule it rests on`);
      }
      if (line.kind === 'school' && !SCHOOL_RECORDS.includes(line.record)) {
        problems.push(`${route} ${what}: ${line.record} is not a record of the whole school`);
      }
      if (line.kind === 'none') {
        if (line.refusedIn.length > 0 || (line.repeatIn ?? []).length > 0) {
          problems.push(`${route} ${what}: a none line names tests`);
        }
        continue;
      }
      if (line.kind === 'school') {
        problems.push(...testProblems(route, what, line.refusedIn, readSource));
        if ((line.repeatIn ?? []).length > 0) {
          problems.push(`${route} ${what}: a school line names repeat tests`);
        }
        continue;
      }
      if (line.refusedIn.length === 0) {
        problems.push(
          `${route} ${what}: no test sends another ${line.kind === 'own' ? "account's" : "branch's"} id and an unknown one`,
        );
      }
      problems.push(...testProblems(route, what, line.refusedIn, readSource));
      const repeats = line.repeatIn ?? [];
      if (input.requestKey && line.kind === 'branch' && repeats.length === 0) {
        problems.push(
          `${route} ${what}: no test repeats a used request key with another branch's id and an unknown one`,
        );
      }
      if (!input.requestKey && repeats.length > 0) {
        problems.push(`${route} ${what}: repeat tests named, but the route takes no request key`);
      }
      problems.push(...testProblems(route, what, repeats, readSource));
    }
  }
  return problems;
}
