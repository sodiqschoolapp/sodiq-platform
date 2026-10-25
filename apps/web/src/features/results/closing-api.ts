import {
  REQUEST_KEY_HEADER,
  closingChecklistSchema,
  closingClosedSchema,
  closingDecisionSchema,
  closingJournalDecisionSchema,
  closingPeriodsEndedSchema,
  closingRemindedSchema,
  type ClosingCloseInput,
  type ClosingDecisionInput,
  type ClosingJournalDecisionInput,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The closing checklist of a quarter (task 9.2a; `07`, Closing a quarter).
 * Every item and every result is the server's; the browser calculates nothing.
 */

export const closingKey = (branchId: string | null) => ['results', branchId, 'closing'] as const;

export const closingQuery = (branchId: string | null, quarterId: string | null) =>
  queryOptions({
    queryKey: [...closingKey(branchId), quarterId],
    queryFn: async () =>
      closingChecklistSchema.parse(
        await answerOf(
          api.GET('/api/results/closing', {
            params: {
              header: branchHeader(),
              query: quarterId === null ? {} : { quarterId },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** A decision changes the results every reader shows: the journals and the results too. */
export const invalidateClosing = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ['results'] }),
    queryClient.invalidateQueries({ queryKey: ['journal'] }),
  ]);

export const decideResult = (quarterId: string, body: ClosingDecisionInput) =>
  answerOf(
    api.PUT('/api/results/closing/{quarterId}/decisions', {
      params: { header: branchHeader(), path: { quarterId } },
      body,
    }),
  ).then((answer) => closingDecisionSchema.parse(answer));

export const decideJournal = (
  quarterId: string,
  journalId: string,
  body: ClosingJournalDecisionInput,
) =>
  answerOf(
    api.POST('/api/results/closing/{quarterId}/journals/{journalId}/decisions', {
      params: { header: branchHeader(), path: { quarterId, journalId } },
      body,
    }),
  ).then((answer) => closingJournalDecisionSchema.parse(answer));

export const endPlanPeriods = (quarterId: string) =>
  answerOf(
    api.POST('/api/results/closing/{quarterId}/plan-periods/end', {
      params: { header: branchHeader(), path: { quarterId } },
    }),
  ).then((answer) => closingPeriodsEndedSchema.parse(answer));

/** "Remind": one key per press, so a retry of the same press sends once. */
export const remindTeachers = (quarterId: string, key: string) =>
  answerOf(
    api.POST('/api/results/closing/{quarterId}/remind', {
      params: { header: { ...branchHeader(), [REQUEST_KEY_HEADER]: key }, path: { quarterId } },
    }),
  ).then((answer) => closingRemindedSchema.parse(answer));

/** The close of the quarter (task 9.2b): one key per dialog, so a retry of the same press closes once. */
export const closeQuarter = (quarterId: string, body: ClosingCloseInput, key: string) =>
  answerOf(
    api.POST('/api/results/closing/{quarterId}/close', {
      params: { header: { ...branchHeader(), [REQUEST_KEY_HEADER]: key }, path: { quarterId } },
      body,
    }),
  ).then((answer) => closingClosedSchema.parse(answer));
