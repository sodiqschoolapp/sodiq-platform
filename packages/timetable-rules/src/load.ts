/**
 * The blocked rules of one teaching load row (docs/spec/05-classes-groups-subjects.md,
 * Teaching load; 06-timetable.md, Rules; edge-cases/timetable.md, Structure;
 * task 3.4a, pull request #99).
 *
 * "Only teachers whose profile has the subject and every grade of the class
 * or group, and the language of the class or group where the language rule
 * applies, can be chosen. A vacancy can be chosen under the same conditions."
 * "Inactive teachers, subjects and rooms cannot be used." A Tutor row (a
 * Tutor subject on a class row) holds the class's Tutor of the version and
 * nobody else, without the profile row (3.4a decision 2 as narrowed by task
 * 3.6c-2, decision 1). The API's refusal, the teachers offered, the copy of a version
 * and the problems shown on each row all call this one function; the database
 * keeps the same rules (db/migrations/0055), except the two-grade slot rule,
 * which needs the templates (decision 8).
 */

import type { BlockProblem } from './blocks.js';

/** The problems of a row, in the order they are reported; the first of `refusingProblems` is the refusal. */
export const LOAD_PROBLEM_ORDER = [
  'load_unit_year',
  'load_unit_archived',
  'load_group_subject',
  'load_subject_archived',
  'load_subject_grade',
  'load_group_no_shared_slot',
  'load_split_and_whole',
  'load_mixed_not_split',
  'load_no_tutor',
  'load_tutor_row_teacher',
  'load_teacher_branch',
  'load_teacher_status',
  'load_teacher_subject',
  'load_teacher_grade',
  'load_teacher_language',
  'load_block_mixed',
  'load_block_lessons',
  'load_block_teacher',
  'load_room_closed',
  'load_group_gaps',
] as const;

export type LoadProblem = (typeof LOAD_PROBLEM_ORDER)[number];

/** The problems that the choice of the teacher decides (decision 7). */
export const TEACHER_PROBLEMS: readonly LoadProblem[] = [
  'load_no_tutor',
  'load_tutor_row_teacher',
  'load_teacher_branch',
  'load_teacher_status',
  'load_teacher_subject',
  'load_teacher_grade',
  'load_teacher_language',
];

/**
 * The problems a write is never refused for (task 3.4b, decision 4): students
 * not placed are listed; readiness (5.3) and publish (5.5a) block on them.
 */
export const LISTED_PROBLEMS: readonly LoadProblem[] = ['load_group_gaps'];

/** The problems of `problems` that refuse a write, in their order. */
export const refusingProblems = (problems: readonly LoadProblem[]): LoadProblem[] =>
  problems.filter((problem) => !LISTED_PROBLEMS.includes(problem));

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
   * The staff record of the class's Tutor of the version: `tutorAt` at the
   * last moment of the later of its start date and today in branch time (task
   * 3.6c-2, decision 3); `null` with none, and for a group.
   */
  readonly tutorOnStart: string | null;
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
  /**
   * Task 3.4b: whether the version also holds a whole-class row and a group
   * row for one class and the subject of the row (`splitAndWhole`).
   */
  readonly splitAndWhole: boolean;
  /** Task 3.4b: the problems the row's block gives it (`blockProblems`); empty for a class row. */
  readonly blockProblems: readonly BlockProblem[];
  /**
   * Task 3.4b, decision 4: the students of a group row's classes not placed
   * in one of the block's groups from the start date; 0 for a class row.
   */
  readonly unplaced: number;
}

const coversAll = (held: readonly number[], needed: readonly number[]) =>
  needed.every((grade) => held.includes(grade));

/**
 * A Tutor row: a Tutor subject on a class row. Nobody picks its teacher; it is
 * the class's Tutor (task 3.6c-2, decision 1). A group row of a Tutor subject
 * keeps the profile rule.
 */
export function isTutorRow(
  unit: Pick<LoadUnit, 'kind'>,
  subject: Pick<LoadSubject, 'tutorSubject'>,
): boolean {
  return subject.tutorSubject && unit.kind === 'class';
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
  // The class's Tutor takes a Tutor row without the profile row; anyone else
  // (a substitute of a dated lesson) needs it.
  if (!(isTutorRow(unit, subject) && unit.tutorOnStart === teacher.id)) {
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
  if (facts.splitAndWhole) {
    problems.push('load_split_and_whole');
  }
  if (facts.blockProblems.includes('load_mixed_not_split')) {
    problems.push('load_mixed_not_split');
  }
  if (isTutorRow(unit, subject)) {
    if (unit.tutorOnStart === null) {
      problems.push('load_no_tutor');
    } else if (unit.tutorOnStart !== facts.teacher.id) {
      problems.push('load_tutor_row_teacher');
    }
  }
  problems.push(...teacherProblems(unit, subject, facts.teacher));
  for (const problem of ['load_block_mixed', 'load_block_lessons', 'load_block_teacher'] as const) {
    if (facts.blockProblems.includes(problem)) {
      problems.push(problem);
    }
  }
  if (facts.room?.closed === true) {
    problems.push('load_room_closed');
  }
  if (facts.unplaced > 0) {
    problems.push('load_group_gaps');
  }
  return problems;
}
