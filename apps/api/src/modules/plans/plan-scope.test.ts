import type { Role } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import type { CurrentAssignment } from '../access/current-assignments.js';
import type { Access } from '../access/permission.guard.js';
import type { JournalRow } from '../journal/journal-grid.query.js';
import { planReachOf, type PlanReader } from './plan-scope.js';
import { fileMatchesType } from './file-type.js';

const SUBJECT = '0199a000-0000-7000-8000-00000000000a';
const OTHER = '0199a000-0000-7000-8000-00000000000b';
const ME = '0199a000-0000-7000-8000-00000000000c';
const SOMEONE = '0199a000-0000-7000-8000-00000000000d';

const assignment = (role: Role, subjectIds: readonly string[] = []): CurrentAssignment => ({
  id: `${role}-assignment`,
  role,
  branchId: null,
  subjectIds,
  classIds: [],
});

const readerOf = (
  roles: readonly CurrentAssignment[],
  profile: Record<string, readonly number[]> = {},
): PlanReader => {
  const access = {
    accountId: 'account',
    assignmentId: roles[0]?.id ?? '',
    role: roles[0]?.role ?? 'teacher',
    branchId: null,
    branchIds: [],
    assignments: roles,
    permitting: roles,
  } as unknown as Access;
  const teacher = roles.find((one) => one.role === 'teacher');
  return {
    access,
    teacherAssignmentId: teacher?.id ?? null,
    staffId: teacher === undefined ? null : ME,
    profile: new Map(Object.entries(profile)),
  };
};

/** A journal of the subject for a unit of `grades` (a group of two grades has both). */
const journalOf = (grades: readonly number[]): JournalRow => ({
  id: 'journal',
  academicYearId: 'year',
  classId: null,
  groupId: 'group',
  subjectId: SUBJECT,
  unitName: 'Group',
  grades,
  groupClassIds: [],
  subject: {
    names: { uz: 'a', ru: 'a', en: 'a' },
    colour: 'blue',
    attendanceOnly: false,
    ratingExam: false,
  },
});

// Task 7.1a, decision 2: edge/lesson-plans, "Who may read a plan?"; 09, "A group of
// two grades ... is readable by teachers who have the subject and either grade in
// their profile".
describe('who reads and writes a plan', () => {
  it('lets the owner read and write, with the Teacher assignment', () => {
    expect(planReachOf(readerOf([assignment('teacher')]), journalOf([7]), ME)).toEqual({
      read: true,
      edit: true,
      assignmentId: 'teacher-assignment',
    });
  });

  it('lets a teacher with the subject and either grade of a two-grade group read, not write', () => {
    const journal = journalOf([7, 8]);
    for (const grades of [[7], [8], [8, 9]]) {
      expect(
        planReachOf(readerOf([assignment('teacher')], { [SUBJECT]: grades }), journal, SOMEONE),
      ).toEqual({ read: true, edit: false, assignmentId: null });
    }
    expect(
      planReachOf(readerOf([assignment('teacher')], { [SUBJECT]: [9] }), journal, SOMEONE).read,
    ).toBe(false);
    expect(
      planReachOf(readerOf([assignment('teacher')], { [OTHER]: [7, 8] }), journal, SOMEONE).read,
    ).toBe(false);
  });

  it('lets the Head Teachers of the subject and the whole-branch roles read, and nobody without a Teacher assignment write', () => {
    const journal = journalOf([7]);
    for (const roles of [
      [assignment('head_teacher', [SUBJECT])],
      [assignment('senior_head_teacher', [SUBJECT])],
      [assignment('super_admin')],
      [assignment('principal')],
      [assignment('academic_vice_principal')],
    ]) {
      expect(planReachOf(readerOf(roles), journal, SOMEONE), roles[0]?.role).toEqual({
        read: true,
        edit: false,
        assignmentId: null,
      });
    }
    expect(
      planReachOf(readerOf([assignment('head_teacher', [OTHER])]), journal, SOMEONE).read,
    ).toBe(false);
    expect(planReachOf(readerOf([assignment('tutor')]), journal, SOMEONE).read).toBe(false);
    // Nobody owns it under a vacancy with nobody acting.
    expect(planReachOf(readerOf([assignment('teacher')]), journal, null).edit).toBe(false);
  });
});

describe('the first bytes of a plan file (decision 3)', () => {
  const zip = (folder: string) =>
    Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`${folder}document.xml`)]);

  it('takes each type by its signature and refuses another', () => {
    const samples = {
      'application/pdf': Buffer.from('%PDF-1.7'),
      'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': zip('word/'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': zip('xl/'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': zip('ppt/'),
      'audio/mpeg': Buffer.from('ID3\u0004'),
      'video/mp4': Buffer.from('\u0000\u0000\u0000\u0018ftypisom'),
    } as const;
    for (const [type, bytes] of Object.entries(samples)) {
      expect(fileMatchesType(bytes, type as keyof typeof samples), type).toBe(true);
      expect(fileMatchesType(Buffer.from('plain text'), type as keyof typeof samples), type).toBe(
        false,
      );
    }
    // A Word file is not a spreadsheet.
    expect(
      fileMatchesType(
        zip('word/'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(false);
  });
});
