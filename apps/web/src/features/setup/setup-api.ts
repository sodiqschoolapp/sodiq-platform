import {
  academicYearListSchema,
  branchSchema,
  currentPeriodSchema,
  divisionListSchema,
  isLanguage,
  buildingListSchema,
  roomListSchema,
  type Building,
  type Names,
  type Weekday,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
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

/**
 * The divisions with their departments (task 1.2). One list for the whole
 * school (`03`, Divisions): the key carries the branch of the switcher like
 * every setup query, because the call does, but a change is a change for every
 * branch, so writes invalidate `divisionsKey()` without a branch.
 */
export const divisionsKey = (branchId?: string | null) =>
  branchId === undefined ? [...SETUP_KEY, 'divisions'] : [...SETUP_KEY, 'divisions', branchId];

export const divisionsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: divisionsKey(branchId),
    queryFn: async () =>
      divisionListSchema.parse(
        await answerOf(api.GET('/api/setup/divisions', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** Marks the division lists of every branch stale: the list is the same in each. */
export const invalidateDivisions = (queryClient: QueryClient): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: divisionsKey() });

/** A name in the chosen language (`12`, Language), English when the language is not one of the three. */
export function nameOf(names: Names, language: string): string {
  return isLanguage(language) ? names[language] : names.en;
}

/** The academic years of the branch with their quarters (task 1.3), newest first. */
export const yearsKey = (branchId?: string | null) =>
  branchId === undefined ? [...SETUP_KEY, 'years'] : [...SETUP_KEY, 'years', branchId];

export const yearsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: yearsKey(branchId),
    queryFn: async () =>
      academicYearListSchema.parse(
        await answerOf(
          api.GET('/api/setup/academic-years', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/**
 * The year and quarter of the top bar (`03`; `12`, Context). Not polled: a
 * switch of branch reads it again (the key), and every change of a year, its
 * quarters or the go-live date marks it stale (`invalidateYears`).
 */
export const periodKey = (branchId?: string | null) =>
  branchId === undefined ? ['period'] : ['period', branchId];

export const currentPeriodQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: periodKey(branchId),
    queryFn: async () =>
      currentPeriodSchema.parse(
        await answerOf(
          api.GET('/api/setup/current-period', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** After a change of a year, its quarters or the go-live date: the years, the top bar and the branch record. */
export const invalidateYears = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: yearsKey() }),
    queryClient.invalidateQueries({ queryKey: periodKey() }),
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'branch'] }),
  ]);

/**
 * A school date (`YYYY-MM-DD`) in the chosen language (`12`, Language:
 * "Dates ... follow the chosen language"): "10 November 2026", or "10
 * November" without the year. Read as a day of the calendar, never moved by a
 * time zone.
 */
export function schoolDateText(date: string, language: string, withYear = true): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

/**
 * The months a quarter covers (`03`, Quarters: "Months are derived from
 * dates"), in the chosen language: "September – October".
 */
export function monthsText(startDate: string, endDate: string, language: string): string {
  const month = (date: string) => {
    const [year, number] = date.split('-').map(Number);
    const name = new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year ?? 1970, (number ?? 1) - 1, 1)),
    );
    return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
  };
  const first = month(startDate);
  const last = month(endDate);
  return startDate.slice(0, 7) === endDate.slice(0, 7) ? first : `${first} – ${last}`;
}
