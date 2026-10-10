import { Inject, Injectable } from '@nestjs/common';
import type {
  Building,
  BuildingList,
  BuildingRecord,
  Clock,
  Floor,
  FloorRecord,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { notFound, refusingDuplicates } from './setup-refusals.js';

interface FloorRow {
  id: string;
  building_id: string;
  name: string;
  archived_at: Date | null;
  /** A count; `null` is how the type of a subquery is written, never what it answers. */
  room_count: string | number | bigint | null;
}

const moment = (at: Date | null): string | null => (at === null ? null : at.toISOString());

function toFloor(row: FloorRow): Floor {
  return {
    id: row.id,
    name: row.name,
    archivedAt: moment(row.archived_at),
    roomCount: Number(row.room_count ?? 0),
  };
}

/** The floors of a branch, oldest first, each with how many rooms it holds. */
function floorsIn(transaction: Transaction) {
  return transaction
    .selectFrom('floors')
    .select((builder) => [
      'floors.id',
      'floors.building_id',
      'floors.name',
      'floors.archived_at',
      builder
        .selectFrom('rooms')
        .whereRef('rooms.floor_id', '=', 'floors.id')
        .select(builder.fn.countAll().as('n'))
        .as('room_count'),
    ])
    .orderBy('floors.created_at')
    .orderBy('floors.id');
}

/**
 * Buildings and floors (docs/spec/03-school-setup.md, Building, floor, room:
 * "Rooms are added floor by floor"; owner: Super Admin). Archived, never
 * deleted (`12`, No lost work; CLAUDE.md): a building or a floor is archived
 * only once every room on it is closed, and restored later (decided by the
 * owner, pull request #37, answer 7). Every change writes its audit entry in
 * the same transaction, with the assignment that allowed it.
 */
@Injectable()
export class Buildings {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async readBuilding(transaction: Transaction, id: string): Promise<Building> {
    const row = await transaction
      .selectFrom('buildings')
      .select(['id', 'name', 'archived_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    const floors = await floorsIn(transaction).where('floors.building_id', '=', id).execute();
    return {
      id: row.id,
      name: row.name,
      archivedAt: moment(row.archived_at),
      floors: floors.map(toFloor),
    };
  }

  private async readFloor(transaction: Transaction, id: string): Promise<Floor> {
    const row = await floorsIn(transaction).where('floors.id', '=', id).executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return toFloor(row);
  }

  /** `archive_refused` while a room on these floors is in use or under repair. */
  private async refuseOpenRooms(transaction: Transaction, floorIds: readonly string[]) {
    if (floorIds.length === 0) {
      return;
    }
    const open = await transaction
      .selectFrom('rooms')
      .select((builder) => builder.fn.countAll<string>().as('n'))
      .where('floor_id', 'in', [...floorIds])
      .where('status', '<>', 'closed')
      .executeTakeFirstOrThrow();
    if (Number(open.n) > 0) {
      throw new ApiException('archive_refused', 409);
    }
  }

  /** The buildings of the branch with their floors, archived ones included and marked; oldest first. */
  list(access: Access): Promise<BuildingList> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const buildings = await transaction
        .selectFrom('buildings')
        .select(['id', 'name', 'archived_at'])
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      const floors = await floorsIn(transaction).execute();
      return {
        buildings: buildings.map((building) => ({
          id: building.id,
          name: building.name,
          archivedAt: moment(building.archived_at),
          floors: floors.filter((floor) => floor.building_id === building.id).map(toFloor),
        })),
      };
    });
  }

  createBuilding(access: Access, record: BuildingRecord, requestId: string): Promise<Building> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await transaction
          .insertInto('buildings')
          .values({ branch_id: this.branchOf(access), name: record.name })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(transaction, {
          branchId: this.branchOf(access),
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'building.create',
          record: { type: 'building', id: row.id },
          newValue: { name: record.name },
          requestId,
        });
        return this.readBuilding(transaction, row.id);
      }),
    );
  }

  renameBuilding(
    access: Access,
    id: string,
    record: BuildingRecord,
    requestId: string,
  ): Promise<Building> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await transaction
          .selectFrom('buildings')
          .select(['name', 'archived_at'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) {
          throw notFound();
        }
        if (row.archived_at !== null) {
          // The unique index covers active names only: an archived record keeps its name.
          throw new ApiException('archived_record', 409);
        }
        if (row.name !== record.name) {
          await transaction
            .updateTable('buildings')
            .set({ name: record.name })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId: this.branchOf(access),
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'building.edit',
            record: { type: 'building', id },
            oldValue: { name: row.name },
            newValue: { name: record.name },
            requestId,
          });
        }
        return this.readBuilding(transaction, id);
      }),
    );
  }

  /**
   * Archives the building and its active floors at the moment of the clock,
   * refused while a room on any of its floors is in use or under repair. An
   * archived building stays as it is.
   */
  archiveBuilding(access: Access, id: string, requestId: string): Promise<Building> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('buildings')
        .select(['archived_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw notFound();
      }
      if (row.archived_at === null) {
        const floors = await transaction
          .selectFrom('floors')
          .select(['id', 'archived_at'])
          .where('building_id', '=', id)
          .forUpdate()
          .execute();
        await this.refuseOpenRooms(
          transaction,
          floors.map((floor) => floor.id),
        );
        const now = this.clock.now();
        const archivedFloors = floors.filter((floor) => floor.archived_at === null);
        await transaction
          .updateTable('buildings')
          .set({ archived_at: now })
          .where('id', '=', id)
          .execute();
        if (archivedFloors.length > 0) {
          await transaction
            .updateTable('floors')
            .set({ archived_at: now })
            .where(
              'id',
              'in',
              archivedFloors.map((floor) => floor.id),
            )
            .execute();
        }
        await this.audit.record(transaction, {
          branchId: this.branchOf(access),
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'building.archive',
          record: { type: 'building', id },
          oldValue: { archivedAt: null },
          newValue: { archivedAt: now.toISOString() },
          details: { floorIds: archivedFloors.map((floor) => floor.id) },
          requestId,
        });
      }
      return this.readBuilding(transaction, id);
    });
  }

  /**
   * Brings back an archived building and exactly the floors archived with it
   * (those archived at the same moment); a floor archived earlier stays
   * archived. Refused with `already_exists` while an active building of that
   * name exists. An active building stays as it is.
   */
  restoreBuilding(access: Access, id: string, requestId: string): Promise<Building> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await transaction
          .selectFrom('buildings')
          .select(['archived_at'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) {
          throw notFound();
        }
        if (row.archived_at !== null) {
          const archivedAt = row.archived_at;
          await transaction
            .updateTable('buildings')
            .set({ archived_at: null })
            .where('id', '=', id)
            .execute();
          const restored = await transaction
            .updateTable('floors')
            .set({ archived_at: null })
            .where('building_id', '=', id)
            .where('archived_at', '=', archivedAt)
            .returning('id')
            .execute();
          await this.audit.record(transaction, {
            branchId: this.branchOf(access),
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'building.restore',
            record: { type: 'building', id },
            oldValue: { archivedAt: archivedAt.toISOString() },
            newValue: { archivedAt: null },
            details: { floorIds: restored.map((floor) => floor.id) },
            requestId,
          });
        }
        return this.readBuilding(transaction, id);
      }),
    );
  }

  /** A floor of an active building; an archived building is not found for it. */
  createFloor(
    access: Access,
    buildingId: string,
    record: FloorRecord,
    requestId: string,
  ): Promise<Floor> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const building = await transaction
          .selectFrom('buildings')
          .select(['id'])
          .where('id', '=', buildingId)
          .where('archived_at', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (building === undefined) {
          throw notFound();
        }
        const row = await transaction
          .insertInto('floors')
          .values({ branch_id: this.branchOf(access), building_id: buildingId, name: record.name })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(transaction, {
          branchId: this.branchOf(access),
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'floor.create',
          record: { type: 'floor', id: row.id },
          newValue: { name: record.name, buildingId },
          requestId,
        });
        return this.readFloor(transaction, row.id);
      }),
    );
  }

  renameFloor(access: Access, id: string, record: FloorRecord, requestId: string): Promise<Floor> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await transaction
          .selectFrom('floors')
          .select(['name', 'archived_at'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) {
          throw notFound();
        }
        if (row.archived_at !== null) {
          throw new ApiException('archived_record', 409);
        }
        if (row.name !== record.name) {
          await transaction
            .updateTable('floors')
            .set({ name: record.name })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId: this.branchOf(access),
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'floor.edit',
            record: { type: 'floor', id },
            oldValue: { name: row.name },
            newValue: { name: record.name },
            requestId,
          });
        }
        return this.readFloor(transaction, id);
      }),
    );
  }

  /** Refused while a room on the floor is in use or under repair. An archived floor stays as it is. */
  archiveFloor(access: Access, id: string, requestId: string): Promise<Floor> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('floors')
        .select(['archived_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw notFound();
      }
      if (row.archived_at === null) {
        await this.refuseOpenRooms(transaction, [id]);
        const now = this.clock.now();
        await transaction
          .updateTable('floors')
          .set({ archived_at: now })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId: this.branchOf(access),
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'floor.archive',
          record: { type: 'floor', id },
          oldValue: { archivedAt: null },
          newValue: { archivedAt: now.toISOString() },
          requestId,
        });
      }
      return this.readFloor(transaction, id);
    });
  }

  /**
   * Brings back an archived floor. Refused (`archived_record`) while its
   * building is archived: the building is restored first, which brings the
   * floors archived with it. `already_exists` while an active floor of that
   * name is in the building.
   */
  restoreFloor(access: Access, id: string, requestId: string): Promise<Floor> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await transaction
          .selectFrom('floors')
          .innerJoin('buildings', 'buildings.id', 'floors.building_id')
          .select(['floors.archived_at', 'buildings.archived_at as building_archived_at'])
          .where('floors.id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) {
          throw notFound();
        }
        if (row.archived_at !== null) {
          if (row.building_archived_at !== null) {
            throw new ApiException('archived_record', 409);
          }
          await transaction
            .updateTable('floors')
            .set({ archived_at: null })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId: this.branchOf(access),
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'floor.restore',
            record: { type: 'floor', id },
            oldValue: { archivedAt: row.archived_at.toISOString() },
            newValue: { archivedAt: null },
            requestId,
          });
        }
        return this.readFloor(transaction, id);
      }),
    );
  }

  /** The branch of the request; every route of this service is bound to one. */
  private branchOf(access: Access): string {
    if (access.branchId === null) {
      throw new Error('A building, a floor or a room belongs to the branch of the request.');
    }
    return access.branchId;
  }
}
