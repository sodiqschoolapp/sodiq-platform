import { Inject, Injectable } from '@nestjs/common';
import {
  ASSISTANT_ROLES,
  ASSISTANT_TIME_ZONE,
  permits,
  type AssistantRole,
  type AssistantSettings,
  type AssistantSettingsRecord,
  type PermissionTable,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { PERMISSION_TABLE } from '../access/permission-table.token.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { ASSISTANT_MODEL, type AssistantModel } from './model.js';

/** Micro-dollars in a dollar. */
export const MICROS_PER_DOLLAR = 1_000_000n;

export interface AssistantSwitches {
  schoolOn: boolean;
  rolesOn: AssistantRole[];
  dailyLimit: number;
  monthlyCapDollars: number;
  /** Task 11.15: the worldwide fallback. */
  fallbackOn: boolean;
}

/** The start and the end of the school day or month of a moment, in Asia/Tashkent. */
async function periodOf(
  transaction: Transaction,
  unit: 'day' | 'month',
  now: Date,
): Promise<{ from: Date; until: Date }> {
  const step = unit === 'day' ? sql`interval '1 day'` : sql`interval '1 month'`;
  const unitText = unit === 'day' ? 'day' : 'month';
  const found = await sql<{ from_moment: Date; until_moment: Date }>`
    select
      date_trunc(${unitText}, ${now}::timestamptz at time zone ${ASSISTANT_TIME_ZONE})
        at time zone ${ASSISTANT_TIME_ZONE} as from_moment,
      (date_trunc(${unitText}, ${now}::timestamptz at time zone ${ASSISTANT_TIME_ZONE}) + ${step})
        at time zone ${ASSISTANT_TIME_ZONE} as until_moment
  `.execute(transaction);
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error('No period was read.');
  }
  return { from: new Date(row.from_moment), until: new Date(row.until_moment) };
}

/**
 * The assistant's switches and limits (`02`, Assistant: "The Super Admin can switch it off for
 * the whole school or for one of the three roles; it is off until switched on"; Limits: "A limit
 * of requests per person per day, and a monthly spending cap for the school: $300 at the start
 * …, which the Super Admin can change"). One school-wide row (0178), audited as a setting.
 */
@Injectable()
export class AssistantSettingsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(PERMISSION_TABLE) private readonly table: PermissionTable,
    @Inject(ASSISTANT_MODEL) private readonly model: AssistantModel,
  ) {}

  /** The name of the model, or `null` when the server has none set up. */
  modelName(): string | null {
    return this.model.name;
  }

  /** The roles the permission table gives the panel now (plan decision 20). */
  rolesWithPanel(): AssistantRole[] {
    return ASSISTANT_ROLES.filter((role) => permits(this.table, role, 'assistant', 'view'));
  }

  async switches(transaction: Transaction): Promise<AssistantSwitches> {
    const row = await transaction
      .selectFrom('assistant_settings')
      .select(['school_on', 'roles_on', 'daily_limit', 'monthly_cap_dollars', 'fallback_on'])
      .executeTakeFirstOrThrow();
    return {
      schoolOn: row.school_on,
      rolesOn: ASSISTANT_ROLES.filter((role) => row.roles_on.includes(role)),
      dailyLimit: row.daily_limit,
      monthlyCapDollars: row.monthly_cap_dollars,
      fallbackOn: row.fallback_on,
    };
  }

  /** The person's questions of the school day of `now`, every branch together (decision 10). */
  async questionsToday(transaction: Transaction, accountId: string, now: Date): Promise<number> {
    const day = await periodOf(transaction, 'day', now);
    const found = await sql<{ count: string }>`
      select assistant_questions_between(${accountId}::uuid, ${day.from}, ${day.until}) as count
    `.execute(transaction);
    return Number(found.rows[0]?.count ?? 0);
  }

  /** The school's spend of the calendar month of `now`, in whole micro-dollars. */
  async spendThisMonth(transaction: Transaction, now: Date): Promise<bigint> {
    const month = await periodOf(transaction, 'month', now);
    const found = await sql<{ spend: string }>`
      select assistant_spend_between(${month.from}, ${month.until}) as spend
    `.execute(transaction);
    return BigInt(found.rows[0]?.spend ?? '0');
  }

  /**
   * Task 11.15: the questions of the school's calendar month of `now` with a call through the
   * worldwide endpoint (`02`, Where the model runs), the month of the cap.
   */
  async fallbackQuestionsThisMonth(transaction: Transaction, now: Date): Promise<number> {
    const month = await periodOf(transaction, 'month', now);
    const found = await sql<{ count: string }>`
      select assistant_fallback_questions_between(${month.from}, ${month.until}) as count
    `.execute(transaction);
    return Number(found.rows[0]?.count ?? 0);
  }

  private async viewIn(transaction: Transaction): Promise<AssistantSettings> {
    const now = await transactionMoment(transaction);
    const switches = await this.switches(transaction);
    const spend = await this.spendThisMonth(transaction, now);
    return {
      ...switches,
      roles: this.rolesWithPanel(),
      // Whole cents, rounded down, for the page only: the cap compares micro-dollars.
      spentThisMonthCents: Number(spend / 10_000n),
      fallbackQuestionsThisMonth: await this.fallbackQuestionsThisMonth(transaction, now),
      modelConfigured: this.model.name !== null,
      model: this.model.name,
    };
  }

  async view(): Promise<AssistantSettings> {
    return this.transactions.run([], (transaction) => this.viewIn(transaction));
  }

  async change(
    access: Access,
    record: AssistantSettingsRecord,
    requestId: string,
  ): Promise<AssistantSettings> {
    return this.transactions.run([], async (transaction) => {
      const before = await this.switches(transaction);
      // Locked by the update itself; a second change waits for this one.
      await transaction
        .updateTable('assistant_settings')
        .set({
          school_on: record.schoolOn,
          roles_on: ASSISTANT_ROLES.filter((role) => record.rolesOn.includes(role)),
          daily_limit: record.dailyLimit,
          monthly_cap_dollars: record.monthlyCapDollars,
          fallback_on: record.fallbackOn,
        })
        .execute();
      const after = await this.switches(transaction);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'assistant_settings.change',
          oldValue: { ...before },
          newValue: { ...after },
          requestId,
        });
      }
      return this.viewIn(transaction);
    });
  }
}
