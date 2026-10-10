import {
  branchSchema,
  buildingListSchema,
  roomListSchema,
  type Building,
  type Weekday,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The queries of school setup. Each key carries the branch of the switcher:
 * the client names it in the header of every call, and another branch is
 * another list.
 */
export const SETUP_KEY = ['setup'] as const;

/** `null` while no branch is chosen: such a query is not run. */
export const branchQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'branch', branchId],
    queryFn: async () =>
      branchSchema.parse(
        await answerOf(api.GET('/api/setup/branch', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const buildingsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'buildings', branchId],
    queryFn: async () =>
      buildingListSchema.parse(
        await answerOf(api.GET('/api/setup/buildings', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const roomsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'rooms', branchId],
    queryFn: async () =>
      roomListSchema.parse(
        await answerOf(api.GET('/api/setup/rooms', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** A floor a room can be put on: an active floor of an active building. */
export interface FloorChoice {
  buildingId: string;
  buildingName: string;
  floorId: string;
  floorName: string;
}

export function activeFloorsOf(buildings: readonly Building[]): FloorChoice[] {
  return buildings
    .filter((building) => building.archivedAt === null)
    .flatMap((building) =>
      building.floors
        .filter((floor) => floor.archivedAt === null)
        .map((floor) => ({
          buildingId: building.id,
          buildingName: building.name,
          floorId: floor.id,
          floorName: floor.name,
        })),
    );
}

/**
 * The name of a weekday in the chosen language (`12`, Language: "Dates,
 * numbers and weekdays follow the chosen language"), with a capital first
 * letter as a label has. The first of January 2024 was a Monday.
 */
export function weekdayName(language: string, day: Weekday): string {
  const name = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, day)),
  );
  return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
}
