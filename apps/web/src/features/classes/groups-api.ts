import {
  automaticPlacementResultSchema,
  groupMembersSchema,
  groupPlacementBoardSchema,
  type AutomaticPlacement,
  type GroupPlacement,
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

export const archiveGroup = (id: string) =>
  answerOf(
    api.POST('/api/groups/{id}/archive', {
      params: { header: branchHeader(), path: { id } },
    }),
  ).then((answer) => groupDetailSchema.parse(answer));

/** A restore that brings the group back mixing languages confirms the warning (code round 1 of #91). */
export const restoreGroup = (id: string, confirmMixedLanguage: boolean) =>
  answerOf(
    api.POST('/api/groups/{id}/restore', {
      params: { header: branchHeader(), path: { id } },
      body: { confirmMixedLanguage },
    }),
  ).then((answer) => groupDetailSchema.parse(answer));

/** The Students tab of a group (task 3.2b); a Tutor reads the members of own classes. */
export const groupMembersQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...groupsKey(branchId), id, 'members'],
    queryFn: async () =>
      groupMembersSchema.parse(
        await answerOf(
          api.GET('/api/groups/{id}/members', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The bulk placement screen (task 3.2b, decision 14): one subject, one grade or a pair, a date. */
export const placementBoardQuery = (
  branchId: string | null,
  subjectId: string,
  grades: readonly number[],
  on: string,
) =>
  queryOptions({
    queryKey: [...groupsKey(branchId), 'placement', subjectId, grades.join(','), on],
    queryFn: async () =>
      groupPlacementBoardSchema.parse(
        await answerOf(
          api.GET('/api/groups/placement', {
            params: {
              header: branchHeader(),
              query: { subjectId, grades: grades.join(','), on },
            },
          }),
        ),
      ),
    enabled: branchId !== null && subjectId !== '' && grades.length > 0 && on !== '',
  });

export const placeInGroup = (id: string, placement: GroupPlacement) =>
  answerOf(
    api.POST('/api/groups/{id}/members', {
      params: { header: branchHeader(), path: { id } },
      body: placement,
    }),
  ).then((answer) => groupMembersSchema.parse(answer));

export const withdrawGroupMember = (id: string, memberId: string) =>
  answerOf(
    api.POST('/api/groups/{id}/members/{memberId}/withdraw', {
      params: { header: branchHeader(), path: { id, memberId } },
    }),
  ).then((answer) => groupMembersSchema.parse(answer));

export const markReviewed = (id: string, memberId: string) =>
  answerOf(
    api.POST('/api/groups/{id}/members/{memberId}/reviewed', {
      params: { header: branchHeader(), path: { id, memberId } },
    }),
  ).then((answer) => groupMembersSchema.parse(answer));

export const placeAutomatically = (input: AutomaticPlacement) =>
  answerOf(
    api.POST('/api/groups/placement/automatic', {
      params: { header: branchHeader() },
      body: input,
    }),
  ).then((answer) => automaticPlacementResultSchema.parse(answer));
