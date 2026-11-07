import {
  announcementListSchema,
  announcementMonthSchema,
  announcementSchema,
  type AnnouncementEdit,
  type AnnouncementRecord,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The calls of announcements and events (task 11.7): the authors' list and writes, the month of
 * what is addressed to the staff member, for the branch of the switcher; the portal's month of a
 * child.
 */
export const ANNOUNCEMENTS_KEY = ['announcements'] as const;

/** The authors' list: every announcement of the branch and the school, active and archived. */
export const announcementsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...ANNOUNCEMENTS_KEY, 'list', branchId],
    queryFn: async () =>
      announcementListSchema.parse(
        await answerOf(
          api.GET('/api/announcements', {
            params: { header: branchHeader() },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const addressedQuery = (branchId: string | null, month: string | undefined) =>
  queryOptions({
    queryKey: [...ANNOUNCEMENTS_KEY, 'feed', branchId, month ?? null],
    queryFn: async () =>
      announcementMonthSchema.parse(
        await answerOf(
          api.GET('/api/announcements-feed', {
            params: { header: branchHeader(), query: month === undefined ? {} : { month } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const portalAnnouncementsQuery = (studentId: string, month: string | undefined) =>
  queryOptions({
    queryKey: ['portal', 'announcements', studentId, month ?? null],
    queryFn: async () =>
      announcementMonthSchema.parse(
        await answerOf(
          api.GET('/api/portal/children/{studentId}/announcements', {
            params: { path: { studentId }, query: month === undefined ? {} : { month } },
          }),
        ),
      ),
  });

/** A new announcement; the key is kept by the form until it is saved, so a retry is the same request. */
export async function createAnnouncement(record: AnnouncementRecord, key: string) {
  return announcementSchema.parse(
    await answerOf(
      api.POST('/api/announcements', {
        params: { header: { ...branchHeader(), 'Idempotency-Key': key } },
        body: record,
      }),
    ),
  );
}

export async function editAnnouncement(id: string, edit: AnnouncementEdit) {
  return announcementSchema.parse(
    await answerOf(
      api.PUT('/api/announcements/{id}', {
        params: { header: branchHeader(), path: { id } },
        body: edit,
      }),
    ),
  );
}

export async function archiveAnnouncement(id: string, version: number, restore: boolean) {
  return announcementSchema.parse(
    await answerOf(
      api.POST(restore ? '/api/announcements/{id}/restore' : '/api/announcements/{id}/archive', {
        params: { header: branchHeader(), path: { id } },
        body: { version },
      }),
    ),
  );
}

export const invalidateAnnouncements = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: ANNOUNCEMENTS_KEY });
