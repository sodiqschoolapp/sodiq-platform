import {
  classDisplayName,
  LOAD_LESSONS_MAX,
  loadRowEditSchema,
  loadRowRecordSchema,
  ROOM_TYPES,
  type LoadRow,
  type LoadRowEdit,
  type LoadRowRecord,
  type Room,
  type SchoolClass,
  type SchoolGroup,
  type Subject,
  type TimetableVersion,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CHECKED, CheckboxField, NumberField, SelectField } from '@/components/field';
import type { FormSchema } from '@/components/form/form-messages';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { loadTeachersQuery } from './timetable-api';

interface LoadRowFormProps {
  version: TimetableVersion;
  /** The row as saved; `null` for a new row. */
  row: LoadRow | null;
  classes: readonly SchoolClass[];
  groups: readonly SchoolGroup[];
  subjects: readonly Subject[];
  rooms: readonly Room[];
  label: string;
  onSave: (record: LoadRowRecord | LoadRowEdit) => Promise<void>;
  onCancel?: () => void;
}

type UnitChoice = { classId: string } | { groupId: string } | null;

/** The unit field holds `class:<id>` or `group:<id>`. */
const unitOf = (value: string): UnitChoice => {
  const [kind, id] = value.split(':');
  if (id === undefined || id === '') {
    return null;
  }
  return kind === 'class' ? { classId: id } : kind === 'group' ? { groupId: id } : null;
};

/** The room field holds `room:<id>`, `type:<room type>`, or nothing (decision 13). */
const roomOf = (value: string) => {
  const [kind, id] = value.split(':');
  return {
    roomId: kind === 'room' && id !== undefined ? id : null,
    roomType: kind === 'type' ? (ROOM_TYPES.find((one) => one === id) ?? null) : null,
  };
};

/**
 * A row of the teaching load (`05`, Teaching load: "For each class or group
 * and subject: one teacher or one vacancy, lessons per week, the room or room
 * type if a special one is needed, whether double lessons are allowed"; task
 * 3.4a). The class or group and the subject are chosen at the create and fixed
 * (decision 7). The teachers offered are those the server finds may take the
 * row (the rules of the create; decision 2), the class's Tutor first; for a
 * Tutor subject the Tutor is chosen already (correction 1).
 */
export function LoadRowForm({
  version,
  row,
  classes,
  groups,
  subjects,
  rooms,
  label,
  onSave,
  onCancel,
}: LoadRowFormProps) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const number = new Intl.NumberFormat(i18n.language);
  const schema: FormSchema<LoadRowRecord | LoadRowEdit> =
    row === null ? loadRowRecordSchema : loadRowEditSchema;

  const form = useRecordForm({
    schema,
    initial: {
      unit: row === null ? '' : `${row.unit.kind}:${row.unit.id}`,
      subjectId: row?.subject.id ?? '',
      teacherId: row?.teacher.id ?? '',
      lessonsPerWeek: row === null ? '' : String(row.lessonsPerWeek),
      room:
        row?.room != null
          ? `room:${row.room.id}`
          : row?.roomType != null
            ? `type:${row.roomType}`
            : '',
      doubleLessons: row?.doubleLessons === true ? CHECKED : '',
    },
    read: (typed) => {
      const fields = {
        teacherId: typed.teacherId,
        lessonsPerWeek: wholeNumber(typed.lessonsPerWeek),
        ...roomOf(typed.room),
        doubleLessons: typed.doubleLessons === CHECKED,
      };
      if (row !== null) {
        return fields;
      }
      const unit = unitOf(typed.unit);
      return {
        classId: unit !== null && 'classId' in unit ? unit.classId : null,
        groupId: unit !== null && 'groupId' in unit ? unit.groupId : null,
        subjectId: typed.subjectId,
        ...fields,
      };
    },
    save: onSave,
  });

  const unitValue = form.bind('unit').value;
  const unit: UnitChoice =
    row === null
      ? unitOf(unitValue)
      : row.unit.kind === 'class'
        ? { classId: row.unit.id }
        : { groupId: row.unit.id };
  const group =
    unit !== null && 'groupId' in unit ? groups.find((one) => one.id === unit.groupId) : undefined;
  const schoolClass =
    unit !== null && 'classId' in unit ? classes.find((one) => one.id === unit.classId) : undefined;
  const unitGrades = group?.grades ?? (schoolClass === undefined ? [] : [schoolClass.grade]);
  // The subjects taught in every grade of the unit; a group's own subject only.
  const offeredSubjects = subjects.filter(
    (subject) =>
      subject.archivedAt === null &&
      (group === undefined
        ? unitGrades.length > 0 && unitGrades.every((grade) => subject.grades.includes(grade))
        : subject.id === group.subject.id),
  );
  const subjectId = row?.subject.id ?? form.bind('subjectId').value;
  const subjectField = form.bind('subjectId');
  // A subject no longer offered for the unit chosen falls back to none.
  useEffect(() => {
    if (row === null && subjectId !== '' && !offeredSubjects.some((one) => one.id === subjectId)) {
      subjectField.onChange({
        target: { value: group !== undefined ? group.subject.id : '' },
      });
    }
  });

  const teachers = useQuery(loadTeachersQuery(branchId, version.id, unit, subjectId));
  const teacherField = form.bind('teacherId');
  const offeredTeachers = teachers.data?.teachers ?? [];
  const keepsOwn =
    row !== null && !offeredTeachers.some((one) => one.id === row.teacher.id)
      ? [{ id: row.teacher.id, kind: row.teacher.kind, name: row.teacher.name, tutor: false }]
      : [];
  const teacherOptions = [...keepsOwn, ...offeredTeachers];
  // Correction 1: the class's Tutor for a Tutor subject; a choice no longer
  // offered falls back to none (.claude/rules/web.md).
  useEffect(() => {
    if (teachers.data === undefined) {
      return;
    }
    if (teacherField.value === '' && row === null && teachers.data.defaultTeacherId !== null) {
      teacherField.onChange({ target: { value: teachers.data.defaultTeacherId } });
    } else if (
      teacherField.value !== '' &&
      !teacherOptions.some((one) => one.id === teacherField.value)
    ) {
      teacherField.onChange({ target: { value: '' } });
    }
  });

  const openYearClasses = classes.filter(
    (one) => one.academicYearId === version.academicYearId && !one.archived,
  );
  const openYearGroups = groups.filter(
    (one) => one.academicYearId === version.academicYearId && !one.archived,
  );
  const teacherName = (one: { kind: string; name: string | null; tutor: boolean }) => {
    const name = one.name ?? t('timetable.load.gone');
    return one.tutor
      ? t('timetable.load.tutorOption', { name })
      : one.kind === 'vacancy'
        ? t('timetable.load.vacancyOption', { name })
        : name;
  };

  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      {row === null && (
        <SelectField
          label={t('timetable.load.unit')}
          options={[
            { value: '', label: t('timetable.load.chooseUnit') },
            ...openYearClasses.map((one) => ({
              value: `class:${one.id}`,
              label: classDisplayName(one.grade, one.name),
            })),
            ...openYearGroups.map((one) => ({ value: `group:${one.id}`, label: one.name })),
          ]}
          {...form.bind('unit')}
        />
      )}
      {row === null && (
        <SelectField
          label={t('timetable.load.subject')}
          options={[
            { value: '', label: t('timetable.load.chooseSubject') },
            ...offeredSubjects.map((subject) => ({
              value: subject.id,
              label: nameOf(subject.names, i18n.language),
            })),
          ]}
          {...subjectField}
        />
      )}
      {unit === null || subjectId === '' ? (
        <p className="text-sm text-muted-foreground">{t('timetable.load.chooseFirst')}</p>
      ) : teachers.isError ? (
        <ErrorState
          error={teachers.error}
          onRetry={() => {
            void teachers.refetch();
          }}
        />
      ) : teachers.data !== undefined && teacherOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('timetable.load.noTeachers')}</p>
      ) : (
        <SelectField
          label={t('timetable.load.teacher')}
          disabled={teachers.data === undefined}
          options={[
            { value: '', label: t('timetable.load.chooseTeacher') },
            ...teacherOptions.map((one) => ({ value: one.id, label: teacherName(one) })),
          ]}
          {...teacherField}
        />
      )}
      <NumberField
        label={t('timetable.load.lessons')}
        note={t('timetable.load.lessonsNote', {
          min: number.format(1),
          max: number.format(LOAD_LESSONS_MAX),
        })}
        {...form.bind('lessonsPerWeek')}
      />
      <SelectField
        label={t('timetable.load.room')}
        options={[
          { value: '', label: t('timetable.load.noRoom') },
          ...ROOM_TYPES.map((type) => ({
            value: `type:${type}`,
            label: t('timetable.load.roomTypeOption', { type: t(`setup.rooms.types.${type}`) }),
          })),
          ...rooms
            .filter((room) => room.status !== 'closed' || room.id === row?.room?.id)
            .map((room) => ({ value: `room:${room.id}`, label: room.name })),
        ]}
        {...form.bind('room')}
      />
      <CheckboxField label={t('timetable.load.doubleLessons')} {...form.bind('doubleLessons')} />
    </RecordForm>
  );
}
