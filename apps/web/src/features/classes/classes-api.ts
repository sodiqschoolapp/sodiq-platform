import {
  classDetailSchema,
  classListSchema,
  tutorCandidateListSchema,
  type ClassCreate,
  type ClassEdit,
  type ClassTutorEnd,
  type ClassTutorGive,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { SETUP_KEY } from '@/features/setup/setup-api';

/** The classes of a branch (task 3.1a); `null` while no branch is chosen. */
export const classesKey = (branchId?: string | null) =>
  branchId === undefined ? ['classes'] : ['classes', branchId];

export const classesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: classesKey(branchId),
    queryFn: async () =>
      classListSchema.parse(
        await answerOf(api.GET('/api/classes', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** One class with every Tutor row it had, has and will have. */
export const classQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...classesKey(branchId), id],
    queryFn: async () =>
      classDetailSchema.parse(
        await answerOf(
          api.GET('/api/classes/{id}', { params: { header: branchHeader(), path: { id } } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The Tutor roles of the branch a class can be given (decision 8); for the editors only. */
export const tutorCandidatesQuery = (branchId: string | null, enabled: boolean) =>
  queryOptions({
    queryKey: [...classesKey(branchId), 'tutor-candidates'],
    queryFn: async () =>
      tutorCandidateListSchema.parse(
        await answerOf(
          api.GET('/api/classes/tutor-candidates', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null && enabled,
  });

/** After a change of a class or its Tutors: every class list, and the setup checklist. */
export const invalidateClasses = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: classesKey() }),
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'checklist'] }),
  ]);

export const createClass = (record: ClassCreate) =>
  answerOf(api.POST('/api/classes', { params: { header: branchHeader() }, body: record })).then(
    (answer) => classDetailSchema.parse(answer),
  );

export const editClass = (id: string, record: ClassEdit) =>
  answerOf(
    api.PUT('/api/classes/{id}', {
      params: { header: branchHeader(), path: { id } },
      body: record,
    }),
  ).then((answer) => classDetailSchema.parse(answer));

export const archiveClass = (id: string, restore: boolean) =>
  answerOf(
    api.POST(restore ? '/api/classes/{id}/restore' : '/api/classes/{id}/archive', {
      params: { header: branchHeader(), path: { id } },
    }),
  ).then((answer) => classDetailSchema.parse(answer));

export const giveTutor = (id: string, give: ClassTutorGive) =>
  answerOf(
    api.POST('/api/classes/{id}/tutors', {
      params: { header: branchHeader(), path: { id } },
      body: give,
    }),
  ).then((answer) => classDetailSchema.parse(answer));

export const endTutor = (id: string, tutorId: string, end: ClassTutorEnd) =>
  answerOf(
    api.POST('/api/classes/{id}/tutors/{tutorId}/end', {
      params: { header: branchHeader(), path: { id, tutorId } },
      body: end,
    }),
  ).then((answer) => classDetailSchema.parse(answer));
