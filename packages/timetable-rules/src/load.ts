/**
 * The blocked rules of one teaching load row (docs/spec/05-classes-groups-subjects.md,
 * Teaching load; 06-timetable.md, Rules; edge-cases/timetable.md, Structure;
 * task 3.4a, pull request #99).
 *
 * "Only teachers whose profile has the subject and every grade of the class
 * or group, and the language of the class or group where the language rule
 * applies, can be chosen. A vacancy can be chosen under the same conditions."
 * "Inactive teachers, subjects and rooms cannot be used." A Tutor subject on a
 * class row may be taken by a Tutor of that class without the profile row
 * (decision 2). The API's refusal, the teachers offered, the copy of a version
 * and the problems shown on each row all call this one function; the database
 * keeps the same rules (db/migrations/0055), except the two-grade slot rule,
 * which needs the templates (decision 8).
 */

/** The problems of a row, in the order they are reported; the first is the refusal. */
export const LOAD_PROBLEM_ORDER = [
  'load_unit_year',
  'load_unit_archived',
  'load_group_subject',
  'load_subject_archived',
  'load_subject_grade',
  'load_group_no_shared_slot',
  'load_teacher_branch',
  'load_teacher_status',
  'load_teacher_subject',
  'load_teacher_grade',
  'load_teacher_language',
  'load_room_closed',
] as const;

export type LoadProblem = (typeof LOAD_PROBLEM_ORDER)[number];

/** The problems that the choice of the teacher decides (decision 7). */
export const TEACHER_PROBLEMS: readonly LoadProblem[] = [
  'load_teacher_branch',
  'load_teacher_status',
  'load_teacher_subject',
  'load_teacher_grade',
  'load_teacher_language',
];

/** The problems that the choice of the room decides (decision 7). */
export const ROOM_PROBLEMS: readonly LoadProblem[] = ['load_room_closed'];

/** A class or a group as the load reads it. */
export interface LoadUnit {
  readonly kind: 'class' | 'group';
  readonly yearId: string;
  readonly archived: boolean;
  /** One grade for a class; the grades of its classes for a group. */
  readonly grades: readonly number[];
  readonly language: string;
  /** The group's own subject; `null` for a class. */
  readonly subjectId: string | null;
  /**
   * The staff records of the Tutors of a class (main or acting) whose rows
   * overlap the start date of the version in the branch's time zone
   * (correction 4); empty for a group.
   */
  readonly tutorStaffIds: readonly string[];
}

export interface LoadSubject {
  readonly id: string;
  readonly archived: boolean;
  readonly grades: readonly number[];
  readonly languageRule: boolean;
  /** A subject of the Tutors department (decision 2). */
  readonly tutorSubject: boolean;
}

/** A teacher or a vacancy as the load reads it. */
export interface LoadTeacher {
  readonly id: string;
  /** Linked to the branch of the version. */
  readonly inBranch: boolean;
  /**
   * Inactive or left, or a closed vacancy, by the status row in force on the
   * start date; no row then counts as in (decision 11).
   */
  readonly out: boolean;
  readonly subjects: readonly { readonly subjectId: string; readonly grades: readonly number[] }[];
  readonly languages: readonly string[];
}

export interface LoadRowFacts {
  readonly versionYearId: string;
  readonly unit: LoadUnit;
  readonly subject: LoadSubject;
  readonly teacher: LoadTeacher;
  /** The named room, or `null` when the row names none. */
  readonly room: { readonly closed: boolean } | null;
  /**
   * For a group of two grades: whether some school weekday has a lesson slot
   * of the same start and end in both grades (`twoGradeSlots`); `null`
   * otherwise.
   */
  readonly sharedSlot: boolean | null;
}

const coversAll = (held: readonly number[], needed: readonly number[]) =>
  needed.every((grade) => held.includes(grade));

/** Whether the teacher takes the row as the class's Tutor, outside the profile rule (decision 2). */
export function takesAsTutor(
  unit: LoadUnit,
  subject: LoadSubject,
  teacher: Pick<LoadTeacher, 'id'>,
): boolean {
  return subject.tutorSubject && unit.kind === 'class' && unit.tutorStaffIds.includes(teacher.id);
}

/** The teacher's problems for the row, in their order. */
export function teacherProblems(
  unit: LoadUnit,
  subject: LoadSubject,
  teacher: LoadTeacher,
): LoadProblem[] {
  const problems: LoadProblem[] = [];
  if (!teacher.inBranch) {
    problems.push('load_teacher_branch');
  }
  if (teacher.out) {
    problems.push('load_teacher_status');
  }
  if (!takesAsTutor(unit, subject, teacher)) {
    const held = teacher.subjects.find((one) => one.subjectId === subject.id);
    if (held === undefined) {
      problems.push('load_teacher_subject');
    } else if (!coversAll(held.grades, unit.grades)) {
      problems.push('load_teacher_grade');
    }
  }
  if (subject.languageRule && !teacher.languages.includes(unit.language)) {
    problems.push('load_teacher_language');
  }
  return problems;
}

/** Every problem of one row, in the order of `LOAD_PROBLEM_ORDER`; empty when it may be written. */
export function loadRowProblems(facts: LoadRowFacts): LoadProblem[] {
  const { unit, subject } = facts;
  const problems: LoadProblem[] = [];
  if (unit.yearId !== facts.versionYearId) {
    problems.push('load_unit_year');
  }
  if (unit.archived) {
    problems.push('load_unit_archived');
  }
  if (unit.kind === 'group' && unit.subjectId !== subject.id) {
    problems.push('load_group_subject');
  }
  if (subject.archived) {
    problems.push('load_subject_archived');
  }
  if (!coversAll(subject.grades, unit.grades)) {
    problems.push('load_subject_grade');
  }
  if (facts.sharedSlot === false) {
    problems.push('load_group_no_shared_slot');
  }
  problems.push(...teacherProblems(unit, subject, facts.teacher));
  if (facts.room?.closed === true) {
    problems.push('load_room_closed');
  }
  return problems;
}
