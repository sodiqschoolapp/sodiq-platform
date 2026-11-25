/**
 * Task 11.21, Undo (`02`, Reading and proposing: "A confirmed proposal can be undone: the
 * assistant proposes the reverse of each change made, where an action exists that reverses it,
 * and that new proposal is confirmed like any other"). Plan decision 10: a reverse is an action
 * of the platform that undoes the change by itself (archive and restore, add and withdraw, a
 * lesson's cancel and restore); an edit of fields has none and is named so.
 *
 * Each line names the reverse route and where each of its path values comes from: the same value
 * of the change's own path, or the record the change created (`record_id`, kept at Confirm).
 * The reverse is drafted as any step (`draftStep`): its basis read, its preview and the version
 * of now, with the person's rights and switches.
 */

/** Where a path value of the reverse comes from. */
export type ReverseValue = { from: 'path'; name: string } | { from: 'record' };

export interface Reverse {
  /** `<METHOD> /api/<path>` of the reverse. */
  route: string;
  path: Readonly<Record<string, ReverseValue>>;
  /** The body of the reverse from the change's own body; none when left out. */
  body?: (changeBody: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

const SAME_ID: Readonly<Record<string, ReverseValue>> = { id: { from: 'path', name: 'id' } };
const CREATED_ID: Readonly<Record<string, ReverseValue>> = { id: { from: 'record' } };

/** The records archived on one route and restored on its sibling, by the path of the record. */
const ARCHIVED = [
  '/api/announcements/:id',
  '/api/classes/:id',
  '/api/groups/:id',
  '/api/setup/buildings/:id',
  '/api/setup/calendar-entries/:id',
  '/api/setup/day-templates/:id',
  '/api/setup/departments/:id',
  '/api/setup/divisions/:id',
  '/api/setup/floors/:id',
  '/api/setup/slot-types/:id',
  '/api/setup/subjects/:id',
] as const;

function archivePairs(): Record<string, Reverse> {
  const pairs: Record<string, Reverse> = {};
  for (const base of ARCHIVED) {
    pairs[`POST ${base}/archive`] = { route: `POST ${base}/restore`, path: SAME_ID };
    pairs[`POST ${base}/restore`] = { route: `POST ${base}/archive`, path: SAME_ID };
  }
  const master = { masterId: { from: 'path', name: 'masterId' } } as const;
  pairs['POST /api/plans/masters/:masterId/archive'] = {
    route: 'POST /api/plans/masters/:masterId/restore',
    path: master,
  };
  pairs['POST /api/plans/masters/:masterId/restore'] = {
    route: 'POST /api/plans/masters/:masterId/archive',
    path: master,
  };
  return pairs;
}

/** The reason given with the change, carried to its reverse (a substitution withdrawn). */
function sameReason(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return typeof body.reason === 'string' ? { reason: body.reason } : {};
}

export const ASSISTANT_REVERSES: Readonly<Record<string, Reverse>> = {
  ...archivePairs(),
  // A one-day cancel of a lesson and its restore (`06`, Changes after publishing).
  'POST /api/timetable/lessons/:id/cancel': {
    route: 'POST /api/timetable/lessons/:id/restore',
    path: SAME_ID,
    body: () => ({}),
  },
  // A substitution and its withdrawal.
  'POST /api/timetable/lessons/:id/substitute': {
    route: 'POST /api/timetable/lessons/:id/substitution/withdraw',
    path: SAME_ID,
    body: sameReason,
  },
  // A teacher's absence added, and withdrawn.
  'POST /api/timetable/absences': {
    route: 'POST /api/timetable/absences/:id/withdraw',
    path: CREATED_ID,
  },
  // A room closure added, and withdrawn.
  'POST /api/timetable/room-closures': {
    route: 'POST /api/timetable/room-closures/:id/withdraw',
    path: CREATED_ID,
  },
  // A day of the calendar added (a day off, a special day), and archived.
  'POST /api/setup/calendar-entries': {
    route: 'POST /api/setup/calendar-entries/:id/archive',
    path: CREATED_ID,
    body: () => ({}),
  },
  // An exam added, and cancelled.
  'POST /api/timetable/exams': {
    route: 'POST /api/timetable/exams/:id/cancel',
    path: CREATED_ID,
    body: () => ({}),
  },
  // A vacancy added, and deleted; closed, and reopened.
  'POST /api/people/vacancies': {
    route: 'POST /api/people/vacancies/:id/delete',
    path: CREATED_ID,
  },
  'POST /api/people/vacancies/:id/close': {
    route: 'POST /api/people/vacancies/:id/reopen',
    path: SAME_ID,
  },
  'POST /api/people/vacancies/:id/reopen': {
    route: 'POST /api/people/vacancies/:id/close',
    path: SAME_ID,
  },
  // An account locked, and unlocked.
  'POST /api/people/staff/:id/account/lock': {
    route: 'POST /api/people/staff/:id/account/unlock',
    path: SAME_ID,
  },
  'POST /api/people/staff/:id/account/unlock': {
    route: 'POST /api/people/staff/:id/account/lock',
    path: SAME_ID,
  },
};

/** The values of a route's path parameters in a URL of it, or `undefined` when it does not match. */
export function pathValuesOf(route: string, url: string): Record<string, string> | undefined {
  const pattern = route.slice(route.indexOf(' ') + 1).split('/');
  const parts = url.split('?')[0]?.split('/') ?? [];
  if (pattern.length !== parts.length) return undefined;
  const values: Record<string, string> = {};
  for (const [index, piece] of pattern.entries()) {
    const part = parts[index] ?? '';
    if (piece.startsWith(':')) {
      values[piece.slice(1)] = decodeURIComponent(part);
    } else if (piece !== part) {
      return undefined;
    }
  }
  return values;
}

/**
 * The path values of the reverse of a done step, or the reason there is none: `no_reverse` (no
 * line), `no_record` (a create whose answer kept no id).
 */
export function reverseOf(
  step: { route: string; url: string; body: unknown },
  recordId: string | null,
):
  | {
      reverse: Reverse;
      pathArgs: Record<string, string>;
      body: Record<string, unknown> | undefined;
    }
  | { reason: 'no_reverse' | 'no_record' } {
  const reverse = ASSISTANT_REVERSES[step.route];
  if (reverse === undefined) return { reason: 'no_reverse' };
  const own = pathValuesOf(step.route, step.url) ?? {};
  const pathArgs: Record<string, string> = {};
  for (const [name, value] of Object.entries(reverse.path)) {
    const found = value.from === 'record' ? recordId : own[value.name];
    if (found === null || found === undefined) return { reason: 'no_record' };
    pathArgs[name] = found;
  }
  const changeBody =
    step.body !== null && typeof step.body === 'object'
      ? (step.body as Record<string, unknown>)
      : {};
  return { reverse, pathArgs, body: reverse.body?.(changeBody) };
}
