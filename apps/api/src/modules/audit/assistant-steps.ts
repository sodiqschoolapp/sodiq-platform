import { sql, type RawBuilder } from 'kysely';
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
/**
 * The words of a question (code review of #390, finding 1): what was typed, and for a recorded
 * question the words written out from it, stored after it as the read `transcribe_voice` of the
 * same question (before any later question); both, the written-out words first, when both exist.
 */
function wordsOf(
  conversationId: RawBuilder<unknown>,
  seq: RawBuilder<unknown>,
  content: RawBuilder<unknown>,
): RawBuilder<unknown> {
  return sql`
    select nullif(concat_ws(E'\n', (
      select t.content -> 'result' ->> 'transcript' from assistant_messages t
      where (${content} ->> 'voice') = 'true'
        and t.conversation_id = ${conversationId} and t.kind = 'read'
        and t.content ->> 'tool' = 'transcribe_voice' and t.seq > ${seq}
        and not exists (
          select 1 from assistant_messages n
          where n.conversation_id = ${conversationId} and n.kind = 'question'
            and n.seq > ${seq} and n.seq < t.seq
        )
      order by t.seq limit 1
    ), nullif(${content} ->> 'text', '')), '') as words
  `;
}

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
    select s.value ->> 'id' as step_id, p.account_id, p.conversation_id, w.words as question
    from assistant_proposals p
    cross join lateral jsonb_array_elements(p.steps) s
    join assistant_messages m on m.id = p.question_id and m.branch_id = p.branch_id
    cross join lateral (${wordsOf(sql.ref('m.conversation_id'), sql.ref('m.seq'), sql.ref('m.content'))}) w
    where s.value ->> 'id' = any(${ids}::text[])
    union all
    -- Task 11.22: the run of an import upload or an export the assistant sent, stored with its
    -- read; the question is the last one before it in the conversation.
    select r.content ->> 'runId' as step_id, r.account_id, r.conversation_id, w.words as question
    from assistant_messages r
    left join lateral (
      select q.seq, q.content from assistant_messages q
      where q.conversation_id = r.conversation_id and q.kind = 'question' and q.seq < r.seq
      order by q.seq desc limit 1
    ) q on true
    left join lateral (${wordsOf(sql.ref('r.conversation_id'), sql.ref('q.seq'), sql.ref('q.content'))}) w on true
    where r.kind = 'read' and r.content ->> 'runId' = any(${ids}::text[])
  `.execute(transaction);
  return new Map(
    rows.rows.map((row) => [
      row.step_id,
      {
        accountId: row.account_id,
        conversationId: row.conversation_id,
        question: row.question ?? '',
      },
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
