import type { AssistantRole } from '@sodiq/shared';
import type { SessionPass } from '../../http/session-cookie.js';
import type { AssistantDispatcher, ReadOutcome } from './dispatcher.js';

/**
 * Task 11.14 (review of the code, finding 1). `02`, Assistant, "What a Teacher can do through it":
 * "Read their own … lesson plans". The plan page lets a teacher of the same subject and grade
 * read a colleague's plan (`edge/lesson-plans`, "Who may read a plan?"), so a plan read through
 * the assistant in the Teacher role is narrowed further: it is given only when the person's own
 * read of the plan's journal answers, which it does for the journals the person keeps
 * (`journal_scope` otherwise). A plan of someone else is refused as a screen refuses a plan
 * outside the reader's scope (`plan_scope`), and nothing of it reaches the model.
 */
export const NOT_OWN_PLAN: ReadOutcome = {
  status: 403,
  body: { error: { code: 'plan_scope', message: 'This plan is not the reader’s own.' } },
};

/** Where a read line finds the journal its answer belongs to. */
export type OwnJournal = { path: string } | { answer: string };

/** The journal named by the read: a path value, or a field of its answer. */
export function journalOf(
  own: OwnJournal,
  pathArgs: Readonly<Record<string, unknown>>,
  outcome: ReadOutcome,
): string | undefined {
  const value =
    'path' in own
      ? pathArgs[own.path]
      : outcome.failure === undefined && outcome.body !== null && typeof outcome.body === 'object'
        ? (outcome.body as Record<string, unknown>)[own.answer]
        : undefined;
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

/** `NOT_OWN_PLAN` unless the person's own read of the journal answers; `undefined` when it does. */
export async function refusedUnlessOwnJournal(
  dispatcher: AssistantDispatcher,
  as: { pass: SessionPass; branchId: string; role: AssistantRole },
  journalId: string | undefined,
): Promise<ReadOutcome | undefined> {
  if (journalId === undefined) return NOT_OWN_PLAN;
  const journal = await dispatcher.read(`/api/journal/journals/${journalId}`, as);
  return journal.failure === undefined && journal.status === 200 ? undefined : NOT_OWN_PLAN;
}

/** Where a list read holds its records and the journal of each (task 11.14, review round 2). */
export interface OwnJournalList {
  /** The array of the answer. */
  array: string;
  /** The key of each record that names its journal. */
  key: string;
}

/**
 * A list answer with only the records of the person's own journals: those on the person's own
 * journal list of the same year (`GET /api/journal/journals`, which answers the journals the
 * person keeps). `02`: "Read their own … lesson plans"; the plan list of the screen also holds
 * the plans a teacher of the same subject and grade may read (`edge/lesson-plans`), and its
 * records name no owner. When the own list cannot be read, nothing of the list is given.
 */
export async function ownRecordsOnly(
  dispatcher: AssistantDispatcher,
  as: { pass: SessionPass; branchId: string; role: AssistantRole },
  list: OwnJournalList,
  outcome: ReadOutcome,
): Promise<ReadOutcome> {
  if (outcome.failure !== undefined || outcome.status !== 200) return outcome;
  const body = outcome.body as Record<string, unknown> | null;
  const records = body?.[list.array];
  if (body === null || !Array.isArray(records)) return NOT_OWN_PLAN;
  const yearId = typeof body.yearId === 'string' ? body.yearId : undefined;
  const journals = await dispatcher.read(
    `/api/journal/journals${yearId === undefined ? '' : `?yearId=${encodeURIComponent(yearId)}`}`,
    as,
  );
  if (journals.failure !== undefined || journals.status !== 200) return NOT_OWN_PLAN;
  const own = new Set(
    ((journals.body as { journals?: { id?: unknown }[] } | null)?.journals ?? [])
      .map((one) => one.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  return {
    status: outcome.status,
    body: {
      ...body,
      [list.array]: records.filter(
        (record) =>
          record !== null &&
          typeof record === 'object' &&
          own.has(String((record as Record<string, unknown>)[list.key])),
      ),
    },
  };
}
