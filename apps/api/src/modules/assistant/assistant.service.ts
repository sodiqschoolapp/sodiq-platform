import { Injectable } from '@nestjs/common';
import type {
  AssistantAllConversations,
  AssistantAllConversationsQuery,
  AssistantAnyConversationDetail,
  AssistantConversation,
  AssistantConversationList,
  AssistantRole,
  AssistantStatus,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { AssistantEngine } from './assistant.engine.js';
import { AssistantFiles } from './assistant-files.service.js';
import type { StoredFile } from '../../http/stored-file.js';
import { AssistantSettingsService, MICROS_PER_DOLLAR } from './assistant-settings.service.js';
import {
  conversationOf,
  conversationsQuery,
  isArchived,
  personNames,
  summaryOf,
} from './conversations.store.js';

/**
 * The conversations of the assistant (`02`, Assistant, Audit: "The person sees their own
 * conversations; the Super Admin sees all of them. 90 days after its last message a
 * conversation is archived: it leaves the person's list, and the Super Admin reads it and can
 * restore it. Conversations are never deleted."), and the status of the panel.
 */
@Injectable()
export class AssistantConversations {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly settings: AssistantSettingsService,
    private readonly engine: AssistantEngine,
    private readonly files: AssistantFiles,
  ) {}

  /**
   * Task 11.22: a file of the person's own conversation, under the rule of reading one (a branch
   * and role held now, not archived); anything else 404.
   */
  async ownFile(
    access: Access,
    held: readonly HeldRole[],
    fileId: string,
    requestId: string,
  ): Promise<StoredFile> {
    return this.files.ownDownload(
      access,
      (row) => holds(held, row),
      await this.everyBranch(),
      fileId,
      requestId,
    );
  }

  /** Task 11.22 (review of the plan, correction 3): the Super Admin's download of any file. */
  async anyFile(
    access: Access,
    conversationId: string,
    fileId: string,
    requestId: string,
  ): Promise<StoredFile> {
    return this.files.anyDownload(
      access,
      await this.everyBranch(),
      conversationId,
      fileId,
      requestId,
    );
  }

  /** Every branch, so that a person's own conversations of every branch are read (decision 9). */
  private async everyBranch(): Promise<string[]> {
    return this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
  }

  private async inEveryBranch<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.transactions.run(await this.everyBranch(), work);
  }

  async status(access: Access, role: AssistantRole): Promise<AssistantStatus> {
    if (!this.engine.roleHeld(access, role)) {
      throw new ApiException('assistant_role_not_held', 403);
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      const switches = await this.settings.switches(transaction);
      const asked = await this.settings.questionsToday(transaction, access.accountId, now);
      const spend = await this.settings.spendThisMonth(transaction, now);
      // Task 11.21: a daily limit of 0 is none (review of the plan, must fix 2).
      const left = switches.dailyLimit === 0 ? null : Math.max(0, switches.dailyLimit - asked);
      const refusal =
        !switches.schoolOn || !switches.rolesOn.includes(role)
          ? 'assistant_off'
          : left === 0
            ? 'assistant_daily_limit'
            : spend >= BigInt(switches.monthlyCapDollars) * MICROS_PER_DOLLAR
              ? 'assistant_cap_reached'
              : this.settings.modelName() === null
                ? 'assistant_model_unavailable'
                : null;
      return {
        available: refusal === null,
        refusal,
        questionsLeftToday: left,
        files: this.files.configured,
      };
    });
  }

  /**
   * The person's own conversations, not archived, of the branches and roles they hold now (task
   * 11.13, decision 3 of the plan of pull request #376, Look first): a person who left a branch
   * or a role no longer reads the answers given there; the Super Admin reads them all.
   */
  async own(access: Access, held: readonly HeldRole[]): Promise<AssistantConversationList> {
    return this.inEveryBranch(async (transaction) => {
      const now = await transactionMoment(transaction);
      const rows = await conversationsQuery(transaction)
        .where('c.account_id', '=', access.accountId)
        .execute();
      return {
        conversations: rows
          .filter((row) => holds(held, row))
          .filter((row) => !isArchived(new Date(row.last_activity_at), now))
          .sort(newestFirst)
          .map(summaryOf),
      };
    });
  }

  /** One own conversation, not archived, of a branch and role held now; anything else is 404. */
  async ownOne(
    access: Access,
    held: readonly HeldRole[],
    id: string,
  ): Promise<AssistantConversation> {
    return this.inEveryBranch(async (transaction) => {
      const now = await transactionMoment(transaction);
      const row = await conversationsQuery(transaction)
        .where('c.id', '=', id)
        .where('c.account_id', '=', access.accountId)
        .executeTakeFirst();
      if (
        row === undefined ||
        !holds(held, row) ||
        isArchived(new Date(row.last_activity_at), now)
      ) {
        throw new ApiException('not_found', 404);
      }
      return conversationOf(transaction, row, now);
    });
  }

  /** The Super Admin's list of every conversation of the school. */
  async all(query: AssistantAllConversationsQuery): Promise<AssistantAllConversations> {
    return this.inEveryBranch(async (transaction) => {
      const now = await transactionMoment(transaction);
      const rows = await conversationsQuery(transaction).execute();
      const names = await personNames(
        transaction,
        rows.map((row) => row.account_id),
      );
      const wanted = query.archived === undefined ? undefined : query.archived === 'true';
      return {
        conversations: rows
          .map((row) => ({ row, archived: isArchived(new Date(row.last_activity_at), now) }))
          .filter(({ archived }) => wanted === undefined || archived === wanted)
          .sort((a, b) => newestFirst(a.row, b.row))
          .map(({ row, archived }) => ({
            ...summaryOf(row),
            archived,
            personName: names.get(row.account_id) ?? '',
          })),
      };
    });
  }

  async any(id: string): Promise<AssistantAnyConversationDetail> {
    return this.inEveryBranch(async (transaction) => {
      const now = await transactionMoment(transaction);
      const row = await conversationsQuery(transaction).where('c.id', '=', id).executeTakeFirst();
      if (row === undefined) {
        throw new ApiException('not_found', 404);
      }
      const names = await personNames(transaction, [row.account_id]);
      return {
        ...(await conversationOf(transaction, row, now)),
        personName: names.get(row.account_id) ?? '',
      };
    });
  }

  /**
   * Restores an archived conversation: a restore row from the clock's moment, so it is back in
   * its person's list for 90 days (decision 8). Written in the conversation's own branch, with
   * its audit entry in the same transaction.
   */
  async restore(
    access: Access,
    id: string,
    requestId: string,
  ): Promise<AssistantAnyConversationDetail> {
    const branchId = await this.inEveryBranch(async (transaction) => {
      const row = await transaction
        .selectFrom('assistant_conversations')
        .select('branch_id')
        .where('id', '=', id)
        .executeTakeFirst();
      return row?.branch_id;
    });
    if (branchId === undefined) {
      throw new ApiException('not_found', 404);
    }
    await this.transactions.run([branchId], async (transaction) => {
      const now = await transactionMoment(transaction);
      const row = await conversationsQuery(transaction).where('c.id', '=', id).executeTakeFirst();
      if (row === undefined) {
        throw new ApiException('not_found', 404);
      }
      if (!isArchived(new Date(row.last_activity_at), now)) {
        throw new ApiException('assistant_not_archived', 409);
      }
      await transaction
        .insertInto('assistant_conversation_restores')
        .values({
          conversation_id: id,
          branch_id: branchId,
          restored_by: access.accountId,
          restored_at: now,
        })
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'assistant_conversation.restore',
        record: { type: 'assistant_conversation', id },
        newValue: { restoredAt: now.toISOString() },
        requestId,
      });
    });
    return this.any(id);
  }
}

function newestFirst(
  a: { last_activity_at: Date | string },
  b: { last_activity_at: Date | string },
): number {
  return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime();
}

/** A role the person holds now, with its branch (`null`: every branch). */
export interface HeldRole {
  role: string;
  branchId: string | null;
}

/** Whether the person holds the conversation's role in its branch now. */
function holds(held: readonly HeldRole[], row: { role: string; branch_id: string }): boolean {
  return held.some(
    (one) => one.role === row.role && (one.branchId === null || one.branchId === row.branch_id),
  );
}
