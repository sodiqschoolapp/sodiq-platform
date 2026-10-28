import {
  attendanceReportSchema,
  disciplineItemsSchema,
  loadReportSchema,
  resultsReportChoicesSchema,
  resultsTableSchema,
  subjectMasterySchema,
  type AttendanceGrouping,
  type DisciplineColumn,
  type ResultsReportExport,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';

/**
 * The reports of `08`, Analytics in Release 1 (task 9.3b-2). Every count, percent and grade is
 * the server's, from `packages/calc`; the browser calculates nothing.
 */

export interface AttendanceFilters {
  readonly from: string;
  readonly to: string;
  readonly grade?: number;
  readonly classId?: string;
  readonly subjectId?: string;
  readonly teacherId?: string;
  readonly start?: number;
  readonly groupBy: AttendanceGrouping;
}

const attendanceBody = (filters: AttendanceFilters) => ({
  from: filters.from,
  to: filters.to,
  groupBy: filters.groupBy,
  ...(filters.grade === undefined ? {} : { grade: filters.grade }),
  ...(filters.classId === undefined ? {} : { classId: filters.classId }),
  ...(filters.subjectId === undefined ? {} : { subjectId: filters.subjectId }),
  ...(filters.teacherId === undefined ? {} : { teacherId: filters.teacherId }),
  ...(filters.start === undefined ? {} : { start: filters.start }),
});

export const attendanceReportQuery = (branchId: string | null, filters: AttendanceFilters) =>
  queryOptions({
    queryKey: ['results', branchId, 'reports', 'attendance', attendanceBody(filters)],
    queryFn: async () =>
      attendanceReportSchema.parse(
        await answerOf(
          api.GET('/api/results/reports/attendance', {
            params: { header: branchHeader(), query: attendanceBody(filters) },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const resultsReportChoicesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: ['results', branchId, 'reports', 'choices'],
    queryFn: async () =>
      resultsReportChoicesSchema.parse(
        await answerOf(
          api.GET('/api/results/reports/choices', {
            params: { header: branchHeader(), query: {} },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const resultsTableQuery = (
  branchId: string | null,
  quarterId: string | undefined,
  classId: string | undefined,
) =>
  queryOptions({
    queryKey: ['results', branchId, 'reports', 'table', quarterId ?? null, classId ?? null],
    queryFn: async () =>
      resultsTableSchema.parse(
        await answerOf(
          api.GET('/api/results/reports/results-table', {
            params: {
              header: branchHeader(),
              query: { quarterId: quarterId ?? '', classId: classId ?? '' },
            },
          }),
        ),
      ),
    enabled: branchId !== null && quarterId !== undefined && classId !== undefined,
  });

export interface MasteryFilters {
  readonly quarterId?: string;
  readonly subjectId?: string;
  readonly grade?: number;
  readonly classId?: string;
  readonly teacherId?: string;
}

export const subjectMasteryQuery = (branchId: string | null, filters: MasteryFilters) =>
  queryOptions({
    queryKey: ['results', branchId, 'reports', 'mastery', filters],
    queryFn: async () =>
      subjectMasterySchema.parse(
        await answerOf(
          api.GET('/api/results/reports/subject-mastery', {
            params: {
              header: branchHeader(),
              query: {
                quarterId: filters.quarterId ?? '',
                subjectId: filters.subjectId ?? '',
                ...(filters.grade === undefined ? {} : { grade: filters.grade }),
                ...(filters.classId === undefined ? {} : { classId: filters.classId }),
                ...(filters.teacherId === undefined ? {} : { teacherId: filters.teacherId }),
              },
            },
          }),
        ),
      ),
    enabled:
      branchId !== null && filters.quarterId !== undefined && filters.subjectId !== undefined,
  });

export const loadReportQuery = (
  branchId: string | null,
  week: string,
  departmentId: string | undefined,
) =>
  queryOptions({
    queryKey: ['timetable', branchId, 'reports', 'load', week, departmentId ?? null],
    queryFn: async () =>
      loadReportSchema.parse(
        await answerOf(
          api.GET('/api/timetable/reports/load', {
            params: {
              header: branchHeader(),
              query: { week, ...(departmentId === undefined ? {} : { departmentId }) },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const disciplineItemsQuery = (
  branchId: string | null,
  input: {
    from: string;
    to: string;
    departmentId: string | null;
    teacherId: string;
    column: DisciplineColumn;
  },
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ['journal', branchId, 'discipline', 'items', input],
    queryFn: async () =>
      disciplineItemsSchema.parse(
        await answerOf(
          api.GET('/api/journal/discipline/items', {
            params: {
              header: branchHeader(),
              query: {
                from: input.from,
                to: input.to,
                teacherId: input.teacherId,
                column: input.column,
                ...(input.departmentId === null ? {} : { departmentId: input.departmentId }),
              },
            },
          }),
        ),
      ),
    enabled: enabled && branchId !== null,
  });

/** A file of the server, saved under its name. */
async function saved(
  result: Promise<{ response: Response; data?: unknown; error?: unknown }>,
  fallback: string,
): Promise<void> {
  const answer = await result;
  const file: unknown = await answerOf(Promise.resolve(answer));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(answer.response.headers.get('Content-Disposition'), fallback));
}

export const exportAttendance = (filters: AttendanceFilters): Promise<void> =>
  saved(
    api.POST('/api/results/reports/attendance/export', {
      params: { header: branchHeader() },
      body: attendanceBody(filters),
      parseAs: 'blob',
    }),
    'attendance.xlsx',
  );

export const exportResultsReport = (body: ResultsReportExport): Promise<void> =>
  saved(
    api.POST('/api/results/reports/export', {
      params: { header: branchHeader() },
      body,
      parseAs: 'blob',
    }),
    'results.xlsx',
  );

export const exportLoadReport = (week: string, departmentId: string | undefined): Promise<void> =>
  saved(
    api.POST('/api/timetable/reports/load/export', {
      params: { header: branchHeader() },
      body: { week, ...(departmentId === undefined ? {} : { departmentId }) },
      parseAs: 'blob',
    }),
    'load.xlsx',
  );

export const exportDiscipline = (range: {
  from: string;
  to: string;
  departmentId: string | null;
}): Promise<void> =>
  saved(
    api.POST('/api/journal/discipline/export', {
      params: { header: branchHeader() },
      body: {
        from: range.from,
        to: range.to,
        ...(range.departmentId === null ? {} : { departmentId: range.departmentId }),
      },
      parseAs: 'blob',
    }),
    'discipline.xlsx',
  );
