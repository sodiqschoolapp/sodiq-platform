import { BRANCH_HEADER } from '@sodiq/shared';
import createClient from 'openapi-fetch';
import { getBranchInUse } from './branch-in-use';
import type { paths } from './schema.generated';

/**
 * The only way the web app calls the API. Paths, inputs and answers are typed
 * from the OpenAPI document of the API (`pnpm api:client`), so browser and
 * server cannot disagree about a field.
 */
export const api = createClient<paths>({
  // Web app and API share one origin; the paths of the document start with /api.
  baseUrl: window.location.origin,
  // Looked up on each call, not once at start.
  fetch: (request) => globalThis.fetch(request),
});

// The branch of the branch switcher goes with every call; a route that is not
// bound to a branch ignores it.
api.use({
  onRequest({ request }) {
    const branchId = getBranchInUse();
    if (branchId !== null) {
      request.headers.set(BRANCH_HEADER, branchId);
    }
    return request;
  },
});
