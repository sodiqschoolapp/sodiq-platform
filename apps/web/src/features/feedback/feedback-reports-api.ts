import {
  feedbackReportEntrySchema,
  feedbackReportListSchema,
  statusProvidersSchema,
  systemStatusSchema,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';

export const FEEDBACK_REPORTS_KEY = ['feedback-reports'] as const;

/** Every new report and the newest handled ones, newest first (pull request #361); school-wide. */
export const feedbackReportsQuery = () =>
  queryOptions({
    queryKey: FEEDBACK_REPORTS_KEY,
    queryFn: async () =>
      feedbackReportListSchema.parse(await answerOf(api.GET('/api/feedback-reports'))),
  });

/** Marks a report handled, or new again; a repeat changes nothing. */
export const markFeedbackReport = async (id: string, handled: boolean) =>
  feedbackReportEntrySchema.parse(
    await answerOf(
      handled
        ? api.POST('/api/feedback-reports/{id}/handled', { params: { path: { id } } })
        : api.DELETE('/api/feedback-reports/{id}/handled', { params: { path: { id } } }),
    ),
  );

export const SYSTEM_STATUS_KEY = ['system-status'] as const;

/** The app's own checks, read from the database at once. */
export const systemStatusQuery = () =>
  queryOptions({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: async () => systemStatusSchema.parse(await answerOf(api.GET('/api/system-status'))),
  });

/** UptimeRobot, Grafana and Sentry, read on the server; up to 5 s each. */
export const statusProvidersQuery = () =>
  queryOptions({
    queryKey: [...SYSTEM_STATUS_KEY, 'providers'],
    queryFn: async () =>
      statusProvidersSchema.parse(await answerOf(api.GET('/api/system-status/providers'))),
  });
