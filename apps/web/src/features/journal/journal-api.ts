import {
  absenceReasonSchema,
  homeworkGivenAnswerSchema,
  lessonCardSchema,
  lessonDeliveryAnswerSchema,
  type HomeworkGiven,
  type LessonDelivery,
  disciplineSchema,
  notGradedAnswerSchema,
  orphanAssignmentSchema,
  orphanLessonsSchema,
  remindersSchema,
  type NotGraded,
  type OrphanAssign,
  REQUEST_KEY_HEADER,
  allPresentSchema,
  attendanceCopySchema,
  undoneSchema,
  type JournalGrid,
  type Undo,
  attendanceSavedSchema,
  cellHistorySchema,
  commentHistorySchema,
  journalCommentSchema,
  ratingExamSchema,
  ratingHistorySchema,
  journalGridSchema,
  journalListSchema,
  scoresSavedSchema,
  studentAbsencesSchema,
  workSavedSchema,
  type AbsenceReasonRecord,
  type AttendanceSave,
  type CommentHistoryQuery,
  type CommentSave,
  type RatingDate,
  type RatingEntrySave,
  type RatingNotHeld,
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
export const saveAttendance = (lessonId: string, body: AttendanceSave, key: string) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/attendance', {
      // Task 8.3a: one key per typed entry, sent again on a retry ("counted once").
      params: { header: { ...branchHeader(), [REQUEST_KEY_HEADER]: key }, path: { lessonId } },
      body,
    }),
  ).then((answer) => attendanceSavedSchema.parse(answer));

/** Undo of the person's own last action on the page (task 8.3a; `edge/journal`, Undo). */
export const undoCells = (lessonId: string, body: Undo) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/undo', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => undoneSchema.parse(answer));

/** "Copy attendance" into the second lesson of a double (task 8.3a). */
export const copyAttendance = (lessonId: string) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/copy-attendance', {
      params: { header: branchHeader(), path: { lessonId } },
    }),
  ).then((answer) => attendanceCopySchema.parse(answer));

/**
 * Shows a typed value in every journal grid that holds the cell before the
 * server answers (task 8.3a: "save per cell with optimistic display"; `12`:
 * "Save a journal cell: shown at once"). The number's percent waits for the
 * answer: only `packages/calc` on the server works it out. `workIndex`
 * `null` is the attendance cell.
 */
export function showTyped(
  queryClient: QueryClient,
  cell: { lessonId: string; studentId: string; workIndex: number | null; value: number | null },
): void {
  queryClient.setQueriesData<JournalGrid>({ queryKey: journalKey() }, (grid) => {
    if (grid === undefined || !('lessons' in grid) || !('students' in grid)) return grid;
    const index = grid.lessons.findIndex((one) => one.id === cell.lessonId);
    if (index < 0) return grid;
    return {
      ...grid,
      students: grid.students.map((student) => {
        if (student.id !== cell.studentId) return student;
        return {
          ...student,
          cells: student.cells.map((one, at) => {
            if (at !== index) return one;
            if (cell.workIndex === null) {
              return { ...one, mark: cell.value };
            }
            return {
              ...one,
              works: one.works.map((work, workAt) =>
                workAt === cell.workIndex ? { ...work, score: cell.value, percent: null } : work,
              ),
            };
          }),
        };
      }),
    };
  });
}

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

/** Task 8.7 (`07`, Lesson status): "not graded" for the empty cells of a lesson's works. */
export const setNotGraded = (lessonId: string, body: NotGraded) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/not-graded', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => notGradedAnswerSchema.parse(answer));

/** Task 8.7: the caller's own reminders in the branch in use (the branch switcher's). */
export const remindersQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'reminders'],
    queryFn: async () =>
      remindersSchema.parse(
        await answerOf(
          api.GET('/api/journal/reminders', {
            params: { header: branchHeader() },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Task 8.7: the counts per teacher of a date range and department. */
export const disciplineQuery = (
  branchId: string | null,
  range: { from: string; to: string; departmentId: string | null },
) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'discipline', range.from, range.to, range.departmentId],
    queryFn: async () =>
      disciplineSchema.parse(
        await answerOf(
          api.GET('/api/journal/discipline', {
            params: {
              header: branchHeader(),
              query: {
                from: range.from,
                to: range.to,
                ...(range.departmentId === null ? {} : { departmentId: range.departmentId }),
              },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Task 8.7: the orphan lessons of the branch. */
export const orphansQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'orphans'],
    queryFn: async () =>
      orphanLessonsSchema.parse(
        await answerOf(api.GET('/api/journal/orphans', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const assignOrphan = (lessonId: string, body: OrphanAssign) =>
  answerOf(
    api.POST('/api/journal/orphans/{lessonId}/assign', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => orphanAssignmentSchema.parse(answer));

export const withdrawOrphan = (assignmentId: string) =>
  answerOf(
    api.POST('/api/journal/orphans/assignments/{assignmentId}/withdraw', {
      params: { header: branchHeader(), path: { assignmentId } },
    }),
  );

/** "Check at the next lesson" of a homework. */
export const carryWork = (lessonId: string, body: WorkCarry) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/works/carry', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => workSavedSchema.parse(answer));

/** Numbers typed for works of one lesson; `score: null` clears a cell. */
export const saveScores = (lessonId: string, body: ScoresSave, key: string) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/scores', {
      params: { header: { ...branchHeader(), [REQUEST_KEY_HEADER]: key }, path: { lessonId } },
      body,
    }),
  ).then((answer) => scoresSavedSchema.parse(answer));

// ---------------------------------------------------------------------------
// Task 8.2: the rating exam and comments.

/** The hand-set date of the rating exam of a journal in a quarter. */
export const setRatingDate = (journalId: string, quarterId: string, body: RatingDate) =>
  answerOf(
    api.PUT('/api/journal/journals/{journalId}/rating/{quarterId}/date', {
      params: { header: branchHeader(), path: { journalId, quarterId } },
      body,
    }),
  ).then((answer) => ratingExamSchema.parse(answer));

/** "Not held" and its undo; `confirm` after a `rating_exam_entries`. */
export const setRatingNotHeld = (journalId: string, quarterId: string, body: RatingNotHeld) =>
  answerOf(
    api.PUT('/api/journal/journals/{journalId}/rating/{quarterId}/not-held', {
      params: { header: branchHeader(), path: { journalId, quarterId } },
      body,
    }),
  ).then((answer) => ratingExamSchema.parse(answer));

/** A student's entry; `entry: null` clears it. */
export const saveRatingEntry = (journalId: string, quarterId: string, body: RatingEntrySave) =>
  answerOf(
    api.POST('/api/journal/journals/{journalId}/rating/{quarterId}/entries', {
      params: { header: branchHeader(), path: { journalId, quarterId } },
      body,
    }),
  ).then((answer) => ratingExamSchema.parse(answer));

/** The history of a student's rating entry and of the exam's date and "not held". */
export const ratingHistoryQuery = (
  branchId: string | null,
  journalId: string,
  quarterId: string,
  studentId: string,
) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'rating-history', journalId, quarterId, studentId],
    queryFn: async () =>
      ratingHistorySchema.parse(
        await answerOf(
          api.GET(
            '/api/journal/journals/{journalId}/rating/{quarterId}/students/{studentId}/history',
            {
              params: { header: branchHeader(), path: { journalId, quarterId, studentId } },
            },
          ),
        ),
      ),
    enabled: branchId !== null,
  });

/** Writes or clears a comment. */
export const saveComment = (body: CommentSave) =>
  answerOf(api.PUT('/api/journal/comments', { params: { header: branchHeader() }, body })).then(
    (answer) => journalCommentSchema.parse(answer),
  );

/** The history of a comment. */
export const commentHistoryQuery = (branchId: string | null, query: CommentHistoryQuery) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'comment-history', query],
    queryFn: async () =>
      commentHistorySchema.parse(
        await answerOf(
          api.GET('/api/journal/comments/history', {
            params: { header: branchHeader(), query },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Task 8.8: the lesson card (`09`, In the journal: "Clicking it opens the lesson card"). */
export const lessonCardQuery = (branchId: string | null, lessonId: string) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'card', lessonId],
    queryFn: async () =>
      lessonCardSchema.parse(
        await answerOf(
          api.GET('/api/journal/lessons/{lessonId}/card', {
            params: { header: branchHeader(), path: { lessonId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Task 8.8: "topic not delivered", set or undone on the version read. */
export const setDelivery = (lessonId: string, body: LessonDelivery) =>
  answerOf(
    api.PUT('/api/journal/lessons/{lessonId}/delivery', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => lessonDeliveryAnswerSchema.parse(answer));

/** Task 8.8: "not given" on homeworks of the lesson's item, or its undo. */
export const setHomeworkGiven = (lessonId: string, body: HomeworkGiven) =>
  answerOf(
    api.PUT('/api/journal/lessons/{lessonId}/homework-given', {
      params: { header: branchHeader(), path: { lessonId } },
      body,
    }),
  ).then((answer) => homeworkGivenAnswerSchema.parse(answer));
