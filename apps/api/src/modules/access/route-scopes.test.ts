import { describe, expect, it } from 'vitest';
import { ROUTE_ACCESS } from '../../testing/route-access-list.js';
import {
  scopeProblems,
  staticSegments,
  type RouteScopes,
} from '../../testing/route-scope-check.js';
import { ROUTE_SCOPE } from '../../testing/route-scope-list.js';

/**
 * docs/spec/02-roles-and-access.md, Rules: "Every role is limited to a branch,
 * and where it applies to subjects, a class or own lessons. ... The limit is
 * enforced on the server". The guard decides role and branch, and the role
 * harness (`route-permissions.test.ts`) proves those; the limit inside a route
 * is the route's own check. This list names, for every route that lets in a
 * Tutor, a Teacher, a Head Teacher or a Senior Head Teacher, the limit of each
 * and the test that proves the refusal (task 10.3a).
 */
describe('the limits inside the routes', () => {
  it('are named, with a test, for every scoped role of every route', () => {
    expect(scopeProblems(ROUTE_ACCESS, ROUTE_SCOPE)).toEqual([]);
  });
});

// The list is only worth something if it sees a difference.
describe('the check of the limits', () => {
  const access = {
    'GET /api/sample/journals/:id/cells': {
      branch: 'request',
      roles: ['super_admin', 'principal', 'teacher', 'head_teacher'],
    },
    'GET /api/sample/branch': { branch: 'request', roles: ['super_admin', 'tutor'] },
    'GET /api/sample/own': 'any_signed_in',
  } as const;
  const sources: Record<string, string> = {
    'src/sample/cells.test.ts': `
      describe('the cells', () => {
        it('are refused to a teacher of another journal', async () => {
          await request(app).get(\`/api/sample/journals/\${id}/cells\`);
        });
      });`,
    'src/sample/other.test.ts': `it('is something else', () => {});`,
  };
  const read = (file: string): string | undefined => sources[file];

  it('passes a complete list', () => {
    const scopes: RouteScopes = {
      'GET /api/sample/journals/:id/cells': [
        {
          roles: ['teacher'],
          scope: 'own_lessons',
          rule: '02, Teacher: journals of own classes and groups',
          refusedIn: ['src/sample/cells.test.ts > are refused to a teacher of another journal'],
        },
        {
          roles: ['head_teacher'],
          scope: 'subjects',
          rule: '02, Head Teacher: own subjects',
          refusedIn: ['src/sample/cells.test.ts > the cells'],
        },
      ],
      'GET /api/sample/branch': [
        {
          roles: ['tutor'],
          scope: 'branch',
          rule: '02, Tutor: the school timetable',
          refusedIn: [],
        },
      ],
    };

    expect(scopeProblems(access, scopes, read)).toEqual([]);
  });

  it('names a role left out, a test that does not exist, a file that does not name the route and a stray line', () => {
    const scopes: RouteScopes = {
      'GET /api/sample/journals/:id/cells': [
        {
          roles: ['teacher'],
          scope: 'own_lessons',
          rule: '02, Teacher',
          refusedIn: [
            'src/sample/cells.test.ts > is refused to nobody',
            'src/sample/other.test.ts > is something else',
            'src/sample/gone.test.ts > anything',
          ],
        },
        { roles: ['principal'], scope: 'subjects', rule: 'none', refusedIn: [] },
      ],
      'GET /api/sample/branch': [{ roles: ['tutor'], scope: 'class', rule: '', refusedIn: [] }],
      'GET /api/sample/own': [{ roles: ['tutor'], scope: 'branch', rule: 'x', refusedIn: [] }],
      'GET /api/sample/removed': [],
    };

    expect(scopeProblems(access, scopes, read)).toEqual([
      'GET /api/sample/journals/:id/cells: 0 scope lines for head_teacher, it needs exactly one',
      'GET /api/sample/journals/:id/cells: principal is a whole-branch role; its limit is "narrower"',
      'GET /api/sample/journals/:id/cells: src/sample/cells.test.ts has no test "is refused to nobody"',
      'GET /api/sample/journals/:id/cells: src/sample/other.test.ts never names sample, journals, cells of the route',
      'GET /api/sample/journals/:id/cells: src/sample/gone.test.ts does not exist',
      'GET /api/sample/journals/:id/cells: no test proves the subjects limit of principal',
      'GET /api/sample/branch: a class line without the rule it rests on',
      'GET /api/sample/branch: no test proves the class limit of tutor',
      'GET /api/sample/own: in the scope list, but the route is any_signed_in',
      'GET /api/sample/removed: in the scope list, but no such route is listed',
    ]);
  });

  it('reads the parts of a path that a test writes as they are', () => {
    expect(staticSegments('POST /api/journal/cells/:cellId/history')).toEqual([
      'journal',
      'cells',
      'history',
    ]);
  });
});
