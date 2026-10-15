import {
  loadRowSchema,
  loadSchema,
  loadTeachersSchema,
  loadTotalsSchema,
  timetableVersionListSchema,
  timetableVersionSchema,
  type LoadRowEdit,
  type LoadRowRecord,
  type TimetableVersionCreate,
  type TimetableVersionEdit,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { SETUP_KEY } from '@/features/setup/setup-api';

/** The draft versions and their teaching load (task 3.4a); `null` while no branch is chosen. */
export const timetableKey = (branchId?: string | null) =>
  branchId === undefined ? ['timetable'] : ['timetable', branchId];

export const versionsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'versions'],
    queryFn: async () =>
      timetableVersionListSchema.parse(
        await answerOf(api.GET('/api/timetable/versions', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** The rows of a version with their problems today, and the rows a copy left. */
export const loadQuery = (branchId: string | null, versionId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'load', versionId],
    queryFn: async () =>
      loadSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/load', {
            params: { header: branchHeader(), path: { id: versionId ?? '' } },
          }),
        ),
      ),
    enabled: branchId !== null && versionId !== null,
  });

/** The weekly totals of a version (task 3.4b): shown, never refusing. */
export const totalsQuery = (branchId: string | null, versionId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'load', versionId, 'totals'],
    queryFn: async () =>
      loadTotalsSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/totals', {
            params: { header: branchHeader(), path: { id: versionId ?? '' } },
          }),
        ),
      ),
    enabled: branchId !== null && versionId !== null,
  });

/** The teachers and vacancies a row of the unit and subject may take (decision 2). */
export const loadTeachersQuery = (
  branchId: string | null,
  versionId: string,
  unit: { classId: string } | { groupId: string } | null,
  subjectId: string,
) =>
  queryOptions({
    queryKey: [
      ...timetableKey(branchId),
      'load',
      versionId,
      'teachers',
      unit === null ? '' : 'classId' in unit ? unit.classId : unit.groupId,
      subjectId,
    ],
    queryFn: async () =>
      loadTeachersSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/load/teachers', {
            params: {
              header: branchHeader(),
              path: { id: versionId },
              query: { ...(unit ?? {}), subjectId },
            },
          }),
        ),
      ),
    enabled: branchId !== null && unit !== null && subjectId !== '',
  });

/** After a change: every version and load of the branch, and the setup checklist. */
export const invalidateTimetable = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: timetableKey() }),
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'checklist'] }),
  ]);

export const createVersion = (record: TimetableVersionCreate) =>
  answerOf(
    api.POST('/api/timetable/versions', { params: { header: branchHeader() }, body: record }),
  ).then((answer) => timetableVersionSchema.parse(answer));

export const editVersion = (id: string, edit: TimetableVersionEdit) =>
  answerOf(
    api.PATCH('/api/timetable/versions/{id}', {
      params: { header: branchHeader(), path: { id } },
      body: edit,
    }),
  ).then((answer) => timetableVersionSchema.parse(answer));

export const createLoadRow = (versionId: string, record: LoadRowRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/load', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: record,
    }),
  ).then((answer) => loadRowSchema.parse(answer));

export const editLoadRow = (versionId: string, rowId: string, edit: LoadRowEdit) =>
  answerOf(
    api.PATCH('/api/timetable/versions/{id}/load/{rowId}', {
      params: { header: branchHeader(), path: { id: versionId, rowId } },
      body: edit,
    }),
  ).then((answer) => loadRowSchema.parse(answer));

export const deleteLoadRow = (versionId: string, rowId: string) =>
  answerOf(
    api.DELETE('/api/timetable/versions/{id}/load/{rowId}', {
      params: { header: branchHeader(), path: { id: versionId, rowId } },
    }),
  );
