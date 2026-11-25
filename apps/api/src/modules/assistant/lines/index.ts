import type { AssistantRouteLine } from '../../access/assistant-routes.js';

/**
 * Task 11.20: the lines of the routes that no list held before (`ROUTE_LINES` of
 * `access/assistant-routes.ts` merges them with those of 11.12 to 11.14), one file per module of
 * the API, by route name. Each line has its description for the model; a change says what it is
 * proposed on (`AssistantChangeLine`), as the lines of 11.13 do.
 */
export const NEW_ROUTE_LINES: Readonly<Record<string, AssistantRouteLine>> = {};
