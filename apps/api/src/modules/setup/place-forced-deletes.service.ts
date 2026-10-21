import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  forcedDeleteSchema,
  type ErrorCode,
  type ForcedDelete,
  type ForcedDeleteBody,
  type ForcedPlaceKind,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  ForcedDeleteStore,
  type StoreDescription,
  type StoreRow,
} from '../audit/forced-deletes.service.js';
import { branchOf } from '../classes/classes.service.js';
import { PUBLISH_LOCK } from '../timetable/publish.service.js';
import { notFound } from './setup-refusals.js';

/**
 * The Super Admin's forced delete of a building, floor or room and its
 * restore (task 5.8c, pull request #196; docs/spec/03-school-setup.md,
 * Building, floor, room: "The Super Admin's forced delete (06) also removes a
 * building, floor or room that no lesson, timetable entry or other record
 * references, with a reason, an audit entry and 30 days to restore; a
 * referenced one stays archive-only").
 *
 * The record goes into the store of 5.8b (`forced_deletes`, 0105), one
 * mechanism for every kind (decision 10 of 5.8b). A building goes with its
 * floors when no room is on them (decision 2). The database is the guard
 * (0106): it deletes a place only for a store row of this transaction, and
 * refuses a referenced one, by a key (`foreign_key_violation`) or by the ids
 * kept outside keys (`place_referenced`); both are answered
 * `place_referenced` (decision 10). A restore re-checks every rule of a
 * create (decision 5) and puts back the same ids and values, an archived
 * record archived (decision 4).
 */

const FOREIGN_KEY_VIOLATION = '23503';

interface BuildingRow {
  readonly id: string;
  readonly branch_id: string;
  readonly name: string;
  readonly archived_at: string | null;
  readonly created_at: string;
}

interface FloorRow {
  readonly id: string;
  readonly branch_id: string;
  readonly building_id: string;
  readonly name: string;
  readonly archived_at: string | null;
  readonly created_at: string;
}

interface RoomRow {
  readonly id: string;
  readonly branch_id: string;
  readonly floor_id: string;
  readonly name: string;
  readonly type: string;
  readonly capacity: number;
  readonly status: string;
  readonly shared: boolean;
  readonly max_simultaneous_lessons: number | null;
  readonly created_at: string;
}

interface Named {
  readonly id: string;
  readonly name: string;
}

/** What the store keeps of a place (`forced_deletes.rows`). */
export type PlaceRows =
  | { readonly building: BuildingRow; readonly floors: readonly FloorRow[] }
  | { readonly floor: FloorRow; readonly building: Named }
  | { readonly room: RoomRow; readonly floor: Named; readonly building: Named };

/** The refusals of a restore, by the constraint the database names. */
const RESTORE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  forced_delete_expired: 'forced_delete_expired',
  forced_delete_restored: 'forced_delete_restored',
};

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** The parent of a place is gone or archived since: the place has nothing to come back into. */
const parentChanged = (
  path: string,
  message: string,
  code: ErrorCode = 'not_found',
): ApiException =>
  new ApiException('forced_delete_parent_changed', 409, undefined, [{ path, code, message }]);

/** Runs the deletes of a place; a key that still names it refuses the delete. */
async function refusingReferences<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (
      failure.code === FOREIGN_KEY_VIOLATION ||
      (typeof failure.constraint === 'string' && failure.constraint === 'place_referenced')
    ) {
      throw new ApiException('place_referenced', 409);
    }
    throw error;
  }
}

@Injectable()
export class PlaceForcedDeletes implements OnModuleInit {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly store: ForcedDeleteStore,
  ) {}

  onModuleInit(): void {
    for (const kind of ['building', 'floor', 'room'] as const) {
      this.store.register(kind, {
        describe: (_transaction, rows) => describePlaces(rows),
        restore: (transaction, access, row, requestId) =>
          this.restoreLocked(transaction, access, row, requestId),
        refusals: RESTORE_REFUSALS,
        busy: 'timetable_busy',
      });
    }
  }

  /** The forced delete of a building, floor or room with its reason, safe to repeat with its key. */
  forceDelete(
    access: Access,
    kind: ForcedPlaceKind,
    id: string,
    input: ForcedDeleteBody,
    key: string,
    requestId: string,
  ): Promise<ForcedDelete> {
    const branchId = branchOf(access);
    return busyAsTimetable(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        // The record of the branch first, so an unknown or foreign id never
        // waits on a lock; a repeat with the key finds it in the store.
        const found =
          (await transaction
            .selectFrom(tableOf(kind))
            .select('id')
            .where('id', '=', id)
            .where('branch_id', '=', branchId)
            .executeTakeFirst()) ??
          (await transaction
            .selectFrom('forced_deletes')
            .select('record_id as id')
            .where('record_type', '=', kind)
            .where('record_id', '=', id)
            .where('branch_id', '=', branchId)
            .executeTakeFirst());
        if (found === undefined) {
          throw notFound();
        }
        // Every writer of dated lessons takes this lock first; a lesson that
        // leaves a room holds it until the commit (0106), so taking it first
        // keeps the two from meeting in the other order.
        await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
        const once = await this.requestKeys.runOnce(
          transaction,
          {
            key,
            scope: `setup.${kind}_forced_delete`,
            accountId: access.accountId,
            input: { id, reason: input.reason },
          },
          async () =>
            (await this.deleteLocked(
              transaction,
              access,
              kind,
              id,
              input.reason,
              requestId,
            )) as unknown as JsonValue,
        );
        return forcedDeleteSchema.parse(once.result);
      }),
    );
  }

  private async deleteLocked(
    transaction: Transaction,
    access: Access,
    kind: ForcedPlaceKind,
    id: string,
    reason: string,
    requestId: string,
  ): Promise<ForcedDelete> {
    const branchId = branchOf(access);
    const rows = await this.lockAndRead(transaction, kind, id);
    const moment = await transactionMoment(transaction);
    const stored = await transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: branchId,
        record_type: kind,
        record_id: id,
        rows: JSON.stringify(rows),
        reason,
        deleted_by: access.accountId,
        // Overwritten by `forced_deletes_write` with the moment of the transaction.
        deleted_at: moment,
        restore_until: moment,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await refusingReferences(async () => {
      if (kind === 'building') {
        // Its floors first: their key to the building has no action.
        await transaction.deleteFrom('floors').where('building_id', '=', id).execute();
      }
      await transaction.deleteFrom(tableOf(kind)).where('id', '=', id).execute();
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: `${kind}.forced_delete`,
      record: { type: kind, id },
      oldValue: rows as unknown as JsonValue,
      newValue: { forcedDeleteId: stored.id },
      reason,
      requestId,
    });
    // The floors that went with a building, each with an entry of its own, so
    // a search of the log by the floor finds it (permission review, should-fix 4).
    if ('floors' in rows) {
      for (const floor of rows.floors) {
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'floor.forced_delete',
          record: { type: 'floor', id: floor.id },
          oldValue: floor as unknown as JsonValue,
          newValue: { forcedDeleteId: stored.id, buildingId: id },
          reason,
          requestId,
        });
      }
    }
    return this.store.answerOf(transaction, branchId, stored.id);
  }

  /**
   * The record locked `for update` (a building, then its floors in the order
   * of the id, as an archive takes them) and read as the store keeps it, with
   * the names of its building and floor. A record gone since: 404.
   */
  private async lockAndRead(
    transaction: Transaction,
    kind: ForcedPlaceKind,
    id: string,
  ): Promise<PlaceRows> {
    if (kind === 'building') {
      const building = await transaction
        .selectFrom('buildings')
        .select(['id', 'branch_id', 'name', 'archived_at', 'created_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (building === undefined) throw notFound();
      const floors = await transaction
        .selectFrom('floors')
        .select(['id', 'branch_id', 'building_id', 'name', 'archived_at', 'created_at'])
        .where('building_id', '=', id)
        .orderBy('id')
        .forUpdate()
        .execute();
      return {
        building: buildingRowOf(building),
        floors: floors.map(floorRowOf),
      };
    }
    if (kind === 'floor') {
      const floor = await transaction
        .selectFrom('floors')
        .select(['id', 'branch_id', 'building_id', 'name', 'archived_at', 'created_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (floor === undefined) throw notFound();
      const building = await transaction
        .selectFrom('buildings')
        .select(['id', 'name'])
        .where('id', '=', floor.building_id)
        .executeTakeFirstOrThrow();
      return { floor: floorRowOf(floor), building };
    }
    const room = await transaction
      .selectFrom('rooms')
      .select([
        'id',
        'branch_id',
        'floor_id',
        'name',
        'type',
        'capacity',
        'status',
        'shared',
        'max_simultaneous_lessons',
        'created_at',
      ])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (room === undefined) throw notFound();
    const floor = await transaction
      .selectFrom('floors')
      .select(['id', 'name', 'building_id'])
      .where('id', '=', room.floor_id)
      .executeTakeFirstOrThrow();
    const building = await transaction
      .selectFrom('buildings')
      .select(['id', 'name'])
      .where('id', '=', floor.building_id)
      .executeTakeFirstOrThrow();
    return {
      room: { ...room, created_at: room.created_at.toISOString() },
      floor: { id: floor.id, name: floor.name },
      building,
    };
  }

  /**
   * Puts the place back under the store's checks (decisions 4 and 5): the
   * parent locked `for share` and present, active where a create needs it
   * (a floor that comes back active needs an active building; a room needs
   * an active floor whatever its status, as `Rooms` refuses any room on an
   * archived floor); the name free under the unique indexes of 0014
   * (`already_exists`). The same ids and values come back.
   */
  private async restoreLocked(
    transaction: Transaction,
    access: Access,
    row: StoreRow,
    requestId: string,
  ): Promise<void> {
    const branchId = branchOf(access);
    const rows = row.rows as unknown as PlaceRows;
    if ('room' in rows) {
      const floor = await transaction
        .selectFrom('floors')
        .select(['id', 'archived_at'])
        .where('id', '=', rows.room.floor_id)
        .forShare()
        .executeTakeFirst();
      if (floor === undefined) {
        throw parentChanged('floor', 'The floor of the room was deleted for good since.');
      }
      if (floor.archived_at !== null) {
        throw parentChanged('floor', 'The floor of the room was archived since.', 'floor_archived');
      }
    } else if (!('floors' in rows)) {
      const building = await transaction
        .selectFrom('buildings')
        .select(['id', 'archived_at'])
        .where('id', '=', rows.floor.building_id)
        .forShare()
        .executeTakeFirst();
      if (building === undefined) {
        throw parentChanged('building', 'The building of the floor was deleted for good since.');
      }
      if (rows.floor.archived_at === null && building.archived_at !== null) {
        throw parentChanged(
          'building',
          'The building of the floor was archived since.',
          'archived_record',
        );
      }
    }
    // The store row first: the database lets the same ids back in only then.
    await transaction
      .updateTable('forced_deletes')
      .set({ restored_by: access.accountId, restored_at: new Date(0) })
      .where('id', '=', row.id)
      .execute();
    await refusingName(async () => {
      if ('room' in rows) {
        await transaction.insertInto('rooms').values(rows.room).execute();
      } else if ('floors' in rows) {
        await transaction.insertInto('buildings').values(rows.building).execute();
        if (rows.floors.length > 0) {
          await transaction
            .insertInto('floors')
            .values([...rows.floors])
            .execute();
        }
      } else {
        await transaction.insertInto('floors').values(rows.floor).execute();
      }
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'forced_delete.restore',
      record: { type: row.recordType, id: row.recordId },
      oldValue: { forcedDeleteId: row.id },
      newValue: rows as unknown as JsonValue,
      requestId,
    });
    if ('floors' in rows) {
      for (const floor of rows.floors) {
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'forced_delete.restore',
          record: { type: 'floor', id: floor.id },
          oldValue: { forcedDeleteId: row.id, buildingId: row.recordId },
          newValue: floor as unknown as JsonValue,
          requestId,
        });
      }
    }
  }
}

/** A name taken since the delete: `already_exists`, as a create. */
async function refusingName<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: unknown }).code === '23505') {
      throw new ApiException('already_exists', 409);
    }
    throw error;
  }
}

/** A deadlock or serialisation failure of a forced delete: try again. */
async function busyAsTimetable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = String((error as { code?: unknown }).code);
    if (code === '40P01' || code === '40001') {
      throw new ApiException('timetable_busy', 409);
    }
    throw error;
  }
}

function tableOf(kind: ForcedPlaceKind): 'buildings' | 'floors' | 'rooms' {
  return kind === 'building' ? 'buildings' : kind === 'floor' ? 'floors' : 'rooms';
}

function buildingRowOf(row: {
  id: string;
  branch_id: string;
  name: string;
  archived_at: Date | null;
  created_at: Date;
}): BuildingRow {
  return { ...row, archived_at: iso(row.archived_at), created_at: row.created_at.toISOString() };
}

function floorRowOf(row: {
  id: string;
  branch_id: string;
  building_id: string;
  name: string;
  archived_at: Date | null;
  created_at: Date;
}): FloorRow {
  return { ...row, archived_at: iso(row.archived_at), created_at: row.created_at.toISOString() };
}

/** The places of the store as the list shows them: the names as when they were deleted. */
function describePlaces(
  stored: readonly StoreRow[],
): Promise<ReadonlyMap<string, StoreDescription>> {
  const described = new Map<string, StoreDescription>();
  for (const one of stored) {
    const rows = one.rows as unknown as PlaceRows;
    if ('room' in rows) {
      described.set(one.id, {
        place: {
          id: rows.room.id,
          name: rows.room.name,
          building: rows.building,
          floor: rows.floor,
          floors: [],
        },
      });
    } else if ('floors' in rows) {
      described.set(one.id, {
        place: {
          id: rows.building.id,
          name: rows.building.name,
          building: null,
          floor: null,
          floors: rows.floors.map((floor) => ({ id: floor.id, name: floor.name })),
        },
      });
    } else {
      described.set(one.id, {
        place: {
          id: rows.floor.id,
          name: rows.floor.name,
          building: rows.building,
          floor: null,
          floors: [],
        },
      });
    }
  }
  return Promise.resolve(described);
}
