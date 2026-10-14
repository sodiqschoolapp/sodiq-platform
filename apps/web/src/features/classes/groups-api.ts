import {
  groupDetailSchema,
  groupListSchema,
  groupSlotCheckSchema,
  type GroupCreate,
  type GroupEdit,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { SETUP_KEY } from '@/features/setup/setup-api';

/** The groups of a branch (task 3.2a); `null` while no branch is chosen. */
export const groupsKey = (branchId?: string | null) =>
  branchId === undefined ? ['groups'] : ['groups', branchId];

export const groupsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: groupsKey(branchId),
    queryFn: async () =>
      groupListSchema.parse(
        await answerOf(api.GET('/api/groups', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** One group with the shared slots of its two grades (decision 9). */
export const groupQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...groupsKey(branchId), id],
    queryFn: async () =>
      groupDetailSchema.parse(
        await answerOf(
          api.GET('/api/groups/{id}', { params: { header: branchHeader(), path: { id } } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The lesson slots the classes chosen share, before a save (decision 9); for the editors only. */
export const groupSlotsQuery = (branchId: string | null, classIds: readonly string[]) =>
  queryOptions({
    queryKey: [...groupsKey(branchId), 'slot-check', [...classIds].sort().join(',')],
    queryFn: async () =>
      groupSlotCheckSchema.parse(
        await answerOf(
          api.GET('/api/groups/slot-check', {
            params: { header: branchHeader(), query: { classIds: classIds.join(',') } },
          }),
        ),
      ),
    enabled: branchId !== null && classIds.length > 0,
  });

/** After a change of a group: every group list, the classes (their groups), and the setup checklist. */
export const invalidateGroups = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: groupsKey() }),
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'checklist'] }),
  ]);

export const createGroup = (record: GroupCreate) =>
  answerOf(api.POST('/api/groups', { params: { header: branchHeader() }, body: record })).then(
    (answer) => groupDetailSchema.parse(answer),
  );

export const editGroup = (id: string, record: GroupEdit) =>
  answerOf(
    api.PUT('/api/groups/{id}', {
      params: { header: branchHeader(), path: { id } },
      body: record,
    }),
  ).then((answer) => groupDetailSchema.parse(answer));

export const archiveGroup = (id: string, restore: boolean) =>
  answerOf(
    api.POST(restore ? '/api/groups/{id}/restore' : '/api/groups/{id}/archive', {
      params: { header: branchHeader(), path: { id } },
    }),
  ).then((answer) => groupDetailSchema.parse(answer));
