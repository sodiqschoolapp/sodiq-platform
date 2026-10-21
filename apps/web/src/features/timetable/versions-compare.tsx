import {
  classDisplayName,
  timeText,
  weekdaySchema,
  type LoadRow,
  type VersionComparison,
  type VersionDifferenceAnswer,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { SUBSECTION_TITLE } from '@/components/ui/control';
import { nameOf } from '@/features/setup/setup-api';
import { weekdayName } from '@/lib/dates';

/** The class or group of a row as a person reads it. */
const unitOf = (row: LoadRow): string =>
  row.unit.kind === 'class'
    ? classDisplayName(row.unit.grades[0] ?? 0, row.unit.name)
    : row.unit.name;

/**
 * The differences of one version against another (task 5.8a; `06`,
 * Protection: "compares two versions"), grouped by class or group and
 * subject: each difference in one line, named by the rows and rooms of the
 * answer.
 */
export function VersionsCompare({ comparison }: { comparison: VersionComparison }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { rows, rooms, differences } = comparison;

  const rowOf = (one: { classId: string | null; groupId: string | null; subjectId: string }) =>
    rows.find(
      (row) =>
        row.subject.id === one.subjectId &&
        row.unit.id === (one.groupId ?? one.classId) &&
        row.unit.kind === (one.groupId === null ? 'class' : 'group'),
    );
  const teacherName = (id: string): string =>
    rows.find((row) => row.teacher.id === id)?.teacher.name ?? t('timetable.load.gone');
  const roomName = (id: string | null): string =>
    id === null
      ? t('timetable.history.noRoom')
      : (rooms.find((room) => room.id === id)?.name ?? t('timetable.load.gone'));
  const placeOf = (one: { weekday: number; slotPosition: number }): string =>
    t('timetable.history.place', {
      day: weekdayName(language, weekdaySchema.parse(one.weekday)),
      slot: one.slotPosition,
    });
  const fieldValue = (
    field: Extract<VersionDifferenceAnswer, { kind: 'row_field' }>['field'],
    value: string | number | boolean | null,
  ): string => {
    if (value === null) return t('timetable.history.none');
    if (typeof value === 'boolean')
      return value ? t('timetable.history.yes') : t('timetable.history.no');
    if (field === 'roomType' && typeof value === 'string') {
      return t(`setup.rooms.types.${value as 'classroom'}`);
    }
    return String(value);
  };

  const lineOf = (one: VersionDifferenceAnswer): string => {
    switch (one.kind) {
      case 'row_added':
        return t('timetable.history.diff.row_added', {
          teacher: teacherName(one.teacherId),
          count: one.lessonsPerWeek,
        });
      case 'row_removed':
        return t('timetable.history.diff.row_removed', {
          teacher: teacherName(one.teacherId),
          count: one.lessonsPerWeek,
        });
      case 'teacher':
        return t('timetable.history.diff.teacher', {
          before: teacherName(one.before),
          after: teacherName(one.after),
        });
      case 'row_room':
        return t('timetable.history.diff.row_room', {
          before: roomName(one.before),
          after: roomName(one.after),
        });
      case 'row_field':
        return t('timetable.history.diff.row_field', {
          field: t(`timetable.history.fields.${one.field}`),
          before: fieldValue(one.field, one.before),
          after: fieldValue(one.field, one.after),
        });
      case 'placement_added':
        return t('timetable.history.diff.placement_added', {
          place: placeOf(one),
          room: roomName(one.roomId),
        });
      case 'placement_removed':
        return t('timetable.history.diff.placement_removed', {
          place: placeOf(one),
          room: roomName(one.roomId),
        });
      case 'entry_room':
        return t('timetable.history.diff.entry_room', {
          place: placeOf(one),
          before: roomName(one.before),
          after: roomName(one.after),
        });
      case 'placement_time':
        return t('timetable.history.diff.placement_time', {
          place: placeOf(one),
          before: `${timeText(one.before.start)}–${timeText(one.before.end)}`,
          after: `${timeText(one.after.start)}–${timeText(one.after.end)}`,
        });
      case 'placement_double':
        return one.after
          ? t('timetable.history.diff.double_joined', { place: placeOf(one) })
          : t('timetable.history.diff.double_parted', { place: placeOf(one) });
    }
  };

  if (differences.length === 0) {
    return (
      <p className="text-sm" data-no-differences="">
        {t('timetable.history.noDifferences')}
      </p>
    );
  }
  const groups = new Map<string, VersionDifferenceAnswer[]>();
  for (const one of differences) {
    const key = `${one.classId ?? ''}|${one.groupId ?? ''}|${one.subjectId}`;
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }
  return (
    <div className="grid gap-4" data-differences="">
      {[...groups.values()].map((group) => {
        const [first] = group;
        if (first === undefined) return null;
        const row = rowOf(first);
        const title =
          row === undefined
            ? t('timetable.load.gone')
            : `${unitOf(row)}, ${nameOf(row.subject.names, language)}`;
        return (
          <div key={`${first.classId ?? ''}|${first.groupId ?? ''}|${first.subjectId}`}>
            <h4 className={SUBSECTION_TITLE}>{title}</h4>
            <ul className="grid gap-1 text-sm">
              {group.map((one, index) => (
                <li key={index} data-difference={one.kind}>
                  {lineOf(one)}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
