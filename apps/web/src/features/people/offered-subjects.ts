import { PRIMARY_GRADES, type Subject } from '@sodiq/shared';

/**
 * The subjects a teacher's or a vacancy's Teaching form offers, with the
 * grades it offers for each (`04`, Academic: "a teacher's subjects come from
 * one department, except subjects taught only in grades 0–4, which may come
 * from any department"; task 9.4e, decision 1):
 *
 * - a subject of the department (a planned move's, which the server's rule
 *   reads; task 3.6b-3), not archived, with all its grades;
 * - a subject of another department, not archived, that is taught in a grade
 *   0–4, with its grades 0–4 only;
 * - a subject the record already holds, also archived or of another
 *   department, with the grades its department allows.
 */
export function offeredSubjects(
  subjects: readonly Subject[],
  department: string | null | undefined,
  held: readonly string[],
): Subject[] {
  return subjects.flatMap((subject) => {
    const own = (subject.departmentMove?.departmentId ?? subject.departmentId) === department;
    const kept = held.includes(subject.id);
    if (own) {
      return subject.archivedAt === null || kept ? [subject] : [];
    }
    const primary = subject.grades.filter((grade) => PRIMARY_GRADES.includes(grade));
    if (primary.length === 0 || (subject.archivedAt !== null && !kept)) {
      return kept ? [subject] : [];
    }
    return [{ ...subject, grades: primary }];
  });
}
