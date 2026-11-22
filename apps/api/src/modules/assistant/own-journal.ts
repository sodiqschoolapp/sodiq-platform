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
