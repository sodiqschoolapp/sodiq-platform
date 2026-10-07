/**
 * The branch the tab works in, for the header `X-Branch-Id` of the API client
 * (docs/decisions.md, task 0.4b: a branch never comes from the path, the query
 * or the body). The branch switcher sets it; the server checks it on every
 * request, so a wrong value is refused there and never widens a right.
 */
let branchInUse: string | null = null;

export const setBranchInUse = (branchId: string | null): void => {
  branchInUse = branchId;
};

export const getBranchInUse = (): string | null => branchInUse;
