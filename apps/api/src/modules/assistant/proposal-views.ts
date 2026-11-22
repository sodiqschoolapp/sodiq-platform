import type { AssistantProposal, AssistantProposalState, AssistantStepState } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import type { StoredStep } from './proposals.js';

/** The proposals of a conversation with their decisions and step outcomes, oldest first. */
export async function proposalsOf(
  transaction: Transaction,
  conversationId: string,
  now: Date,
): Promise<AssistantProposal[]> {
  const rows = await transaction
    .selectFrom('assistant_proposals as p')
    .leftJoin('assistant_proposal_decisions as d', 'd.proposal_id', 'p.id')
    .select([
      'p.id',
      'p.question_id',
      'p.steps',
      'p.created_at',
      'p.expires_at',
      'd.decision',
      'd.decided_at',
    ])
    .where('p.conversation_id', '=', conversationId)
    .orderBy('p.created_at')
    .orderBy('p.id')
    .execute();
  const outcomes =
    rows.length === 0
      ? []
      : await transaction
          .selectFrom('assistant_proposal_steps')
          .select(['step_id', 'state', 'status', 'code'])
          .where(
            'proposal_id',
            'in',
            rows.map((row) => row.id),
          )
          .execute();
  const byStep = new Map(outcomes.map((outcome) => [outcome.step_id, outcome]));
  return rows.map((row, index) => {
    const state = proposalState(
      row.decision as 'confirmed' | 'declined' | null,
      new Date(row.expires_at),
      index < rows.length - 1,
      now,
    );
    const steps = row.steps as unknown as StoredStep[];
    return {
      id: row.id,
      questionId: row.question_id,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      state,
      decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
      steps: steps.map((step) => {
        const outcome = byStep.get(step.id);
        const stepState: AssistantStepState =
          outcome !== undefined
            ? (outcome.state as AssistantStepState)
            : state === 'confirmed'
              ? 'unknown'
              : 'waiting';
        return {
          id: step.id,
          seq: step.seq,
          action: step.action,
          group: step.group,
          summary: step.summary,
          recordName: step.shown.recordName,
          fields: step.shown.fields,
          previewLessons: step.shown.previewLessons,
          previewMore: step.shown.previewMore,
          state: stepState,
          status: outcome?.status ?? 0,
          code: outcome?.code ?? null,
        };
      }),
    };
  });
}

/**
 * The state of a proposal from its stored moments (`CLAUDE.md`, State from stored moments): a
 * decision when there is one; otherwise superseded by a later proposal of the conversation
 * (decision 17), or expired when its 15 minutes are over, or waiting.
 */
export function proposalState(
  decision: 'confirmed' | 'declined' | null,
  expiresAt: Date,
  later: boolean,
  now: Date,
): AssistantProposalState {
  if (decision !== null) return decision;
  if (later) return 'superseded';
  return expiresAt.getTime() <= now.getTime() ? 'expired' : 'waiting';
}
