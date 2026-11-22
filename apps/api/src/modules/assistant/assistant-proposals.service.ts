import { Injectable } from '@nestjs/common';
import type { AssistantConversation, AssistantRole, AssistantStepState } from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { SessionPass } from '../../http/session-cookie.js';
import { AssistantCalls } from '../access/assistant-calls.js';
import { AssistantRoutes } from '../access/assistant-routes.check.js';
import type { Access } from '../access/permission.guard.js';
import { AssistantEngine } from './assistant.engine.js';
import { AssistantSettingsService } from './assistant-settings.service.js';
import { fingerprintOf } from './canonical.js';
import { conversationOf, conversationsQuery, isArchived } from './conversations.store.js';
import { AssistantDispatcher } from './dispatcher.js';
import { basisStill, stateOfOutcome, type StoredStep } from './proposals.js';

interface ProposalRow {
  id: string;
  conversation_id: string;
  branch_id: string;
  account_id: string;
  question_id: string;
  role: string;
  steps: unknown;
  created_at: Date;
  expires_at: Date;
}

/**
 * Confirm and Decline (task 11.13; `02`, Reading and proposing: "Nothing changes until the
 * person presses Confirm. Each change then goes through the same action as on the screen, in
 * order; the first change refused stops the rest"). Confirm never calls the model
 * (`edge/people-roles-accounts`: "A proposal already shown can still be confirmed, because
 * confirming does not call the model"), and no transaction is held across a step.
 */
@Injectable()
export class AssistantProposals {
  constructor(
    private readonly transactions: Transactions,
    private readonly settings: AssistantSettingsService,
    private readonly engine: AssistantEngine,
    private readonly dispatcher: AssistantDispatcher,
    private readonly calls: AssistantCalls,
    private readonly routes: AssistantRoutes,
  ) {}

  /** The checks of both decisions, in the transaction that writes the decision. */
  private async decidable(
    transaction: Transaction,
    access: Access,
    id: string,
    role: AssistantRole,
    now: Date,
  ): Promise<ProposalRow> {
    // Another person's, another branch's (the row filter) and an unknown one alike: 404.
    const proposal = await transaction
      .selectFrom('assistant_proposals')
      .selectAll()
      .where('id', '=', id)
      .where('account_id', '=', access.accountId)
      .executeTakeFirst();
    if (proposal === undefined) {
      throw new ApiException('not_found', 404);
    }
    const conversation = await conversationsQuery(transaction)
      .where('c.id', '=', proposal.conversation_id)
      .executeTakeFirstOrThrow();
    if (isArchived(new Date(conversation.last_activity_at), now)) {
      throw new ApiException('not_found', 404);
    }
    // The rights in force at this moment (`edge/people-roles-accounts`: "Confirm runs each
    // change with the rights in force at that moment").
    if (!this.engine.roleHeld(access, role)) {
      throw new ApiException('assistant_role_not_held', 403);
    }
    if (proposal.role !== role) {
      throw new ApiException('assistant_conversation_other_role', 409);
    }
    const decided = await transaction
      .selectFrom('assistant_proposal_decisions')
      .select('decision')
      .where('proposal_id', '=', id)
      .executeTakeFirst();
    if (decided !== undefined) {
      throw new ApiException('assistant_proposal_decided', 409);
    }
    const later = await transaction
      .selectFrom('assistant_proposals')
      .select('id')
      .where('conversation_id', '=', proposal.conversation_id)
      .where((eb) =>
        eb.or([
          eb('created_at', '>', proposal.created_at),
          eb.and([eb('created_at', '=', proposal.created_at), eb('id', '>', proposal.id)]),
        ]),
      )
      .executeTakeFirst();
    if (later !== undefined) {
      throw new ApiException('assistant_proposal_superseded', 409);
    }
    if (new Date(proposal.expires_at).getTime() <= now.getTime()) {
      throw new ApiException('assistant_proposal_expired', 409);
    }
    // The Super Admin's switch stops Confirm too; the daily limit and the cap do not
    // (decision 9).
    const switches = await this.settings.switches(transaction);
    if (!switches.schoolOn || !switches.rolesOn.includes(role)) {
      throw new ApiException('assistant_off', 409);
    }
    return proposal;
  }

  /** Writes the decision; a second at the same moment meets the primary key (decision 10). */
  private async decide(
    access: Access,
    id: string,
    role: AssistantRole,
    decision: 'confirmed' | 'declined',
  ): Promise<ProposalRow> {
    try {
      return await this.transactions.run(access.branchIds, async (transaction) => {
        const now = await transactionMoment(transaction);
        const proposal = await this.decidable(transaction, access, id, role, now);
        await transaction
          .insertInto('assistant_proposal_decisions')
          .values({
            proposal_id: proposal.id,
            branch_id: proposal.branch_id,
            account_id: proposal.account_id,
            decision,
            decided_at: now,
          })
          .execute();
        return proposal;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException('assistant_proposal_decided', 409);
      }
      throw error;
    }
  }

  async decline(access: Access, id: string, role: AssistantRole): Promise<AssistantConversation> {
    const proposal = await this.decide(access, id, role, 'declined');
    return this.conversation(access, proposal.conversation_id);
  }

  async confirm(
    access: Access,
    pass: SessionPass,
    id: string,
    role: AssistantRole,
  ): Promise<AssistantConversation> {
    const proposal = await this.decide(access, id, role, 'confirmed');
    const steps = proposal.steps as StoredStep[];
    const lines = this.routes.linesOf(role);
    const as = { pass, branchId: proposal.branch_id, role };
    let stopped = false;
    for (const step of steps) {
      if (stopped) {
        await this.record(proposal, step, { state: 'not_run', status: 0, code: null });
        continue;
      }
      const line = lines[step.route];
      let outcome: { state: AssistantStepState; status: number; code: string | null };
      if (line?.kind !== 'change') {
        // The route left the role's list since it was proposed.
        outcome = { state: 'refused', status: 403, code: 'assistant_route_closed' };
      } else if (
        step.basis.kind === 'read' &&
        !basisStill(step.basis, await this.dispatcher.read(step.basis.url, as))
      ) {
        outcome = { state: 'outdated', status: 409, code: 'assistant_step_outdated' };
      } else if (step.preview !== null && !(await this.previewStill(step.preview, as))) {
        // A lesson that began, a new warning, another lesson with data (review should fix 5).
        outcome = { state: 'outdated', status: 409, code: 'assistant_step_outdated' };
      } else {
        const sent = await this.calls.whileRunning(
          {
            stepId: step.id,
            accountId: access.accountId,
            branchId: proposal.branch_id,
            role,
            route: step.route,
          },
          () =>
            this.dispatcher.send(step.method, step.url, step.body ?? undefined, {
              ...as,
              stepId: step.id,
            }),
        );
        outcome = stateOfOutcome(sent, line.outdatedCodes ?? []);
      }
      await this.record(proposal, step, outcome);
      if (outcome.state !== 'done') {
        stopped = true;
      }
    }
    return this.conversation(access, proposal.conversation_id);
  }

  private async previewStill(
    preview: NonNullable<StoredStep['preview']>,
    as: { pass: SessionPass; branchId: string; role: AssistantRole },
  ): Promise<boolean> {
    const outcome = await this.dispatcher.send('POST', preview.url, preview.body, as);
    return (
      !('failure' in outcome && outcome.failure !== undefined) &&
      outcome.status < 400 &&
      fingerprintOf(outcome.body) === preview.fingerprint
    );
  }

  private async record(
    proposal: ProposalRow,
    step: StoredStep,
    outcome: { state: AssistantStepState; status: number; code: string | null },
  ): Promise<void> {
    if (outcome.state === 'unknown' || outcome.state === 'waiting') {
      // No outcome row: a confirmed step without one is shown "not known: check the page",
      // the state of decision 12's interrupted step.
      return;
    }
    await this.transactions.run([proposal.branch_id], async (transaction) => {
      await transaction
        .insertInto('assistant_proposal_steps')
        .values({
          step_id: step.id,
          proposal_id: proposal.id,
          branch_id: proposal.branch_id,
          seq: step.seq,
          state: outcome.state,
          status: outcome.status,
          code: outcome.code,
          created_at: await transactionMoment(transaction),
        })
        .execute();
    });
  }

  private async conversation(access: Access, id: string): Promise<AssistantConversation> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      const row = await conversationsQuery(transaction)
        .where('c.id', '=', id)
        .executeTakeFirstOrThrow();
      return conversationOf(transaction, row, now);
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
