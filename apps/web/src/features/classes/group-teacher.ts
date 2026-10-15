import type { SchoolGroup } from '@sodiq/shared';
import type { TFunction } from 'i18next';

/**
 * The teacher of a group as its card and panel show it (05, Group: "teacher
 * (or a vacancy)"; task 3.4b, decision 9): the teacher or vacancy of the
 * group's load row, marked when it comes from a draft; "—" when none.
 */
export function groupTeacherText(t: TFunction, group: Pick<SchoolGroup, 'teacher'>): string {
  const teacher = group.teacher;
  if (teacher === null) {
    return t('groups.notYet');
  }
  const name = teacher.name ?? t('timetable.load.gone');
  const shown = teacher.kind === 'vacancy' ? t('groups.teacherVacancy', { name }) : name;
  return teacher.draft ? t('groups.teacherDraft', { name: shown }) : shown;
}
