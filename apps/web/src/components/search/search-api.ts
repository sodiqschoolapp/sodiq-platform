import {
  classSearchSchema,
  groupSearchSchema,
  relativeSearchSchema,
  staffSearchSchema,
  studentSearchSchema,
  type ClassFound,
  type GroupFound,
  type RelativeFound,
  type StaffFound,
  type StudentFound,
} from '@sodiq/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The kinds of records Ctrl+K searches, in the order of `12` ("students,
 * staff, relatives ..., classes, groups"), each with the area of its record
 * route (task 3.2d, decision 3; relatives, task 3.5b, H33 of issue #105) and
 * the list that opens it.
 */
export const RECORD_KINDS = [
  { kind: 'students', area: 'students', list: '/people/students' },
  { kind: 'staff', area: 'staff', list: '/people/staff' },
  { kind: 'relatives', area: 'relatives', list: '/people/parents' },
  { kind: 'classes', area: 'classes', list: '/classes' },
  { kind: 'groups', area: 'groups', list: '/groups' },
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number]['kind'];

export type RecordList = (typeof RECORD_KINDS)[number]['list'];

/** What each kind answers. */
export interface Found {
  students: StudentFound;
  staff: StaffFound;
  relatives: RelativeFound;
  classes: ClassFound;
  groups: GroupFound;
}

/** At most 8 records of a kind, and whether a further one matched. */
export interface FoundOf<Kind extends RecordKind> {
  items: Found[Kind][];
  more: boolean;
  /** Today in the branch's time zone: the students' answer has it (issue #105, H13). */
  today?: string;
}

/** From the second typed character (decision 7). */
export const SEARCH_FROM_LENGTH = 2;

async function read(kind: RecordKind, q: string): Promise<FoundOf<RecordKind>> {
  const params = { header: branchHeader(), query: { q } };
  switch (kind) {
    case 'students':
      return studentSearchSchema.parse(await answerOf(api.GET('/api/search/students', { params })));
    case 'staff':
      return staffSearchSchema.parse(await answerOf(api.GET('/api/search/staff', { params })));
    case 'relatives':
      return relativeSearchSchema.parse(
        await answerOf(api.GET('/api/search/relatives', { params })),
      );
    case 'classes':
      return classSearchSchema.parse(await answerOf(api.GET('/api/search/classes', { params })));
    case 'groups':
      return groupSearchSchema.parse(await answerOf(api.GET('/api/search/groups', { params })));
  }
}

/**
 * The records of one kind that match the typed text, in the branch of the
 * tab; the server folds the text itself. The previous answer stays on screen
 * while the next one is read, so the list does not jump (`12`, Look and feel).
 */
export const recordSearchQuery = (
  kind: RecordKind,
  branchId: string | null,
  q: string,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ['search', kind, branchId, q],
    queryFn: () => read(kind, q),
    enabled: enabled && branchId !== null && q.length >= SEARCH_FROM_LENGTH,
    placeholderData: keepPreviousData,
  });
