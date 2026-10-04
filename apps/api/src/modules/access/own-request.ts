import { ApiException } from '../../http/api-exception.js';

/**
 * docs/spec/02-roles-and-access.md, "Own requests": "Nobody approves their
 * own." Called by every route that decides a request (an unlock, a plan edit),
 * after the permission guard, with the account of the session and the account
 * that made the request. It holds for every role, the Super Admin included.
 *
 * Who decides the request instead (the Senior Head Teacher, the Academic Vice
 * Principal, the Super Admin) is the routing of tasks 7.2 and 8.4.
 */
export function refuseOwnRequest(actorAccountId: string, requestedByAccountId: string): void {
  if (actorAccountId.toLowerCase() === requestedByAccountId.toLowerCase()) {
    throw new ApiException('own_request', 403);
  }
}
