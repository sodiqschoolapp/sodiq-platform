import {
  absenceReasonSchema,
  allPresentSchema,
  attendanceSavedSchema,
  cellHistorySchema,
  journalGridSchema,
  journalListSchema,
  scoresSavedSchema,
  studentAbsencesSchema,
  workSavedSchema,
  type AbsenceReasonRecord,
  type AttendanceSave,
  type ScoresSave,
  type WorkAdd,
  type WorkCarry,
  type WorkNotHeld,
  type WorkTotal,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/** The journals of a branch (task 6.2); `null` while no branch is chosen. */
export const journalKey = (branchId?: string | null) =>
  branchId === undefined ? ['journal'] : ['journal', branchId];

/** The Journals page: the journals the role may open in a year (the current one without `yearId`). */
export const journalsQuery = (branchId: string | null, yearId: string | null) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'list', yearId],
    queryFn: async () =>
      journalListSchema.parse(
        await answerOf(
          api.GET('/api/journal/journals', {
            params: { header: branchHeader(), query: yearId === null ? {} : { yearId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** One journal for one quarter (the quarter of today without `quarterId`). */
export const journalGridQuery = (
  branchId: string | null,
  journalId: string,
  quarterId: string | null,
) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'grid', journalId, quarterId],
    queryFn: async () =>
      journalGridSchema.parse(
        await answerOf(
          api.GET('/api/journal/journals/{journalId}', {
            params: {
              header: branchHeader(),
              path: { journalId },
              query: quarterId === null ? {} : { quarterId },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Every query of the journals of every branch, after an entry (task 6.3). */
export const invalidateJournal = (queryClient: QueryClient): Promise<unknown> =>
  queryClient.invalidateQueries({ queryKey: journalKey() });

/** Typed attendance marks of one lesson (task 6.3); `mark: null` clears a cell. */
export const saveAttendance = (lessonId: string, body: AttendanceSave) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/attendance', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => attendanceSavedSchema.parse(answer));

/** "All present" for one lesson (task 6.3, decision 4). */
export const markAllPresent = (lessonId: string) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/all-present', {
      params: { header: branchHeader(), path: { lessonId } },
    }),
  ).then((answer) => allPresentSchema.parse(answer));

/** The history of a student's cells in a lesson (task 6.3, decision 16). */
export const cellHistoryQuery = (branchId: string | null, lessonId: string, studentId: string) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'history', lessonId, studentId],
    queryFn: async () =>
      cellHistorySchema.parse(
        await answerOf(
          api.GET('/api/journal/lessons/{lessonId}/students/{studentId}/history', {
            params: { header: branchHeader(), path: { lessonId, studentId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The Student absences page: one class over a range (task 6.3, decision 13). */
export const studentAbsencesQuery = (
  branchId: string | null,
  query: { classId?: string; from?: string; to?: string },
) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'student-absences', query],
    queryFn: async () =>
      studentAbsencesSchema.parse(
        await answerOf(
          api.GET('/api/journal/student-absences', {
            params: { header: branchHeader(), query },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Sets or clears the reason of a student's absence on a date (task 6.3, decision 8). */
export const setAbsenceReason = (studentId: string, date: string, body: AbsenceReasonRecord) =>
  answerOf(
    api.PUT('/api/journal/student-absences/{studentId}/{date}', {
      params: { header: branchHeader(), path: { studentId, date } },
      body,
    }),
  ).then((answer) => absenceReasonSchema.parse(answer));

// ---------------------------------------------------------------------------
// Task 8.1: classwork and homework.

/** A work added by hand at a lesson with no plan item. */
export const addWork = (lessonId: string, body: WorkAdd) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/works', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => workSavedSchema.parse(answer));

/** Removes an empty work added by hand. */
export const removeWork = (lessonId: string, workId: string) =>
  answerOf(
    api.DELETE('/api/journal/lessons/{lessonId}/works/{workId}', {
      params: { header: branchHeader(), path: { lessonId, workId } },
    }),
  );

/** The total of a work; `confirm` after a `total_confirm`. */
export const setWorkTotal = (lessonId: string, body: WorkTotal) =>
  answerOf(
    api.PUT('/api/journal/lessons/{lessonId}/works/total', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => workSavedSchema.parse(answer));

/** "Not held" and its undo; `confirm` after a `not_held_confirm`. */
export const setWorkNotHeld = (lessonId: string, body: WorkNotHeld) =>
  answerOf(
    api.PUT('/api/journal/lessons/{lessonId}/works/not-held', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => workSavedSchema.parse(answer));

/** "Check at the next lesson" of a homework. */
export const carryWork = (lessonId: string, body: WorkCarry) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/works/carry', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => workSavedSchema.parse(answer));

/** Numbers typed for works of one lesson; `score: null` clears a cell. */
export const saveScores = (lessonId: string, body: ScoresSave) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/scores', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => scoresSavedSchema.parse(answer));
