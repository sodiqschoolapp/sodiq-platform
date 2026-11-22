import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/** A step of a proposal as an audit entry names it (task 11.13). */
export interface AssistantStepOrigin {
  accountId: string;
  conversationId: string;
  question: string;
}

/**
 * The proposals' steps that audit entries name, with the question each came from (`02`, Audit:
 * "the audit log shows the request it came from"), read through the transaction's branches.
 * The question is the person's words as they were stored; the filter of what never goes to
 * the model is applied by the caller.
 */
export async function assistantStepsOf(
  transaction: Transaction,
  stepIds: readonly (string | null)[],
): Promise<Map<string, AssistantStepOrigin>> {
  const ids = [...new Set(stepIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await sql<{
    step_id: string;
    account_id: string;
    conversation_id: string;
    question: string | null;
  }>`
    select s.value ->> 'id' as step_id, p.account_id, p.conversation_id,
      m.content ->> 'text' as question
    from assistant_proposals p
    cross join lateral jsonb_array_elements(p.steps) s
    join assistant_messages m on m.id = p.question_id and m.branch_id = p.branch_id
    where s.value ->> 'id' = any(${ids}::text[])
  `.execute(transaction);
  return new Map(
    rows.rows.map((row) => [
      row.step_id,
      { accountId: row.account_id, conversationId: row.conversation_id, question: row.question ?? '' },
    ]),
  );
}

/** `viaAssistant` of an entry: the question, and the conversation for its person or the Super Admin. */
export function viaAssistantOf(
  steps: ReadonlyMap<string, AssistantStepOrigin>,
  stepId: string | null,
  reader: { accountId: string; readsConversations: boolean } | undefined,
  filter: (text: string) => string = (text) => text,
): { question: string; conversationId: string | null } | null {
  if (stepId === null) {
    return null;
  }
  const step = steps.get(stepId);
  if (step === undefined) {
    // Not readable in this transaction's branches: the mark alone.
    return { question: '', conversationId: null };
  }
  const linked =
    reader !== undefined && (reader.readsConversations || reader.accountId === step.accountId);
  return { question: filter(step.question), conversationId: linked ? step.conversationId : null };
}
