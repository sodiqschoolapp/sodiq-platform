import {
  actingTeacherCheckSchema,
  actingTeacherSchema,
  type ActingTeacherBody,
  accountAccessSchema,
  appointmentListSchema,
  availabilitySchema,
  loginSuggestionSchema,
  neverUsedListSchema,
  personalDataReportSchema,
  relativeDetailSchema,
  relativeListSchema,
  relativeNoValidPhoneSchema,
  relativePhoneMatchResultSchema,
  staffAccountSchema,
  staffDetailSchema,
  staffListSchema,
  studentDetailSchema,
  studentListSchema,
  studentNoClassSchema,
  studentRelativesSchema,
  vacancyDetailSchema,
  vacancyFillCheckSchema,
  vacancyFillSchema,
  vacancyListSchema,
  type VacancyFillBody,
  type VacancyFillCheckBody,
  type PersonalDataKind,
  type PersonalDataReport,
  type RelativePhoneMatchResult,
  studentHistorySchema,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { divisionsKey } from '@/features/setup/setup-api';

export const PEOPLE_KEY = ['people'] as const;

/**
 * The staff of the branch of the switcher (task 2.2a). A record is the same
 * in every branch its person works in, so a change marks the lists of every
 * branch stale.
 */
export const staffKey = (branchId?: string | null) =>
  branchId === undefined ? [...PEOPLE_KEY, 'staff'] : [...PEOPLE_KEY, 'staff', branchId];

export const staffQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: staffKey(branchId),
    queryFn: async () =>
      staffListSchema.parse(
        await answerOf(api.GET('/api/people/staff', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** One person with the status history and what the account may change. */
export const staffDetailQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...staffKey(branchId), 'detail', id],
    queryFn: async () =>
      staffDetailSchema.parse(
        await answerOf(
          api.GET('/api/people/staff/{id}', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** After a change of a record: every staff list and the staff counts of the divisions. */
export const invalidateStaff = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: staffKey() }),
    queryClient.invalidateQueries({ queryKey: divisionsKey() }),
  ]);

/**
 * The account section of a record (task 2.3a): its account and roles, or
 * none yet. Never holds a first password: the slip lives only in the dialog
 * that shows it (correction 4 of the review of pull request #62).
 */
export const staffAccountKey = (id?: string) =>
  id === undefined ? [...PEOPLE_KEY, 'account'] : [...PEOPLE_KEY, 'account', id];

export const staffAccountQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...staffAccountKey(id), branchId],
    queryFn: async () =>
      staffAccountSchema.parse(
        await answerOf(
          api.GET('/api/people/staff/{id}/account', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The first free login of the owner's answer 14, read when the create form opens. */
export const loginSuggestionQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...staffAccountKey(id), 'suggestion', branchId],
    queryFn: async () =>
      loginSuggestionSchema.parse(
        await answerOf(
          api.GET('/api/people/staff/{id}/account/suggestion', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
    staleTime: 0,
    gcTime: 0,
  });

/** The hours of a record in the branch of the switcher, and the others read only (task 2.2b). */
export const availabilityQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...PEOPLE_KEY, 'availability', branchId, id],
    queryFn: async () =>
      availabilitySchema.parse(
        await answerOf(
          api.GET('/api/people/staff/{id}/availability', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The vacancies of the branch of the switcher (task 2.2b). */
export const vacanciesKey = (branchId?: string | null) =>
  branchId === undefined ? [...PEOPLE_KEY, 'vacancies'] : [...PEOPLE_KEY, 'vacancies', branchId];

export const vacanciesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: vacanciesKey(branchId),
    queryFn: async () =>
      vacancyListSchema.parse(
        await answerOf(api.GET('/api/people/vacancies', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const vacancyDetailQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...vacanciesKey(branchId), 'detail', id],
    queryFn: async () =>
      vacancyDetailSchema.parse(
        await answerOf(
          api.GET('/api/people/vacancies/{id}', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/**
 * What a fill of a vacancy would do (task 5.7a-3b; `POST
 * /api/timetable/vacancy-fills/check`, nothing written), read as a query of
 * its body; a refusal is shown, never retried.
 */
export const vacancyFillCheckQuery = (branchId: string | null, body: VacancyFillCheckBody | null) =>
  queryOptions({
    queryKey: [...vacanciesKey(branchId), 'fill-check', body],
    queryFn: async () => {
      // Never runs without a body: the query is off until there is one.
      if (body === null) throw new Error('vacancy fill check without a body');
      return vacancyFillCheckSchema.parse(
        await answerOf(
          api.POST('/api/timetable/vacancy-fills/check', {
            params: { header: branchHeader() },
            body,
          }),
        ),
      );
    },
    enabled: branchId !== null && body !== null,
    retry: false,
  });

/** The fill of a vacancy (task 5.7a-3b); `key` makes a repeat harmless. */
export const fillVacancy = (body: VacancyFillBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/vacancy-fills', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key } },
      body,
    }),
  ).then((answer) => vacancyFillSchema.parse(answer));

/** Task 5.7a-3c: what naming an acting teacher would meet, nothing written. */
export const actingCheckQuery = (branchId: string | null, body: ActingTeacherBody | null) =>
  queryOptions({
    queryKey: [...vacanciesKey(branchId), 'acting-check', body],
    queryFn: async () => {
      // Never runs without a body: the query is off until there is one.
      if (body === null) throw new Error('acting check without a body');
      return actingTeacherCheckSchema.parse(
        await answerOf(
          api.POST('/api/timetable/acting-teachers/check', {
            params: { header: branchHeader() },
            body,
          }),
        ),
      );
    },
    enabled: branchId !== null && body !== null,
    retry: false,
  });

/** Task 5.7a-3c: names an acting teacher; safe to repeat with its key. */
export const nameActing = (body: ActingTeacherBody, key: string) =>
  answerOf(
    api.POST('/api/timetable/acting-teachers', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key } },
      body,
    }),
  ).then((answer) => actingTeacherSchema.parse(answer));

/** Task 5.7a-3c: ends a period on a day, or withdraws a planned one (its start); safe to repeat with its key. */
export const endActing = (id: string, until: string, key: string) =>
  answerOf(
    api.POST('/api/timetable/acting-teachers/{id}/end', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key }, path: { id } },
      body: { until },
    }),
  ).then((answer) => actingTeacherSchema.parse(answer));

/** After a change of a vacancy: the vacancy lists. */
export const invalidateVacancies = (queryClient: QueryClient): Promise<unknown> =>
  queryClient.invalidateQueries({ queryKey: vacanciesKey() });

/** Reads a photo as a `data:` address the page can show and keep in memory. */
function dataUrlOf(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new ApiFailure('no_answer'));
      }
    };
    reader.onerror = () => {
      reject(new ApiFailure('no_answer'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The photo of a staff record (task 2.2c-2), kept in memory for the session
 * under its id: a new photo has a new id, and the API lets no browser cache
 * keep it (decision 6). `null` when the record has none.
 */
export const staffPhotoQuery = (branchId: string | null, id: string, photoId: string | null) =>
  queryOptions({
    queryKey: [...PEOPLE_KEY, 'photo', id, photoId],
    queryFn: async () => {
      // The document calls the photo a binary string; with `parseAs: 'blob'` it is a Blob.
      const file: unknown = await answerOf(
        api.GET('/api/people/staff/{id}/photo', {
          params: { header: branchHeader(), path: { id } },
          parseAs: 'blob',
        }),
      );
      if (!(file instanceof Blob)) {
        throw new ApiFailure('no_answer');
      }
      return dataUrlOf(file);
    },
    enabled: branchId !== null && photoId !== null,
    staleTime: Infinity,
    retry: false,
  });

/** Sends a photo the browser has shrunk (`shrinkPhoto`); the answer is the record as it now is. */
export const setStaffPhoto = (id: string, photo: Blob) =>
  answerOf(
    api.PUT('/api/people/staff/{id}/photo', {
      params: { header: branchHeader(), path: { id } },
      // The document types the body as a binary string; the browser sends the Blob as it is.
      body: photo as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': photo.type },
    }),
  );

export const removeStaffPhoto = (id: string) =>
  answerOf(
    api.DELETE('/api/people/staff/{id}/photo', {
      params: { header: branchHeader(), path: { id } },
    }),
  );

export const headTeachersKey = (branchId?: string | null) =>
  branchId === undefined
    ? [...PEOPLE_KEY, 'head-teachers']
    : [...PEOPLE_KEY, 'head-teachers', branchId];

/**
 * The Head Teacher and Senior Head Teacher appointments of the branch, current
 * and planned (task 2.3b-1, `GET access/head-teachers`); a Head Teacher or
 * Senior Head Teacher gets their own subjects only.
 */
export const headTeachersQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: headTeachersKey(branchId),
    queryFn: async () =>
      appointmentListSchema.parse(
        await answerOf(
          api.GET('/api/access/head-teachers', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** After a give, a change or an end of an appointment, or a status change that ends or brings back roles. */
export const invalidateHeadTeachers = (queryClient: QueryClient): Promise<unknown> =>
  queryClient.invalidateQueries({ queryKey: headTeachersKey() });

/**
 * The sign-in access of a record's account (task 2.3c-1): its lock, a reset
 * in force, and what the reader may do. Never holds a one-time password: the
 * slip lives only in the dialog that shows it.
 */
export const accountAccessKey = (id?: string) =>
  id === undefined ? [...PEOPLE_KEY, 'access'] : [...PEOPLE_KEY, 'access', id];

export const accountAccessQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...accountAccessKey(id), branchId],
    queryFn: async () =>
      accountAccessSchema.parse(
        await answerOf(
          api.GET('/api/people/staff/{id}/account/access', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The accounts never used of the branch (task 2.3c-1, decision 10). */
export const neverUsedKey = (branchId?: string | null) =>
  branchId === undefined ? [...PEOPLE_KEY, 'never-used'] : [...PEOPLE_KEY, 'never-used', branchId];

export const neverUsedQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: neverUsedKey(branchId),
    queryFn: async () =>
      neverUsedListSchema.parse(
        await answerOf(
          api.GET('/api/people/accounts/never-used', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The students of the branch of the switcher (task 2.4a); a student belongs to one branch. */
export const studentsKey = (branchId?: string | null) =>
  branchId === undefined ? [...PEOPLE_KEY, 'students'] : [...PEOPLE_KEY, 'students', branchId];

/**
 * `consent: 'missing'`: the active students without consent (answer 23),
 * which the server gives the Financial readers only (task 2.4b-2).
 */
export const studentsQuery = (branchId: string | null, consent?: 'missing') =>
  queryOptions({
    queryKey: consent === undefined ? studentsKey(branchId) : [...studentsKey(branchId), consent],
    queryFn: async () =>
      studentListSchema.parse(
        await answerOf(
          api.GET('/api/people/students', {
            params: { header: branchHeader(), query: consent === undefined ? {} : { consent } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The "No class" counter of the Academic Vice Principal's home page (task 2.4b-2). */
export const studentNoClassQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'no-class'],
    queryFn: async () =>
      studentNoClassSchema.parse(
        await answerOf(
          api.GET('/api/people/students/no-class', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The photo of a student (task 2.4b-2), kept in memory under its id as the staff photo. */
export const studentPhotoQuery = (branchId: string | null, id: string, photoId: string | null) =>
  queryOptions({
    queryKey: [...PEOPLE_KEY, 'student-photo', id, photoId],
    queryFn: async () => {
      const file: unknown = await answerOf(
        api.GET('/api/people/students/{id}/photo', {
          params: { header: branchHeader(), path: { id } },
          parseAs: 'blob',
        }),
      );
      if (!(file instanceof Blob)) {
        throw new ApiFailure('no_answer');
      }
      return dataUrlOf(file);
    },
    enabled: branchId !== null && photoId !== null,
    staleTime: Infinity,
    retry: false,
  });

/** Sends a photo the browser has shrunk (`shrinkPhoto`). */
export const setStudentPhoto = (id: string, photo: Blob) =>
  answerOf(
    api.PUT('/api/people/students/{id}/photo', {
      params: { header: branchHeader(), path: { id } },
      body: photo as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': photo.type },
    }),
  );

export const removeStudentPhoto = (id: string) =>
  answerOf(
    api.DELETE('/api/people/students/{id}/photo', {
      params: { header: branchHeader(), path: { id } },
    }),
  );

/** The History tab of a student (task 3.3a): its moves, joins and statuses, newest first. */
export const studentHistoryQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'history', id],
    queryFn: async () =>
      studentHistorySchema.parse(
        await answerOf(
          api.GET('/api/people/students/{id}/history', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** One student with the groups of fields the account may read. */
export const studentDetailQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'detail', id],
    queryFn: async () =>
      studentDetailSchema.parse(
        await answerOf(
          api.GET('/api/people/students/{id}', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** After a change of a student: every student list. */
export const invalidateStudents = (queryClient: QueryClient): Promise<unknown> =>
  queryClient.invalidateQueries({ queryKey: studentsKey() });

/**
 * The relatives of the branch of the switcher, the Parents (task 2.5a). A
 * relative is the same record in every branch with a linked student, so a
 * change marks every branch's list stale.
 */
export const relativesKey = (branchId?: string | null) =>
  branchId === undefined ? [...PEOPLE_KEY, 'relatives'] : [...PEOPLE_KEY, 'relatives', branchId];

/**
 * `filter: 'no_valid_phone'`: the relatives with no valid phone and a student
 * of the branch active today (`edge/close-relatives`, row 2; task 2.5b-1),
 * decided by the server.
 */
export const relativesQuery = (branchId: string | null, filter?: 'no_valid_phone') =>
  queryOptions({
    queryKey: filter === undefined ? relativesKey(branchId) : [...relativesKey(branchId), filter],
    queryFn: async () =>
      relativeListSchema.parse(
        await answerOf(
          api.GET('/api/people/relatives', {
            params: { header: branchHeader(), query: filter === undefined ? {} : { filter } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The number of relatives with no valid phone, for the Academic Vice Principal's home (task 2.5b-1). */
export const relativeNoValidPhoneQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...relativesKey(branchId), 'no-valid-phone-count'],
    queryFn: async () =>
      relativeNoValidPhoneSchema.parse(
        await answerOf(
          api.GET('/api/people/relatives/no-valid-phone', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** One relative with the students of the branch and the count of the others. */
export const relativeDetailQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...relativesKey(branchId), 'detail', id],
    queryFn: async () =>
      relativeDetailSchema.parse(
        await answerOf(
          api.GET('/api/people/relatives/{id}', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The Relatives tab of a student; kept under the student, so a student change reads it again. */
export const studentRelativesQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'relatives', id],
    queryFn: async () =>
      studentRelativesSchema.parse(
        await answerOf(
          api.GET('/api/people/students/{id}/relatives', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** After a change of a relative or a link: every Parents list and every student. */
export const invalidateRelatives = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: relativesKey() }),
    queryClient.invalidateQueries({ queryKey: studentsKey() }),
  ]);

/** The phone typed first (`04`, Adding a relative): the holder of that phone, or none. */
export async function phoneMatch(phone: string): Promise<RelativePhoneMatchResult> {
  return relativePhoneMatchResultSchema.parse(
    await answerOf(
      api.POST('/api/people/relatives/phone-match', {
        params: { header: branchHeader() },
        body: { phone },
      }),
    ),
  );
}

/**
 * Produces the personal data report of a person (task 2.6b): an export of
 * the Super Admin, logged by the server at each call (decision 8). Called only
 * from a mutation that keeps the answer in no cache and outside the offline
 * queue, since it holds Identity.
 */
export async function producePersonalDataReport(
  kind: PersonalDataKind,
  id: string,
): Promise<PersonalDataReport> {
  const params = { params: { header: branchHeader(), path: { id } } };
  const answer =
    kind === 'student'
      ? await answerOf(api.POST('/api/people/students/{id}/report', params))
      : kind === 'staff'
        ? await answerOf(api.POST('/api/people/staff/{id}/report', params))
        : await answerOf(api.POST('/api/people/relatives/{id}/report', params));
  return personalDataReportSchema.parse(answer);
}
