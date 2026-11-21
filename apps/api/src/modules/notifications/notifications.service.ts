import { Inject, Injectable } from '@nestjs/common';
import {
  INTEGRATION_KEY_ROLES,
  NOTIFICATION_KINDS,
  type NoticeRole,
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
import { chunks, notifyLive } from './live/live-payload.js';

/**
 * One person a notice goes to, and the role or roles by which the sender chose them (task
 * 10.11): the post that made them a recipient (the teacher of the lesson, the class Tutor, the
 * Head Teacher of the subject …). At least one; the database refuses a notice without
 * (`notifications_for_roles_check`, `notifications_for_roles_required`, 0177).
 */
export interface NotificationRecipient {
  accountId: string;
  for: readonly NoticeRole[];
}

/** Each account told for the same role. */
export function toEach(accountIds: readonly string[], role: NoticeRole): NotificationRecipient[] {
  return accountIds.map((accountId) => ({ accountId, for: [role] }));
}

/**
 * Who reads the notices: the account, and whether through an integration key. Through a key
 * only the notices sent for a Teacher, Head Teacher or Senior Head Teacher role are read
 * (`02`, Integration keys: "Their other roles do not count through a key"; task 10.11); a
 * notice stored before 10.11 names no role and is never read through a key.
 */
export interface NoticeReader {
  accountId: string;
  throughKey: boolean;
}

/** The roles whose notices a key reads. */
const KEY_NOTICE_ROLES: readonly string[] = INTEGRATION_KEY_ROLES;

/** What a later task gives the helper: the event, its data and the people. */
export interface NewNotification<Kind extends NotificationKind> {
  kind: Kind;
  /** What the text of the kind needs, as its schema allows it. */
  data: NotificationData<Kind>;
  /** The branch of the event; `null` for an event of the whole school. */
  branchId: string | null;
  /**
   * The people, by account, each with the roles they were chosen for. Each gets one
   * notification, whatever the order or repeats; a repeated account's roles are joined.
   */
  to: readonly NotificationRecipient[];
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

/** A notification as the answer carries it, and whose it is. */
export interface OwnedItem {
  accountId: string;
  item: Notification;
}

/**
 * The rows of these ids, with their branch names, in the order of the ids.
 * `branches` has no row filter: a name is not a branch's data.
 */
export async function readItems(
  transaction: Transaction,
  ids: readonly string[],
): Promise<OwnedItem[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await transaction
    .selectFrom('notifications')
    .leftJoin('branches', 'branches.id', 'notifications.branch_id')
    .select([
      'notifications.id',
      'notifications.account_id',
      'notifications.kind',
      'notifications.data',
      'notifications.branch_id',
      'branches.name as branch_name',
      'notifications.created_at',
      'notifications.read_at',
    ])
    .where('notifications.id', 'in', [...ids])
    .execute();
  const byId = new Map(
    rows.map((row): [string, OwnedItem] => [
      row.id,
      { accountId: row.account_id, item: toItem(row) },
    ]),
  );
  return ids.flatMap((id) => {
    const owned = byId.get(id);
    return owned === undefined ? [] : [owned];
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
    const rolesOf = new Map<string, Set<NoticeRole>>();
    for (const recipient of notification.to) {
      const accountId = recipient.accountId.toLowerCase();
      const roles = rolesOf.get(accountId) ?? new Set<NoticeRole>();
      for (const role of recipient.for) roles.add(role);
      rolesOf.set(accountId, roles);
    }
    const accountIds = [...rolesOf.keys()];
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
          // An empty list is refused by the database (0177), never stored as "none".
          for_roles: [...(rolesOf.get(accountId) ?? [])].sort(),
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

  /**
   * The latest notifications of the reader, newest first, and how many are unread. Through a
   * key only the notices sent for its roles, in the list and in the count alike.
   */
  async list(reader: NoticeReader): Promise<NotificationList> {
    return this.transactions.run([], (transaction) => this.listIn(transaction, reader));
  }

  async listIn(transaction: Transaction, reader: NoticeReader): Promise<NotificationList> {
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
      .where('notifications.account_id', '=', reader.accountId)
      .$if(reader.throughKey, (query) => query.where(keyReadable('notifications.for_roles')))
      .orderBy('notifications.created_at', 'desc')
      .orderBy('notifications.id', 'desc')
      .limit(NOTIFICATION_LIST_LIMIT)
      .execute();
    const unread = await transaction
      .selectFrom('notifications')
      .select((builder) => builder.fn.countAll<string>().as('n'))
      .where('account_id', '=', reader.accountId)
      .where('read_at', 'is', null)
      .$if(reader.throughKey, (query) => query.where(keyReadable('for_roles')))
      .executeTakeFirstOrThrow();
    return { unreadCount: Number(unread.n), items: rows.map(toItem) };
  }

  /**
   * Marks one notification of the reader read. One that is read already
   * changes nothing; one of another account, one a key may not read, or none,
   * is answered as not found and left as it is. The other tabs of the person
   * are told in the same transaction.
   */
  async markRead(reader: NoticeReader, id: string): Promise<void> {
    const now = this.clock.now();
    const { accountId } = reader;
    await this.transactions.run([], async (transaction) => {
      const marked = await transaction
        .updateTable('notifications')
        .set({ read_at: now })
        .where('id', '=', id)
        .where('account_id', '=', accountId)
        .where('read_at', 'is', null)
        .$if(reader.throughKey, (query) => query.where(keyReadable('for_roles')))
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
        .$if(reader.throughKey, (query) => query.where(keyReadable('for_roles')))
        .executeTakeFirst();
      if (own === undefined) {
        throw new ApiException('not_found', 404);
      }
    });
  }

  /**
   * Marks every unread notification of the reader read, and tells the other tabs. In a
   * session: every notice, told once with `read_all`. Through a key: only the notices it
   * reads, told by their ids (at most `LIVE_CHUNK` a payload, within the size NOTIFY takes)
   * and then with a fresh state, so a session tab neither marks the others read nor keeps a
   * count that is too high (task 10.11, decision 8 of pull request #371).
   */
  async markAllRead(reader: NoticeReader): Promise<void> {
    const now = this.clock.now();
    const { accountId } = reader;
    await this.transactions.run([], async (transaction) => {
      const marked = await transaction
        .updateTable('notifications')
        .set({ read_at: now })
        .where('account_id', '=', accountId)
        .where('read_at', 'is', null)
        .$if(reader.throughKey, (query) => query.where(keyReadable('for_roles')))
        .returning('id')
        .execute();
      if (marked.length === 0) {
        return;
      }
      if (!reader.throughKey) {
        await notifyLive(transaction, { kind: 'read_all', accountId, readAt: now.toISOString() });
        return;
      }
      for (const ids of chunks(marked.map((row) => row.id))) {
        await notifyLive(transaction, { kind: 'read', accountId, ids, readAt: now.toISOString() });
      }
      await notifyLive(transaction, { kind: 'state', accountId });
    });
  }
}

/** A notice a key reads: sent for one of its roles. A stored null (before 10.11) never is. */
function keyReadable(column: 'for_roles' | 'notifications.for_roles') {
  return sql<boolean>`coalesce(${sql.ref(column)} && ${sql.val([...KEY_NOTICE_ROLES])}::text[], false)`;
}
