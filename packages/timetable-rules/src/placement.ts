/**
 * What the rule engine reads (task 5.2, pull request #109, review correction
 * 5): the lessons and exams placed, and the facts the rules need. Every caller
 * (the grid and its server check in 5.4a, publish in 5.5a, one-day changes in
 * 5.6a, exams in 5.6c, the solver re-check in 5.10) builds this same input.
 *
 * The dates a caller reads each fact on:
 * - a pattern (`mode: 'pattern'`, `day` a weekday): availability on the
 *   draft's intended start date (`startDate`), the later entries up to
 *   `versionEnd` (06, Rules, availability row); a status, memberships (the
 *   students of a placement, of a class, the classes of a group) and the
 *   templates of each weekday on the later of the start date and today, the
 *   weekday read on its first date on or after it (as `weekDaysOf`; 3.4a
 *   decision 11, 3.4b should-fix 5);
 * - dated lessons (`mode: 'dated'`, `day` a school date): every fact on the
 *   placement's own date.
 *
 * Times are clock minutes of the day in branch time, half-open
 * (docs/spec/edge-cases/developer-rules.md, Lesson times); one call uses one
 * axis, and a caller converts a branch in another time zone (decision 4).
 * Every clash is checked by these minutes, never by slot numbers
 * (edge/timetable, Structure, first row).
 */
import type { Day } from './day.js';
import type { DatedRow } from './templates.js';

/** A lesson, or an exam (06, Rules, the exam row: "An exam counts as a lesson … in the rules on one place at a time and rooms"). */
export interface Placement {
  readonly id: string;
  readonly kind: 'lesson' | 'exam';
  readonly branchId: string;
  /** A weekday '1' (Monday) to '7' for a pattern; a school date `YYYY-MM-DD` for dated lessons. */
  readonly day: string;
  readonly start: number;
  readonly end: number;
  /**
   * The lesson block (edge/timetable, Structure: "The unit that occupies a
   * class is the lesson block"); `null` for an exam.
   */
  readonly blockId: string | null;
  /** The pair of a double lesson; `null` for a single lesson and an exam. */
  readonly doublePairId: string | null;
  /** The class of a whole-class lesson, or the group of a group lesson; both `null` for an exam. */
  readonly classId: string | null;
  readonly groupId: string | null;
  /** The classes it occupies: the class, the group's classes, or the exam's classes. */
  readonly classIds: readonly string[];
  /**
   * The expected students on the day (edge/00-definitions, Expected student):
   * members not exempt for this lesson. A student exempt for it (a sitting
   * class taken out of a kept block, an excursion) is left out here and named
   * in `exemptStudentIds`, so they never clash (plan finding 2).
   */
  readonly studentIds: readonly string[];
  /** Students of `classIds` exempt for this lesson; they need no place in its block. */
  readonly exemptStudentIds: readonly string[];
  /** `null` for an exam without a subject. */
  readonly subjectId: string | null;
  /** The teaching load row of a lesson; `null` for an extra lesson without one and an exam. */
  readonly loadRowId: string | null;
  /** The teacher or vacancy of a lesson (one), or the invigilators of an exam. */
  readonly teacherIds: readonly string[];
  /** The teacher is a substitute of a one-day change (06, Changes after publishing, Substitution). */
  readonly substitute: boolean;
  /** The room of a lesson; `null` when it has none. */
  readonly roomId: string | null;
  /** The rooms of an exam, each with the students of the classes it holds; empty for a lesson. */
  readonly examRooms: readonly { readonly roomId: string; readonly students: number }[];
  /** An extra lesson (06, Changes after publishing, Extra lesson). */
  readonly extra: boolean;
  /**
   * A published lesson of another branch, shown as busy elsewhere: it takes
   * part in every clash and in travel time, and no rule of its own is
   * reported (06, Teachers who work in several branches, Busy elsewhere).
   */
  readonly fixed: boolean;
}

/** An availability entry of a teacher or vacancy in one branch (task 2.2b), in force over `[validFrom, validUntil)`. */
export interface AvailabilityEntry extends DatedRow {
  readonly branchId: string;
  readonly ranges: readonly {
    readonly weekday: number;
    readonly start: number;
    readonly end: number;
  }[];
}

export interface EngineTeacher {
  readonly id: string;
  readonly vacancy: boolean;
  /** Inactive or left, or a closed vacancy, by the status in force on the date the caller reads. */
  readonly out: boolean;
  /** The branches the person works in. */
  readonly branchIds: readonly string[];
  readonly subjects: readonly { readonly subjectId: string; readonly grades: readonly number[] }[];
  readonly languages: readonly string[];
  readonly availability: readonly AvailabilityEntry[];
  /** Lessons per week by contract; `null` when not set. */
  readonly weeklyLessons: number | null;
  /** Most lessons per day; `null` when not set. */
  readonly dailyLessons: number | null;
}

export interface EngineSubject {
  readonly id: string;
  readonly active: boolean;
  readonly languageRule: boolean;
  readonly tutorSubject: boolean;
}

export interface EngineRoom {
  readonly id: string;
  /** 03, rooms: in use, under repair, closed. */
  readonly status: 'in_use' | 'under_repair' | 'closed';
  readonly shared: boolean;
  /** Lessons at the same time in a shared room. */
  readonly lessonsAtOnce: number;
  readonly capacity: number;
}

/** A class or a group. */
export interface EngineUnit {
  readonly id: string;
  readonly kind: 'class' | 'group';
  /** One grade for a class; the grades of its classes for a group. */
  readonly grades: readonly number[];
  readonly language: string;
  /** The staff records of a class's Tutors; empty for a group (load.ts, `takesAsTutor`). */
  readonly tutorStaffIds: readonly string[];
}

/** What a grade of a branch has on a day: the times of its template, or the reason it has no lessons. */
export type EngineDay =
  | {
      readonly lessons: true;
      readonly day: Day;
      /** "no regular lessons" in an exam week (03, Academic calendar). */
      readonly noRegularLessons: boolean;
    }
  | { readonly lessons: false; readonly reason: 'day_off' | 'not_working_day' | 'no_template' };

/** The academic year of a branch and the dates of its quarters (review correction 1). */
export interface EngineYear {
  readonly firstDate: string;
  readonly lastDate: string;
  readonly quarters: readonly { readonly firstDate: string; readonly lastDate: string }[];
}

export interface EngineLoadRow {
  readonly id: string;
  readonly lessonsPerWeek: number;
  /** "deliberately short" with a reason (06, Rules, last row); stored with publish, task 5.5a. */
  readonly deliberatelyShort: boolean;
}

export interface Facts {
  readonly mode: 'pattern' | 'dated';
  /** A pattern: the draft's intended start date. */
  readonly startDate: string;
  /** A pattern: its last date (the day before the next published version, else the year's end). */
  readonly versionEnd: string;
  readonly teachers: ReadonlyMap<string, EngineTeacher>;
  readonly subjects: ReadonlyMap<string, EngineSubject>;
  readonly rooms: ReadonlyMap<string, EngineRoom>;
  readonly units: ReadonlyMap<string, EngineUnit>;
  /** The expected students of a class on the day (for a block's completeness). */
  readonly classStudents: (classId: string, day: string) => readonly string[];
  /** What a grade of a branch has on the day. */
  readonly dayOf: (branchId: string, grade: number, day: string) => EngineDay;
  /** Dated lessons: the academic year of each branch. */
  readonly years: ReadonlyMap<string, EngineYear>;
  /** The travel time of two branches (`travel_times`); `null` when the pair is not set (decision 1). */
  readonly travelMinutes: (branchA: string, branchB: string) => number | null;
  /** `branch_settings.class_daily_lessons`; `null` when not set (decision 2). */
  readonly classDailyLessons: (branchId: string) => number | null;
  /** A pattern: the load rows of the version, for `load_mismatch`. */
  readonly loadRows: readonly EngineLoadRow[];
  /** The draft placements of other branches (06, Two drafts at once), for `other_draft` only. */
  readonly otherDrafts: readonly Placement[];
}

/** A one-day change when no teacher of the subject is free (review correction 3). */
export interface CheckOptions {
  readonly noSubjectTeacherFree?: boolean;
}
