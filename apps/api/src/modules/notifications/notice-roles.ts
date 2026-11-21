import type { NoticeRole } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * The role by which a notice about a lesson, a journal or a plan is sent to the person who
 * holds it (task 10.11, pull request #371, decisions 2 and 13). The subjects of a Tutors
 * department (the Ma'naviyat soati and Homework slot lessons, on any unit, the same test as
 * the key's own refusal of Tutor work, `namesTutorWork`) are held as the class Tutor, or as the
 * Class teacher in a class of grades 0–4 (`edge/00-definitions`, "Tutor of a class"); every
 * other subject as a Teacher. A substitute or an invigilator is told as a Teacher by the
 * caller (decision 10).
 */
export type TeachingRole = Extract<NoticeRole, 'teacher' | 'tutor' | 'class_teacher'>;

/** What a lesson, a journal or a plan is taught on. */
export interface TaughtUnit {
  subjectId: string;
  /** The class of a class unit; `null` for a group. */
  classId: string | null;
}

/** The highest grade of a Class teacher's class (`02`: "one class of grades 0–4"). */
const CLASS_TEACHER_TOP_GRADE = 4;

/** The role of each unit, in the order given. */
export async function teachingRolesOf(
  transaction: Transaction,
  units: readonly TaughtUnit[],
): Promise<TeachingRole[]> {
  if (units.length === 0) {
    return [];
  }
  const subjectIds = [...new Set(units.map((unit) => unit.subjectId))];
  const tutorRows = await transaction
    .selectFrom('subjects')
    .innerJoin('departments', 'departments.id', 'subjects.department_id')
    .select('subjects.id')
    .where('subjects.id', 'in', subjectIds)
    .where('departments.tutors', '=', true)
    .execute();
  const tutorSubjects = new Set(tutorRows.map((row) => row.id));
  const classIds = [
    ...new Set(
      units.flatMap((unit) =>
        tutorSubjects.has(unit.subjectId) && unit.classId !== null ? [unit.classId] : [],
      ),
    ),
  ];
  const grades = new Map<string, number>();
  if (classIds.length > 0) {
    const rows = await transaction
      .selectFrom('classes')
      .select(['id', 'grade'])
      .where('id', 'in', classIds)
      .execute();
    for (const row of rows) grades.set(row.id, row.grade);
  }
  return units.map((unit) => {
    if (!tutorSubjects.has(unit.subjectId)) {
      return 'teacher';
    }
    const grade = unit.classId === null ? undefined : grades.get(unit.classId);
    return grade !== undefined && grade <= CLASS_TEACHER_TOP_GRADE ? 'class_teacher' : 'tutor';
  });
}

/** The role of one unit. */
export async function teachingRoleOf(
  transaction: Transaction,
  unit: TaughtUnit,
): Promise<TeachingRole> {
  const [role] = await teachingRolesOf(transaction, [unit]);
  return role ?? 'teacher';
}

/** The roles of several units held by one person, each once, sorted. */
export async function teachingRolesTogether(
  transaction: Transaction,
  units: readonly TaughtUnit[],
): Promise<TeachingRole[]> {
  const roles = await teachingRolesOf(transaction, units);
  return [...new Set(roles.length === 0 ? (['teacher'] as const) : roles)].sort();
}

/** The unit of a journal as an answer carries it (`journalUnitSchema`, `journalSubjectSchema`). */
export function answeredUnit(journal: {
  unit: { kind: 'class' | 'group'; id: string };
  subject: { id: string };
}): TaughtUnit {
  return {
    subjectId: journal.subject.id,
    classId: journal.unit.kind === 'class' ? journal.unit.id : null,
  };
}

/** The units of these lessons, by lesson id (the row filter of the transaction applies). */
export async function lessonUnits(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<Map<string, TaughtUnit>> {
  if (lessonIds.length === 0) {
    return new Map();
  }
  const rows = await transaction
    .selectFrom('lessons')
    .select(['id', 'subject_id', 'class_id'])
    .where('id', 'in', [...new Set(lessonIds)])
    .execute();
  return new Map(
    rows.map((row): [string, TaughtUnit] => [
      row.id,
      { subjectId: row.subject_id, classId: row.class_id },
    ]),
  );
}
