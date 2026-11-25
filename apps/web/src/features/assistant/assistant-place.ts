import type { AssistantPlace } from '@sodiq/shared';

/** The part of a match of the router a place is read from. */
export interface PlaceMatch {
  fullPath: string;
  params: object;
  search: object;
}

const MAX_PARAMS = 4;
const MAX_SEARCH = 12;

/**
 * Task 11.19 (`02`, Assistant, "Knows where the person is"): the page the panel is beside, as
 * the router names it (`/journal/$journalId`), with its path parameters and its search values
 * (`open`, a tab, a journal's `quarter`, `date` and `mode`). Only texts are sent, and the
 * filters of a list (`f`) as texts; the server keeps only what the map records for the page.
 */
export function placeOf(match: PlaceMatch | undefined): AssistantPlace | undefined {
  if (match === undefined || match.fullPath === '' || match.fullPath.length > 200) return undefined;
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(match.params)) {
    if (Object.keys(params).length >= MAX_PARAMS) break;
    if (typeof value === 'string' && name.length <= 40 && value.length <= 100) params[name] = value;
  }
  const search: Record<string, string | Record<string, string>> = {};
  for (const [name, value] of Object.entries(match.search)) {
    if (Object.keys(search).length >= MAX_SEARCH || name.length > 40) continue;
    if (typeof value === 'string' && value.length <= 200) search[name] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') search[name] = String(value);
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const filters = Object.entries(value).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[0].length <= 40 && entry[1].length <= 100,
      );
      if (filters.length > 0 && filters.length <= 12) search[name] = Object.fromEntries(filters);
    }
  }
  return {
    page: match.fullPath.length > 1 ? match.fullPath.replace(/\/$/, '') : match.fullPath,
    ...(Object.keys(params).length === 0 ? {} : { params }),
    ...(Object.keys(search).length === 0 ? {} : { search }),
  };
}
