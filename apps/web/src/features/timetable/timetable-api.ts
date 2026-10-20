import {
  dayAnswerSchema,
  correctionTeachersAnswerSchema,
  dayChangeAnswerSchema,
  dayKeepSchema,
  draftReadinessSchema,
  gridSchema,
  loadRowSchema,
  loadSchema,
  loadTeachersSchema,
  loadTotalsSchema,
  outOfDateAnswerSchema,
  publishCheckSchema,
  timetableVersionListSchema,
  timetableVersionSchema,
  withdrawCheckSchema,
  type WithdrawBody,
  type DayKeepBody,
  type LessonCancelBody,
  type LessonCorrectionBody,
  type LessonMoveBody,
  type LessonRestoreBody,
  type LessonRoomBody,
  type LessonRoomRecord,
  type LoadRowEdit,
  type LoadRowRecord,
  type MoveRecord,
  type PinRecord,
  type PlaceRecord,
  type DayChangeChoice,
  type PublishChain,
  type PreferenceWeights,
  type RearrangeRecord,
  type SwapRecord,
  type TimetableLockRecord,
  type TimetableVersionCreate,
  type TimetableVersionEdit,
  type UpToDateSide,
  bulkCancelAnswerSchema,
  bulkCancelCheckAnswerSchema,
  type BulkCancelBody,
  type BulkCancelCheckBody,
  examCheckSchema,
  examSaveAnswerSchema,
  examsAnswerSchema,
  type ExamBody,
  type ExamCancelBody,
  type ExamCheckBody,
  type ExamCreateBody,
  absenceLessonsSchema,
  absenceListSchema,
  absenceSchema,
  attentionSchema,
  type AbsenceEdit,
  type AbsenceRecord,
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

/** The readiness of steps 1 to 5 of a draft (tasks 5.3a and 5.3b-1), read on each request. */
export const readinessQuery = (branchId: string | null, versionId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'load', versionId, 'readiness'],
    queryFn: async () =>
      draftReadinessSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/readiness', {
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

/** Step 1: the table of templates in force stored as confirmed (task 5.3a). */
export const confirmTemplates = (versionId: string) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/templates/confirm', {
      params: { header: branchHeader(), path: { id: versionId } },
    }),
  ).then((answer) => draftReadinessSchema.parse(answer));

/** Step 5: the weights of the preferences (task 5.3b-1). */
export const saveWeights = (versionId: string, weights: PreferenceWeights) =>
  answerOf(
    api.PUT('/api/timetable/versions/{id}/preferences', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: { weights },
    }),
  ).then((answer) => draftReadinessSchema.parse(answer));

/**
 * Step 5 confirmed: the weights and the pins the person sees (task 5.3b-1,
 * decision 9; task 5.3b-2, decision 7).
 */
export const confirmRules = (
  versionId: string,
  weights: PreferenceWeights,
  pins: readonly string[],
) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/rules/confirm', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: { weights, pins: [...pins] },
    }),
  ).then((answer) => draftReadinessSchema.parse(answer));

/** Step 5: a lesson pinned to a weekday and a slot position (task 5.3b-2). */
export const createPin = (versionId: string, pin: PinRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/pins', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: pin,
    }),
  ).then((answer) => draftReadinessSchema.parse(answer));

/** Step 8: the lessons a class keeps on a shortened day (task 5.5a-2b-2); an empty list removes the choice. */
export const setDayKeep = (versionId: string, body: DayKeepBody) =>
  answerOf(
    api.PUT('/api/timetable/versions/{id}/day-keeps', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: { ...body, slotPositions: [...body.slotPositions] },
    }),
  ).then((answer) => dayKeepSchema.parse(answer));

/** Step 5: a pin removed (task 5.3b-2). */
export const deletePin = (versionId: string, pinId: string) =>
  answerOf(
    api.DELETE('/api/timetable/versions/{id}/pins/{pinId}', {
      params: { header: branchHeader(), path: { id: versionId, pinId } },
    }),
  ).then((answer) => draftReadinessSchema.parse(answer));

/** Step 7: the board of a version (task 5.4a): its rows, blocks, the engine's input and the results now. */
export const gridQuery = (branchId: string | null, versionId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'load', versionId, 'grid'],
    queryFn: async () =>
      gridSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/grid', {
            params: { header: branchHeader(), path: { id: versionId ?? '' } },
          }),
        ),
      ),
    enabled: branchId !== null && versionId !== null,
  });

/** Step 7: a load row placed at a slot with its whole block. */
export const placeBlock = (versionId: string, record: PlaceRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/pattern', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: record,
    }),
  ).then((answer) => gridSchema.parse(answer));

/** Step 7: a block moved whole to a weekday and slot. */
export const moveBlock = (versionId: string, blockId: string, record: MoveRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/pattern/{blockId}/move', {
      params: { header: branchHeader(), path: { id: versionId, blockId } },
      body: record,
    }),
  ).then((answer) => gridSchema.parse(answer));

/** Step 7: two blocks exchange their slots. */
export const swapBlocks = (versionId: string, record: SwapRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/pattern/swap', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: record,
    }),
  ).then((answer) => gridSchema.parse(answer));

/** Step 7: a suggestion of "Suggest a place" applied, up to three blocks at once (task 5.4b-2b). */
export const rearrangeBlocks = (versionId: string, record: RearrangeRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/pattern/rearrange', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: record,
    }),
  ).then((answer) => gridSchema.parse(answer));

/** Step 7: a block removed with its lessons. */
export const removeBlock = (versionId: string, blockId: string) =>
  answerOf(
    api.DELETE('/api/timetable/versions/{id}/pattern/{blockId}', {
      params: { header: branchHeader(), path: { id: versionId, blockId } },
    }),
  ).then((answer) => gridSchema.parse(answer));

/** Step 7: the room of one lesson of a block, from the room picker (task 5.4b-2a). */
export const changeLessonRoom = (versionId: string, blockId: string, record: LessonRoomRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/pattern/{blockId}/room', {
      params: { header: branchHeader(), path: { id: versionId, blockId } },
      body: record,
    }),
  ).then((answer) => gridSchema.parse(answer));

/**
 * The draft's edit lock taken or kept (task 5.4c-1): "Take over", and the
 * holder's "still here" after a key or a pointer in the builder.
 */
export const takeEditLock = (versionId: string) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/edit-lock', {
      params: { header: branchHeader(), path: { id: versionId } },
    }),
  ).then((answer) => timetableVersionSchema.parse(answer));

/** Step 7: a lesson, class, teacher or weekday locked (task 5.4c-1). */
export const createLock = (versionId: string, record: TimetableLockRecord) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/locks', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: record,
    }),
  ).then((answer) => gridSchema.parse(answer));

/** Step 7: a lock removed (task 5.4c-1). */
export const deleteLock = (versionId: string, lockId: string) =>
  answerOf(
    api.DELETE('/api/timetable/versions/{id}/locks/{lockId}', {
      params: { header: branchHeader(), path: { id: versionId, lockId } },
    }),
  ).then((answer) => gridSchema.parse(answer));

/** What a publish on a date would refuse and warn (task 5.5a-1), written nowhere. */
export const publishCheckQuery = (
  branchId: string | null,
  versionId: string | null,
  startsOn: string | null,
  /** Task 5.5a-3a: the answer to the later published versions, when one is chosen. */
  chain: PublishChain | null = null,
) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'load', versionId, 'publish-check', startsOn, chain],
    queryFn: async () =>
      publishCheckSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/publish-check', {
            params: {
              header: branchHeader(),
              path: { id: versionId ?? '' },
              query:
                chain === null ? { startsOn: startsOn ?? '' } : { startsOn: startsOn ?? '', chain },
            },
          }),
        ),
      ),
    enabled: branchId !== null && versionId !== null && startsOn !== null,
  });

/** The publish of a draft from a start date (task 5.5a-1); `key` makes a repeat harmless. */
export const publishVersion = (
  versionId: string,
  startsOn: string,
  key: string,
  transitionKey: string | null = null,
  /** Task 5.5a-3a: the answer and the key of the later versions shown. */
  chain: { chain: PublishChain; laterKey: string } | null = null,
  /** Task 5.6a-5a: the key of the one-day changes shown and a choice for each "needs a decision" item. */
  days: {
    dayChangesKey: string;
    dayDecisions: {
      key: string;
      blockId?: string;
      blockDate?: string;
      choice: DayChangeChoice;
    }[];
  } | null = null,
) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/publish', {
      params: {
        header: { ...branchHeader(), 'Idempotency-Key': key },
        path: { id: versionId },
      },
      body: {
        startsOn,
        ...(transitionKey === null ? {} : { transitionKey }),
        ...(chain === null ? {} : chain),
        ...(days === null ? {} : days),
      },
    }),
  ).then((answer) => timetableVersionSchema.parse(answer));

/** The withdraw of a published version before its start (task 5.5c-2a); `key` makes a repeat harmless. */
/**
 * What a withdraw would do with the stored one-day changes and bulk cancels
 * of the withdrawn dates (task 5.6a-5b-2), read when the dialog opens.
 */
export const withdrawCheckQuery = (branchId: string | null, versionId: string) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'load', versionId, 'withdraw-check'],
    queryFn: async () =>
      withdrawCheckSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/withdraw-check', {
            params: { header: branchHeader(), path: { id: versionId } },
          }),
        ),
      ),
  });

/** Task 5.6a-5b-2: with the key of the sorting shown and the choices of its "needs a decision" items. */
export const withdrawVersion = (versionId: string, key: string, body: WithdrawBody) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/withdraw', {
      params: {
        header: { ...branchHeader(), 'Idempotency-Key': key },
        path: { id: versionId },
      },
      body,
    }),
  ).then((answer) => timetableVersionSchema.parse(answer));

/** The causes of a draft's mark out of date and their key (task 5.5a-3b-1). */
export const outOfDateQuery = (branchId: string | null, versionId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'load', versionId, 'out-of-date'],
    queryFn: async () =>
      outOfDateAnswerSchema.parse(
        await answerOf(
          api.GET('/api/timetable/versions/{id}/out-of-date', {
            params: { header: branchHeader(), path: { id: versionId ?? '' } },
          }),
        ),
      ),
    enabled: branchId !== null && versionId !== null,
  });

/**
 * A draft brought up to date with the key of what was shown (task 5.5a-3b-1);
 * after a publish, with a pick for every difference (task 5.5a-3b-2).
 */
export const bringUpToDate = (
  versionId: string,
  key: string,
  picks: readonly { item: string; side: UpToDateSide }[] = [],
) =>
  answerOf(
    api.POST('/api/timetable/versions/{id}/up-to-date', {
      params: { header: branchHeader(), path: { id: versionId } },
      body: { key, picks: [...picks] },
    }),
  ).then((answer) => timetableVersionSchema.parse(answer));

/** The stored lessons of a class on a date (task 5.6a-1). */
export const dayQuery = (branchId: string | null, date: string | null, classId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'day', date, classId],
    queryFn: async () =>
      dayAnswerSchema.parse(
        await answerOf(
          api.GET('/api/timetable/day', {
            params: {
              header: branchHeader(),
              query: { date: date ?? '', classId: classId ?? '' },
            },
          }),
        ),
      ),
    enabled: branchId !== null && date !== null && classId !== null,
  });

/** A one-day cancel of a lesson with its reason (task 5.6a-1); `key` makes a repeat harmless. */
export const cancelLesson = (lessonId: string, body: LessonCancelBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/lessons/{id}/cancel', {
      params: {
        header: { ...branchHeader(), 'Idempotency-Key': key },
        path: { id: lessonId },
      },
      body,
    }),
  ).then((answer) => dayChangeAnswerSchema.parse(answer));

/**
 * The restore of a one-day cancel (task 5.6a-1), into another room with a
 * reason when given (task 5.6a-2); `key` makes a repeat harmless.
 */
export const restoreLesson = (lessonId: string, key: string, body: LessonRestoreBody = {}) =>
  answerOf(
    api.POST('/api/timetable/lessons/{id}/restore', {
      params: {
        header: { ...branchHeader(), 'Idempotency-Key': key },
        path: { id: lessonId },
      },
      body,
    }),
  ).then((answer) => dayChangeAnswerSchema.parse(answer));

/** What a bulk cancel would do (task 5.6a-3); writes nothing. */
export const checkBulkCancel = (body: BulkCancelCheckBody) =>
  answerOf(
    api.POST('/api/timetable/bulk-cancels/check', {
      params: { header: branchHeader() },
      body,
    }),
  ).then((answer) => bulkCancelCheckAnswerSchema.parse(answer));

/** The bulk cancel with its reason and choices (task 5.6a-3); `key` makes a repeat harmless. */
export const saveBulkCancel = (body: BulkCancelBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/bulk-cancels', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key } },
      body,
    }),
  ).then((answer) => bulkCancelAnswerSchema.parse(answer));

/** A one-day room change with a reason (task 5.6a-2); `key` makes a repeat harmless. */
export const changeDayRoom = (lessonId: string, body: LessonRoomBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/lessons/{id}/room', {
      params: {
        header: { ...branchHeader(), 'Idempotency-Key': key },
        path: { id: lessonId },
      },
      body,
    }),
  ).then((answer) => dayChangeAnswerSchema.parse(answer));

/** A one-day move to a lesson slot of a date, with a reason (task 5.6a-2). */
export const moveDayLesson = (lessonId: string, body: LessonMoveBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/lessons/{id}/move', {
      params: {
        header: { ...branchHeader(), 'Idempotency-Key': key },
        path: { id: lessonId },
      },
      body,
    }),
  ).then((answer) => dayChangeAnswerSchema.parse(answer));

/** The correction of a past lesson with its reason (task 5.6a-4); `key` makes a repeat harmless. */
export const correctLesson = (lessonId: string, body: LessonCorrectionBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/lessons/{id}/correction', {
      params: {
        header: { ...branchHeader(), 'Idempotency-Key': key },
        path: { id: lessonId },
      },
      body,
    }),
  ).then((answer) => dayChangeAnswerSchema.parse(answer));

/** The people who may be recorded as having taught a past lesson (task 5.6a-4, decision 4). */
export const correctionTeachersQuery = (
  branchId: string | null,
  lessonId: string,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'correction-teachers', lessonId],
    queryFn: async () =>
      correctionTeachersAnswerSchema.parse(
        await answerOf(
          api.GET('/api/timetable/lessons/{id}/correction-teachers', {
            params: { header: branchHeader(), path: { id: lessonId } },
          }),
        ),
      ),
    enabled: branchId !== null && enabled,
  });

/** The exams of one date (task 5.6c-2), standing and cancelled. */
export const examsQuery = (branchId: string | null, date: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'exams', date],
    queryFn: async () =>
      examsAnswerSchema.parse(
        await answerOf(
          api.GET('/api/timetable/exams', {
            params: { header: branchHeader(), query: { from: date ?? '', to: date ?? '' } },
          }),
        ),
      ),
    enabled: branchId !== null && date !== null,
  });

/** What a save of the exam would do (task 5.6c-2); writes nothing. */
export const checkExam = (body: ExamCheckBody) =>
  answerOf(
    api.POST('/api/timetable/exams/check', { params: { header: branchHeader() }, body }),
  ).then((answer) => examCheckSchema.parse(answer));

/** A new exam (task 5.6c-2); `key` makes a repeat harmless. */
export const createExam = (body: ExamCreateBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/exams', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key } },
      body,
    }),
  ).then((answer) => examSaveAnswerSchema.parse(answer));

/** A change of an exam (task 5.6c-2); `key` makes a repeat harmless. */
export const changeExam = (id: string, body: ExamBody, key: string) =>
  answerOf(
    api.PUT('/api/timetable/exams/{id}', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key }, path: { id } },
      body,
    }),
  ).then((answer) => examSaveAnswerSchema.parse(answer));

/** The cancel of an exam (task 5.6c-2); `key` makes a repeat harmless. */
export const cancelExam = (id: string, body: ExamCancelBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/exams/{id}/cancel', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key }, path: { id } },
      body,
    }),
  ).then((answer) => examSaveAnswerSchema.parse(answer));

/** The absences of the persons of the branch (task 5.7a-1), every state. */
export const absencesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'absences'],
    queryFn: async () =>
      absenceListSchema.parse(
        await answerOf(
          api.GET('/api/timetable/absences', {
            params: { header: branchHeader(), query: { state: 'all' } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The branch's own lessons inside an absence (task 5.7a-1). */
export const absenceLessonsQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'absences', id, 'lessons'],
    queryFn: async () =>
      absenceLessonsSchema.parse(
        await answerOf(
          api.GET('/api/timetable/absences/{id}/lessons', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The home page's "needs a teacher" and "unresolved" lists (task 5.7a-1). */
export const attentionQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...timetableKey(branchId), 'attention'],
    queryFn: async () =>
      attentionSchema.parse(
        await answerOf(api.GET('/api/timetable/attention', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const createAbsence = (body: AbsenceRecord) =>
  answerOf(api.POST('/api/timetable/absences', { params: { header: branchHeader() }, body })).then(
    (answer) => absenceSchema.parse(answer),
  );

export const editAbsence = (id: string, body: AbsenceEdit) =>
  answerOf(
    api.PATCH('/api/timetable/absences/{id}', {
      params: { header: branchHeader(), path: { id } },
      body,
    }),
  ).then((answer) => absenceSchema.parse(answer));

export const withdrawAbsence = (id: string) =>
  answerOf(
    api.POST('/api/timetable/absences/{id}/withdraw', {
      params: { header: branchHeader(), path: { id } },
    }),
  ).then((answer) => absenceSchema.parse(answer));
