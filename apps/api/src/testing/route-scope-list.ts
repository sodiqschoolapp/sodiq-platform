import type { RouteScopes } from './route-scope-check.js';
import { JOURNAL_SCOPES } from './route-scopes/journal.js';
import { NARROWER_SCOPES } from './route-scopes/narrower.js';
import { OTHER_SCOPES } from './route-scopes/other.js';
import { PLANS_SCOPES } from './route-scopes/plans.js';

/**
 * For every route that lets in a role for less than its whole branch, the
 * limit and the tests that prove the refusal (task 10.3a). Written by hand,
 * like `ROUTE_ACCESS`, and read by `route-scopes.test.ts` and the checklist.
 * The `narrower` lines of whole-branch roles are in `route-scopes/narrower.ts`,
 * merged route by route with the others.
 */
export const ROUTE_SCOPE: RouteScopes = mergeScopes([
  JOURNAL_SCOPES,
  PLANS_SCOPES,
  OTHER_SCOPES,
  NARROWER_SCOPES,
]);

function mergeScopes(parts: readonly RouteScopes[]): RouteScopes {
  const merged: Record<string, RouteScopes[string]> = {};
  for (const part of parts) {
    for (const [route, lines] of Object.entries(part)) {
      merged[route] = [...(merged[route] ?? []), ...lines];
    }
  }
  return merged;
}
