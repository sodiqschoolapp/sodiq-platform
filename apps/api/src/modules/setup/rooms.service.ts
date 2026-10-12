import { Inject, Injectable } from '@nestjs/common';
import {
  roomStatusSchema,
  roomTypeSchema,
  type Clock,
  type Room,
  type RoomExport,
  type RoomExportColumn,
  type RoomList,
  type RoomRecord,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { XlsxFile } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { exportList, oneCell, type ExportColumn } from '../audit/export-list.js';
import { changesOf, notFound, refusingDuplicates } from './setup-refusals.js';

interface RoomRow {
  id: string;
  name: string;
  floor_id: string;
  floor_name: string;
  building_id: string;
  building_name: string;
  type: string;
  capacity: number;
  status: string;
  shared: boolean;
  max_simultaneous_lessons: number | null;
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    floorId: row.floor_id,
    floorName: row.floor_name,
    buildingId: row.building_id,
    buildingName: row.building_name,
    // The checks of the table keep the lists equal to the schemas'.
    type: roomTypeSchema.parse(row.type),
    capacity: row.capacity,
    status: roomStatusSchema.parse(row.status),
    shared: row.shared,
    maxSimultaneousLessons: row.max_simultaneous_lessons,
  };
}

/** The fields a person types, as the audit entry records them. */
const fieldsOf = (room: Room): RoomRecord => ({
  name: room.name,
  floorId: room.floorId,
  type: room.type,
  capacity: room.capacity,
  status: room.status,
  shared: room.shared,
  maxSimultaneousLessons: room.maxSimultaneousLessons,
});

function roomsIn(transaction: Transaction) {
  return transaction
    .selectFrom('rooms')
    .innerJoin('floors', 'floors.id', 'rooms.floor_id')
    .innerJoin('buildings', 'buildings.id', 'floors.building_id')
    .select([
      'rooms.id',
      'rooms.name',
      'rooms.floor_id',
      'floors.name as floor_name',
      'buildings.id as building_id',
      'buildings.name as building_name',
      'rooms.type',
      'rooms.capacity',
      'rooms.status',
      'rooms.shared',
      'rooms.max_simultaneous_lessons',
    ]);
}

/** The rooms of the branch with the names of their floor and building, oldest first. */
async function readRooms(transaction: Transaction): Promise<Room[]> {
  const rows = await roomsIn(transaction).orderBy('rooms.created_at').orderBy('rooms.id').execute();
  return rows.map(toRoom);
}

/** The columns of the rooms file; capacity and the lessons at once of a shared room as numbers. */
const ROOM_EXPORT: Record<RoomExportColumn, ExportColumn<Room>> = {
  name: oneCell(
    (texts) => texts.rooms.columns.name,
    (row) => row.name,
  ),
  building: oneCell(
    (texts) => texts.rooms.columns.building,
    (row) => row.buildingName,
  ),
  floor: oneCell(
    (texts) => texts.rooms.columns.floor,
    (row) => row.floorName,
  ),
  type: oneCell(
    (texts) => texts.rooms.columns.type,
    (row, texts) => texts.roomTypes[row.type],
  ),
  capacity: oneCell(
    (texts) => texts.rooms.columns.capacity,
    (row) => row.capacity,
  ),
  status: oneCell(
    (texts) => texts.rooms.columns.status,
    (row, texts) => texts.roomStatuses[row.status],
  ),
  shared: oneCell(
    (texts) => texts.rooms.columns.shared,
    (row, texts) =>
      row.shared && row.maxSimultaneousLessons !== null ? row.maxSimultaneousLessons : texts.no,
  ),
};

/**
 * Rooms (docs/spec/03-school-setup.md, Building, floor, room: "name or
 * number, floor, type, capacity, status"; docs/spec/edge-cases/timetable.md,
 * Structure: the "shared" switch and the number of lessons at once; owner:
 * Super Admin). A room is saved on an active floor of the branch: an archived
 * floor is refused with `floor_archived` (a room on one can only be moved),
 * and a floor of another branch is not found. Rooms are never archived:
 * `closed` is their end state (decided by the owner).
 */
@Injectable()
export class Rooms {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async readRoom(transaction: Transaction, id: string): Promise<Room> {
    const row = await roomsIn(transaction).where('rooms.id', '=', id).executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return toRoom(row);
  }

  /**
   * The floor of the room, held with a share lock until the transaction ends:
   * an archive of the floor (which takes the row for update) waits for the
   * room to be saved and then counts it, and a room cannot be put on a floor
   * that is being archived (found by the spec review). A floor of another
   * branch, or an unknown one, is not found.
   */
  private async lockFloor(
    transaction: Transaction,
    floorId: string,
  ): Promise<{ archived: boolean }> {
    const floor = await transaction
      .selectFrom('floors')
      .select(['id', 'archived_at'])
      .where('id', '=', floorId)
      .forShare()
      .executeTakeFirst();
    if (floor === undefined) {
      throw notFound();
    }
    return { archived: floor.archived_at !== null };
  }

  /** A room is put on an active floor; an archived one is refused with `floor_archived`. */
  private async requireActiveFloor(transaction: Transaction, floorId: string): Promise<void> {
    if ((await this.lockFloor(transaction, floorId)).archived) {
      throw new ApiException('floor_archived', 409);
    }
  }

  /** The rooms of the branch with the names of their floor and building, oldest first. */
  list(access: Access): Promise<RoomList> {
    return this.transactions.run(access.branchIds, async (transaction) => ({
      rooms: await readRooms(transaction),
    }));
  }

  /** The Excel file of the list (task 2.2c-1), from the rows the list reads, in one transaction. */
  export(access: Access, request: RoomExport, requestId: string): Promise<XlsxFile> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rooms = await readRooms(transaction);
      return exportList(transaction, this.audit, this.clock, access, requestId, {
        list: 'rooms',
        action: 'room.export',
        request,
        rows: new Map(rooms.map((room) => [room.id, room])),
        allowed: () => true,
        columns: ROOM_EXPORT,
      });
    });
  }

  create(access: Access, record: RoomRecord, requestId: string): Promise<Room> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.requireActiveFloor(transaction, record.floorId);
        const row = await transaction
          .insertInto('rooms')
          .values({
            branch_id: this.branchOf(access),
            floor_id: record.floorId,
            name: record.name,
            type: record.type,
            capacity: record.capacity,
            status: record.status,
            shared: record.shared,
            max_simultaneous_lessons: record.maxSimultaneousLessons,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const room = await this.readRoom(transaction, row.id);
        await this.audit.record(transaction, {
          branchId: this.branchOf(access),
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'room.create',
          record: { type: 'room', id: room.id },
          newValue: fieldsOf(room),
          requestId,
        });
        return room;
      }),
    );
  }

  /** Every field, the floor included. Nothing is written when nothing changed. */
  edit(access: Access, id: string, record: RoomRecord, requestId: string): Promise<Room> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const locked = await transaction
          .selectFrom('rooms')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (locked === undefined) {
          throw notFound();
        }
        const before = await this.readRoom(transaction, id);
        const changes = changesOf(fieldsOf(before), record);
        if (changes === null) {
          return before;
        }
        // A room on an archived floor can only be moved to an active floor
        // (decided by the owner at the code review): its rooms are closed and
        // stay as they are until the floor is restored or the room is moved.
        await this.requireActiveFloor(transaction, record.floorId);
        await transaction
          .updateTable('rooms')
          .set({
            floor_id: record.floorId,
            name: record.name,
            type: record.type,
            capacity: record.capacity,
            status: record.status,
            shared: record.shared,
            max_simultaneous_lessons: record.maxSimultaneousLessons,
          })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId: this.branchOf(access),
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'room.edit',
          record: { type: 'room', id },
          oldValue: changes.oldValue,
          newValue: changes.newValue,
          requestId,
        });
        return this.readRoom(transaction, id);
      }),
    );
  }

  private branchOf(access: Access): string {
    if (access.branchId === null) {
      throw new Error('A room belongs to the branch of the request.');
    }
    return access.branchId;
  }
}
