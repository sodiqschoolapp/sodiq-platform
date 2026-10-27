import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Role } from '@sodiq/shared';
import type { ExpectedAccess } from './route-harness.js';

/**
 * The roles that a route lets in for less than their whole branch: own
 * subjects, own class, own lessons, the students taught, own requests
 * (`docs/spec/02-roles-and-access.md`, Rules: "Every role is limited to a
 * branch, and where it applies to subjects, a class or own lessons").
 */
export const SCOPED_ROLES: readonly Role[] = [
  'tutor',
  'teacher',
  'head_teacher',
  'senior_head_teacher',
];

/**
 * What a route holds a role to inside the route, which the guard cannot see:
 *
 * - `subjects`: the subjects of the Head Teacher's or Senior Head Teacher's appointment;
 * - `class`: the Tutor's own class or classes;
 * - `own_lessons`: the lessons, journals and plans the person teaches;
 * - `taught_students`: the students of the person's classes and groups in the teaching load in force;
 * - `own_requests`: the requests the person sent, or that are routed to the person's post;
 * - `own_record`: the person's own staff record;
 * - `branch`: the whole branch, by the spec line named in `rule` (nothing to refuse inside it);
 * - `narrower`: a whole-branch role held to less in the route (a field group, an
 *   export without contact fields, the accounts whose passwords it may reset).
 */
export type Scope =
  | 'subjects'
  | 'class'
  | 'own_lessons'
  | 'taught_students'
  | 'own_requests'
  | 'own_record'
  | 'branch'
  | 'narrower';

/** One limit of a route, for the roles named. */
export interface ScopeLine {
  roles: readonly Role[];
  scope: Scope;
  /** The spec line or decision that sets the limit. */
  rule: string;
  /**
   * The tests that call the route as one of these roles outside the limit and
   * see it refused: `<file under apps/api> > <title of the it, test or describe>`.
   * Empty only for `branch`.
   */
  refusedIn: readonly string[];
}

export type RouteScopes = Readonly<Record<string, readonly ScopeLine[]>>;

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether the file holds an `it`, `test` or `describe` (also `.each`, `.skip`-free) with exactly this title. */
function hasTitle(source: string, title: string): boolean {
  const quoted = escapeRegExp(title);
  const call = String.raw`\b(?:it|test|describe)(?:\.each\([\s\S]*?\))?\(\s*`;
  return ['\x27', '"', '`'].some((quote) =>
    new RegExp(`${call}${quote}${quoted}${quote}`).test(source),
  );
}

/** The parts of a route's path that a test writes as they are: `/api/journal/cells/:id/history` gives `journal`, `cells`, `history`. */
export function staticSegments(route: string): string[] {
  const pathPart = route.slice(route.indexOf(' ') + 1);
  return pathPart
    .split('/')
    .filter((part) => part !== '' && part !== 'api' && !part.startsWith(':'));
}

/**
 * What is wrong with the list of limits, read against the list of who may call
 * each route and the test files: an empty list means every route that lets in
 * a scoped role names, for each such role, its limit and the test that proves
 * the refusal, and every test named exists and names the route.
 */
export function scopeProblems(
  access: Readonly<Record<string, ExpectedAccess>>,
  scopes: RouteScopes,
  readSource: (file: string) => string | undefined = readTestFile,
): string[] {
  const problems: string[] = [];
  for (const [route, listed] of Object.entries(access)) {
    if (typeof listed === 'string') {
      continue;
    }
    const scoped = listed.roles.filter((role) => SCOPED_ROLES.includes(role));
    const lines = scopes[route] ?? [];
    for (const role of scoped) {
      const own = lines.filter((line) => line.scope !== 'narrower' && line.roles.includes(role));
      if (own.length !== 1) {
        problems.push(
          `${route}: ${String(own.length)} scope lines for ${role}, it needs exactly one`,
        );
      }
    }
    for (const line of lines) {
      for (const role of line.roles) {
        if (!listed.roles.includes(role)) {
          problems.push(`${route}: a line for ${role}, whom the route refuses`);
        }
        if (line.scope !== 'narrower' && !SCOPED_ROLES.includes(role)) {
          problems.push(`${route}: ${role} is a whole-branch role; its limit is "narrower"`);
        }
      }
    }
  }
  for (const [route, lines] of Object.entries(scopes)) {
    const listed = access[route];
    if (listed === undefined) {
      problems.push(`${route}: in the scope list, but no such route is listed`);
      continue;
    }
    if (typeof listed === 'string') {
      problems.push(`${route}: in the scope list, but the route is ${listed}`);
      continue;
    }
    for (const line of lines) {
      if (line.rule.trim() === '') {
        problems.push(`${route}: a ${line.scope} line without the rule it rests on`);
      }
      if (line.scope === 'branch') {
        if (line.refusedIn.length > 0) {
          problems.push(`${route}: a branch line names tests, but there is nothing to refuse`);
        }
        continue;
      }
      if (line.refusedIn.length === 0) {
        problems.push(
          `${route}: no test proves the ${line.scope} limit of ${line.roles.join(', ')}`,
        );
      }
      for (const named of line.refusedIn) {
        const cut = named.indexOf(' > ');
        if (cut < 0) {
          problems.push(`${route}: "${named}" is not "<file> > <title>"`);
          continue;
        }
        const file = named.slice(0, cut);
        const title = named.slice(cut + 3);
        const source = readSource(file);
        if (source === undefined) {
          problems.push(`${route}: ${file} does not exist`);
          continue;
        }
        if (!hasTitle(source, title)) {
          problems.push(`${route}: ${file} has no test "${title}"`);
        }
        const missing = staticSegments(route).filter((segment) => !source.includes(segment));
        if (missing.length > 0) {
          problems.push(`${route}: ${file} never names ${missing.join(', ')} of the route`);
        }
      }
    }
  }
  return problems;
}

function readTestFile(file: string): string | undefined {
  if (!file.endsWith('.test.ts') || file.includes('..')) {
    return undefined;
  }
  try {
    return readFileSync(path.join(API_ROOT, file), 'utf8');
  } catch {
    return undefined;
  }
}
