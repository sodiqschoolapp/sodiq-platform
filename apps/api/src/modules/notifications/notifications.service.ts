import { Inject, Injectable } from '@nestjs/common';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_LIST_LIMIT,
  type Clock,
  type Notification,
  type NotificationData,
  type NotificationKind,
  type NotificationList,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { Json } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { deliverNotificationsJob } from './deliver.job.js';
import { notifyLive } from './live/live-payload.js';

/** What a later task gives the helper: the event, its data and the people. */
export interface NewNotification<Kind extends NotificationKind> {
  kind: Kind;
  /** What the text of the kind needs, as its schema allows it. */
  data: NotificationData<Kind>;
  /** The branch of the event; `null` for an event of the whole school. */
  branchId: string | null;
  /** The people, by account. Each gets one notification, whatever the order or repeats. */
  accountIds: readonly string[];
}

/** A row of `notifications` with the name of its branch, as the queries read it. */
interface NotificationRow {
  id: string;
  kind: string;
  data: Json;
  branch_id: string | null;
  branch_name: string | null;
  created_at: Date;
  read_at: Date | null;
}

/** The data of a row as the answer carries it. The application writes objects only. */
function dataOf(stored: Json): Record<string, unknown> {
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored : {};
}

export function toItem(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    data: dataOf(row.data),
    branchId: row.branch_id,
    branchName: row.branch_name,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at === null ? null : row.read_at.toISOString(),
  };
}

/**
 * The rows of these ids, with their branch names, in the order of the ids.
 * `branches` has no row filter: a name is not a branch's data.
 */
export async function readItems(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Notification[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await transaction
    .selectFrom('notifications')
    .leftJoin('branches', 'branches.id', 'notifications.branch_id')
    .select([
      'notifications.id',
      'notifications.kind',
      'notifications.data',
      'notifications.branch_id',
      'branches.name as branch_name',
      'notifications.created_at',
      'notifications.read_at',
    ])
    .where('notifications.id', 'in', [...ids])
    .execute();
  const byId = new Map(rows.map((row) => [row.id, toItem(row)]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
}

/**
 * Notifications to staff in the app (docs/spec/10-portal-notifications-release-2.md,
 * Notifications, last paragraph). One row per person and event; the text is
 * made in the browser from the kind and its data (decided by the owner). A
 * later task calls `send` from the transaction of the change itself, whose
 * audit entry covers the event: the helper writes no entry of its own, and
 * none for a read mark (decided by the owner).
 */
@Injectable()
export class Notifications {
  constructor(
    private readonly transactions: Transactions,
    private readonly jobs: Jobs,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Writes one notification per account and enqueues their delivery, in the
   * caller's transaction: if it rolls back, nothing was sent. Returns the ids
   * of the rows, in the order of the accounts (each once).
   */
  async send<Kind extends NotificationKind>(
    transaction: Transaction,
    notification: NewNotification<Kind>,
  ): Promise<string[]> {
    const schema: unknown = Object.hasOwn(NOTIFICATION_KINDS, notification.kind)
      ? NOTIFICATION_KINDS[notification.kind]
      : undefined;
    if (schema === undefined) {
      throw new Error('The kind of the notification is not in the list of kinds.');
    }
    const checked = NOTIFICATION_KINDS[notification.kind].safeParse(notification.data);
    if (!checked.success) {
      // The values are not repeated: they may hold names.
      throw new Error(`The data of a "${notification.kind}" notification does not fit its kind.`);
    }
    const accountIds = [...new Set(notification.accountIds.map((id) => id.toLowerCase()))];
    if (accountIds.length === 0) {
      throw new Error('A notification needs at least one account to go to.');
    }
    if (notification.branchId !== null) {
      // The branch is a label, but a transaction must not label an event with
      // a branch it does not work for.
      const filter = await sql<{ ids: string[] }>`
        select app_branch_ids()::text[] as ids
      `.execute(transaction);
      const own = new Set(filter.rows[0]?.ids.map((id) => id.toLowerCase()));
      if (!own.has(notification.branchId.toLowerCase())) {
        throw new Error(
          'A notification was given a branch that its transaction does not work for.',
        );
      }
    }
    const now = this.clock.now();
    const data = sql<Json>`${JSON.stringify(checked.data)}::jsonb`;
    const inserted = await transaction
      .insertInto('notifications')
      .values(
        accountIds.map((accountId) => ({
          account_id: accountId,
          branch_id: notification.branchId,
          kind: notification.kind,
          data,
          created_at: now,
        })),
      )
      .returning(['id', 'account_id'])
      .execute();
    const byAccount = new Map(inserted.map((row) => [row.account_id, row.id]));
    const ids = accountIds.flatMap((accountId) => {
      const id = byAccount.get(accountId);
      return id === undefined ? [] : [id];
    });
    await this.jobs.enqueue(transaction, deliverNotificationsJob, {
      branchIds: [],
      data: { notificationIds: ids },
    });
    return ids;
  }

  /** The latest notifications of the account, newest first, and how many are unread. */
  async list(accountId: string): Promise<NotificationList> {
    return this.transactions.run([], (transaction) => this.listIn(transaction, accountId));
  }

  async listIn(transaction: Transaction, accountId: string): Promise<NotificationList> {
    const rows = await transaction
      .selectFrom('notifications')
      .leftJoin('branches', 'branches.id', 'notifications.branch_id')
      .select([
        'notifications.id',
        'notifications.kind',
        'notifications.data',
        'notifications.branch_id',
        'branches.name as branch_name',
        'notifications.created_at',
        'notifications.read_at',
      ])
      .where('notifications.account_id', '=', accountId)
      .orderBy('notifications.created_at', 'desc')
      .orderBy('notifications.id', 'desc')
      .limit(NOTIFICATION_LIST_LIMIT)
      .execute();
    const unread = await transaction
      .selectFrom('notifications')
      .select((builder) => builder.fn.countAll<string>().as('n'))
      .where('account_id', '=', accountId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return { unreadCount: Number(unread.n), items: rows.map(toItem) };
  }

  /**
   * Marks one notification of the account read. One that is read already
   * changes nothing; one of another account, or none, is answered as not
   * found. The other tabs of the person are told in the same transaction.
   */
  async markRead(accountId: string, id: string): Promise<void> {
    const now = this.clock.now();
    await this.transactions.run([], async (transaction) => {
      const marked = await transaction
        .updateTable('notifications')
        .set({ read_at: now })
        .where('id', '=', id)
        .where('account_id', '=', accountId)
        .where('read_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (marked !== undefined) {
        await notifyLive(transaction, {
          kind: 'read',
          accountId,
          ids: [id],
          readAt: now.toISOString(),
        });
        return;
      }
      const own = await transaction
        .selectFrom('notifications')
        .select('id')
        .where('id', '=', id)
        .where('account_id', '=', accountId)
        .executeTakeFirst();
      if (own === undefined) {
        throw new ApiException('not_found', 404);
      }
    });
  }

  /** Marks every unread notification of the account read, and tells the other tabs once. */
  async markAllRead(accountId: string): Promise<void> {
    const now = this.clock.now();
    await this.transactions.run([], async (transaction) => {
      const marked = await transaction
        .updateTable('notifications')
        .set({ read_at: now })
        .where('account_id', '=', accountId)
        .where('read_at', 'is', null)
        .returning('id')
        .execute();
      if (marked.length > 0) {
        await notifyLive(transaction, { kind: 'read_all', accountId, readAt: now.toISOString() });
      }
    });
  }
}
