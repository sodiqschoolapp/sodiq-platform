import type { PlanWindowState } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { PlanQuarter } from './plan-read.js';
import {
  periodCovers,
  periodOpen,
  windowStateOf,
  type GateOp,
  type GateRow,
  type OpenPeriod,
  type StoredWindow,
} from './plan-window.js';

/**
 * The gate of every plan write (task 7.2, pull request #215; `09`: "Inside
 * the window teachers create and edit their plans freely." "Nothing opens
 * without an approved request"). Read after the plan's journals are locked
 * (`lockPlanOf`), so a "finished", a refusal or a separation committed
 * meanwhile is seen.
 */

/** The first moment of `date` and the last of `last`, branch time (review decision 7: a day ends one millisecond before the next). */
export async function dayMoments(
  transaction: Transaction,
  date: string,
  last: string,
  timeZone: string,
): Promise<{ startsAt: Date; endsAt: Date }> {
  const { rows } = await sql<{ starts_at: Date; next_start: Date }>`
    select (${date}::date::timestamp at time zone ${timeZone}) as starts_at,
      ((${last}::date + 1)::timestamp at time zone ${timeZone}) as next_start
  `.execute(transaction);
  const row = rows[0];
  if (row === undefined) throw new Error('dayMoments: no answer');
  return { startsAt: row.starts_at, endsAt: new Date(row.next_start.getTime() - 1) };
}

/** The window of a quarter with the extension in force for one person. */
export async function storedWindowOf(
  transaction: Transaction,
  quarter: PlanQuarter,
  staffId: string | null,
  timeZone: string,
): Promise<(StoredWindow & { readonly id: string; startDate: string; endDate: string }) | null> {
  const window = await transaction
    .selectFrom('lesson_plan_windows')
    .select([
      'id',
      'starts_at',
      'ends_at',
      sql<string>`start_date::text`.as('start_date'),
      sql<string>`end_date::text`.as('end_date'),
    ])
    .where('quarter_id', '=', quarter.id)
    .executeTakeFirst();
  if (window === undefined) return null;
  const extension =
    staffId === null
      ? undefined
      : await transaction
          .selectFrom('lesson_plan_window_extensions')
          .select('ends_at')
          .where('window_id', '=', window.id)
          .where('staff_id', '=', staffId)
          .orderBy('granted_at', 'desc')
          .orderBy('id', 'desc')
          .executeTakeFirst();
  const { endsAt: quarterEndsAt } = await dayMoments(
    transaction,
    quarter.endDate,
    quarter.endDate,
    timeZone,
  );
  return {
    id: window.id,
    startsAt: window.starts_at,
    endsAt: window.ends_at,
    quarterEndsAt,
    extensionEndsAt: extension?.ends_at ?? null,
    startDate: window.start_date,
    endDate: window.end_date,
  };
}

/**
 * `storedWindowOf` for every quarter and person named at once (task 10.1b: the plan list asked
 * it three queries per plan). The same values, keyed `<quarter id>|<staff id or ''>`.
 */
export async function storedWindowsOf(
  transaction: Transaction,
  quarters: readonly PlanQuarter[],
  staffIds: readonly (string | null)[],
  timeZone: string,
): Promise<
  Map<string, (StoredWindow & { readonly id: string; startDate: string; endDate: string }) | null>
> {
  const found = new Map<
    string,
    (StoredWindow & { readonly id: string; startDate: string; endDate: string }) | null
  >();
  if (quarters.length === 0) return found;
  const windows = await transaction
    .selectFrom('lesson_plan_windows')
    .select([
      'id',
      'quarter_id',
      'starts_at',
      'ends_at',
      sql<string>`start_date::text`.as('start_date'),
      sql<string>`end_date::text`.as('end_date'),
    ])
    .where(
      'quarter_id',
      'in',
      quarters.map((quarter) => quarter.id),
    )
    .execute();
  const people = [...new Set(staffIds.flatMap((id) => (id === null ? [] : [id])))];
  const extensions =
    windows.length === 0 || people.length === 0
      ? []
      : await transaction
          .selectFrom('lesson_plan_window_extensions')
          .select(['window_id', 'staff_id', 'ends_at'])
          .where(
            'window_id',
            'in',
            windows.map((window) => window.id),
          )
          .where('staff_id', 'in', people)
          .orderBy('granted_at', 'desc')
          .orderBy('id', 'desc')
          .execute();
  // The latest extension of each window and person, as `storedWindowOf` takes it.
  const latest = new Map<string, Date>();
  for (const one of extensions) {
    const key = `${one.window_id}|${one.staff_id}`;
    if (!latest.has(key)) latest.set(key, one.ends_at);
  }
  for (const quarter of quarters) {
    const window = windows.find((one) => one.quarter_id === quarter.id);
    for (const staffId of new Set(staffIds)) {
      found.set(`${quarter.id}|${staffId ?? ''}`, null);
    }
    if (window === undefined) continue;
    const { endsAt: quarterEndsAt } = await dayMoments(
      transaction,
      quarter.endDate,
      quarter.endDate,
      timeZone,
    );
    for (const staffId of new Set(staffIds)) {
      found.set(`${quarter.id}|${staffId ?? ''}`, {
        id: window.id,
        startsAt: window.starts_at,
        endsAt: window.ends_at,
        quarterEndsAt,
        extensionEndsAt: staffId === null ? null : (latest.get(`${window.id}|${staffId}`) ?? null),
        startDate: window.start_date,
        endDate: window.end_date,
      });
    }
  }
  return found;
}

/** The approved requests of a plan's journal whose period is open now, with their ticked lessons. */
export async function openPeriodsOf(
  transaction: Transaction,
  planId: string,
  journalId: string,
  now: Date,
): Promise<OpenPeriod[]> {
  const requests = await transaction
    .selectFrom('lesson_plan_requests')
    .select([
      'id',
      'kind',
      'status',
      sql<string | null>`from_date::text`.as('from_date'),
      'open_until',
      'finished_at',
      'decided_by',
    ])
    .where('plan_id', '=', planId)
    .where('journal_id', '=', journalId)
    .where('status', '=', 'approved')
    .orderBy('id')
    .execute();
  const open = requests.filter((one) =>
    periodOpen({ openUntil: one.open_until, finishedAt: one.finished_at, status: one.status }, now),
  );
  if (open.length === 0) return [];
  const lessons = await transaction
    .selectFrom('lesson_plan_request_lessons')
    .select(['request_id', 'lesson_id'])
    .where(
      'request_id',
      'in',
      open.map((one) => one.id),
    )
    .where('approved', '=', true)
    .execute();
  return open.map((one) => ({
    requestId: one.id,
    kind: one.kind as OpenPeriod['kind'],
    fromDate: one.from_date,
    lessonIds: lessons.filter((row) => row.request_id === one.id).map((row) => row.lesson_id),
    approvedBy: one.decided_by ?? '',
  }));
}

/** What a write touches in one journal of the plan. */
export interface GateTarget {
  readonly journalId: string;
  readonly rows: readonly GateRow[];
  readonly op: GateOp;
}

/** How a write was let through: the window, or the periods of these requests. */
export interface GatePass {
  readonly via: 'window' | 'request';
  readonly periods: readonly OpenPeriod[];
}

/** The refusal of a write outside the window with no period that covers it. */
export function windowRefusal(state: PlanWindowState): ApiException {
  return new ApiException(state === 'ended' ? 'plan_window_closed' : 'plan_window_not_open', 409);
}

/**
 * Lets a write through when the writer's window is open, else when, in every
 * journal of the plan, every row the write touches is covered by an open
 * period of that journal (review decision 7 of the plan: the cover holds in
 * every journal of a shared plan).
 */
export async function passGate(
  transaction: Transaction,
  input: {
    readonly planId: string;
    readonly quarter: PlanQuarter;
    readonly staffId: string | null;
    readonly timeZone: string;
    readonly now: Date;
    readonly targets: readonly GateTarget[];
    /** A share joins only inside the window (`edge`: "Joining is allowed only inside the window"). */
    readonly windowOnly?: boolean;
  },
): Promise<GatePass> {
  const window = await storedWindowOf(transaction, input.quarter, input.staffId, input.timeZone);
  const { state } = windowStateOf(window, input.now);
  if (state === 'open') return { via: 'window', periods: [] };
  if (input.windowOnly === true) throw windowRefusal(state);
  const used = new Map<string, OpenPeriod>();
  for (const target of input.targets) {
    const periods = await openPeriodsOf(transaction, input.planId, target.journalId, input.now);
    // An extension covers what the window covers.
    const extension = periods.find((period) => period.kind === 'extension');
    if (extension !== undefined) {
      used.set(extension.requestId, extension);
      continue;
    }
    for (const row of target.rows) {
      const period = periods.find((one) => periodCovers(one, row, target.op));
      if (period === undefined) throw windowRefusal(state);
      used.set(period.requestId, period);
    }
  }
  if (used.size === 0) throw windowRefusal(state);
  return { via: 'request', periods: [...used.values()] };
}

/** The audit detail of a write let through by requests (`09`: "old text, new text, who approved"). */
export function gateDetail(
  pass: GatePass,
): { requests: { id: string; approvedBy: string }[] } | null {
  if (pass.via === 'window') return null;
  return {
    requests: pass.periods.map((period) => ({
      id: period.requestId,
      approvedBy: period.approvedBy,
    })),
  };
}

/**
 * The plans' journals with a new owner's or a new journal's request still
 * running (`edge`: "The plan counts as overdue only after that approved
 * period ends"): prepared, sent, or approved with its period not ended.
 * Keyed `<plan>|<journal>`.
 */
export async function ownerPeriodsOf(
  transaction: Transaction,
  planIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  if (planIds.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('lesson_plan_requests')
    .innerJoin(
      'lesson_plan_request_causes',
      'lesson_plan_request_causes.request_id',
      'lesson_plan_requests.id',
    )
    .select(['lesson_plan_requests.plan_id', 'lesson_plan_requests.journal_id'])
    .where('lesson_plan_requests.plan_id', 'in', [...planIds])
    .where('lesson_plan_request_causes.kind', 'in', ['owner_changed', 'journal_added'])
    .where((builder) =>
      builder.or([
        builder('lesson_plan_requests.status', 'in', ['prepared', 'sent']),
        builder.and([
          builder('lesson_plan_requests.status', '=', 'approved'),
          builder('lesson_plan_requests.finished_at', 'is', null),
          builder('lesson_plan_requests.open_until', '>=', now),
        ]),
      ]),
    )
    .execute();
  return new Set(rows.map((row) => `${row.plan_id}|${row.journal_id}`));
}
