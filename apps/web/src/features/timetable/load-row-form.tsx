import {
  classDisplayName,
  LOAD_LESSONS_MAX,
  PERMISSIONS,
  permits,
  loadRowEditSchema,
  loadRowRecordSchema,
  ROOM_TYPES,
  type InstructionLanguage,
  type LoadRow,
  type LoadRowEdit,
  type LoadRowRecord,
  type LoadTeachers,
  type Room,
  type SchoolClass,
  type SchoolGroup,
  type Subject,
  type TimetableVersion,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CHECKED, CheckboxField, NumberField, SelectField } from '@/components/field';
import type { FormSchema } from '@/components/form/form-messages';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
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
 * Tutor subject the Tutor is chosen already (correction 1). Task 3.4b: the
 * lessons of a group row are written to every part of its block (decision 3);
 * a half of a split may be marked as part of a mixed block (decision 12); a
 * class and a subject whose group switch is on offer the class's groups of
 * the subject (decision 13: "the subject's group switch is only the default").
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
  /** Whether the group is a split: it draws from one class only. */
  const isSplit = (groupId: string | null) =>
    groups.find((one) => one.id === groupId)?.classes.length === 1;

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
      mixedBlock: row?.mixedBlock === true ? CHECKED : '',
    },
    read: (typed) => {
      const fields = {
        teacherId: typed.teacherId,
        lessonsPerWeek: wholeNumber(typed.lessonsPerWeek),
        ...roomOf(typed.room),
        doubleLessons: typed.doubleLessons === CHECKED,
      };
      if (row !== null) {
        return (row.unit.kind === 'group' && isSplit(row.unit.id)) || row.mixedBlock
          ? { ...fields, mixedBlock: typed.mixedBlock === CHECKED }
          : fields;
      }
      const unit = unitOf(typed.unit);
      const groupId = unit !== null && 'groupId' in unit ? unit.groupId : null;
      return {
        classId: unit !== null && 'classId' in unit ? unit.classId : null,
        groupId,
        subjectId: typed.subjectId,
        ...fields,
        mixedBlock: isSplit(groupId) && typed.mixedBlock === CHECKED,
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
  // Decision 13: a subject whose group switch is on, chosen for a class.
  const chosenSubject = subjects.find((one) => one.id === subjectId);
  const defaultGroups =
    row === null && schoolClass !== undefined && chosenSubject?.groupSubject === true
      ? openYearGroups.filter(
          (one) =>
            one.subject.id === chosenSubject.id &&
            one.classes.some((member) => member.id === schoolClass.id),
        )
      : null;
  const unitField = form.bind('unit');
  // A row marked wrongly since (a class added to its group) shows the switch
  // too, so that the mark can be cleared (spec review of the build, should-fix 2).
  const split = (group !== undefined && group.classes.length === 1) || row?.mixedBlock === true;
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
          {...unitField}
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
      {defaultGroups !== null && (
        <div className="grid gap-2 text-sm" data-group-default="">
          <p>
            {t('timetable.load.groupDefault')}{' '}
            {defaultGroups.length === 0 && t('timetable.load.groupDefaultNone')}
          </p>
          {defaultGroups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {defaultGroups.map((one) => (
                <Button
                  key={one.id}
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    unitField.onChange({ target: { value: `group:${one.id}` } });
                  }}
                >
                  {t('timetable.load.useGroup', { name: one.name })}
                </Button>
              ))}
            </div>
          )}
        </div>
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
        <NoTeacherReasons
          answer={teachers.data}
          subjectName={(() => {
            const chosen = subjects.find((one) => one.id === subjectId);
            return chosen === undefined ? null : nameOf(chosen.names, i18n.language);
          })()}
          grades={unitGrades}
          language={schoolClass?.language ?? group?.language ?? null}
          teacherName={(one) => teacherName({ ...one, tutor: false })}
        />
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
        note={t(
          group === undefined
            ? 'timetable.load.lessonsNote'
            : row === null
              ? 'timetable.load.blockLessonsCreateNote'
              : 'timetable.load.blockLessonsNote',
          {
            min: number.format(1),
            max: number.format(LOAD_LESSONS_MAX),
          },
        )}
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
      {split && (
        <CheckboxField
          label={t('timetable.load.mixedBlock')}
          note={t('timetable.load.mixedNote')}
          {...form.bind('mixedBlock')}
        />
      )}
    </RecordForm>
  );
}

/**
 * Why no teacher or vacancy can take the row (task 3.5b, H30 of issue #105):
 * the subject in nobody's profile (with a link to Staff for a role that may
 * open it), a Tutor subject on a class with no Tutor, or each one with the
 * subject and the first reason it cannot.
 */
function NoTeacherReasons({
  answer,
  subjectName,
  grades,
  language,
  teacherName,
}: {
  answer: LoadTeachers;
  subjectName: string | null;
  grades: readonly number[];
  language: InstructionLanguage | null;
  teacherName: (one: { kind: string; name: string | null }) => string;
}) {
  const { t } = useTranslation();
  const { role } = useView();
  if (subjectName === null) {
    return <p className="text-sm text-muted-foreground">{t('timetable.load.noTeachers')}</p>;
  }
  if (answer.excluded.length === 0) {
    return (
      <p className="text-sm">
        {answer.noTutor
          ? t('timetable.load.noTutorTeacher', { subject: subjectName })
          : t('timetable.load.noSubjectTeacher', { subject: subjectName })}{' '}
        {!answer.noTutor && role !== null && permits(PERMISSIONS, role, 'staff', 'view') && (
          <Link
            to="/people/staff"
            className="font-semibold text-link underline-offset-4 hover:underline"
          >
            {t('timetable.load.openStaff')}
          </Link>
        )}
      </p>
    );
  }
  const reasonOf = (one: LoadTeachers['excluded'][number]) => {
    const teacher = teacherName(one);
    switch (one.reason) {
      case 'status':
        return t('timetable.load.whyStatus', { teacher });
      case 'grade':
        return t('timetable.load.whyGrade', { teacher, grades: grades.join(', ') });
      case 'language':
        return language === null
          ? t('timetable.load.whyLanguageUnnamed', { teacher })
          : t('timetable.load.whyLanguage', {
              teacher,
              language: t(`classes.inLanguage.${language}`),
            });
      case 'block':
        return t('timetable.load.whyBlock', { teacher, group: one.blockGroup ?? '—' });
    }
  };
  return (
    <div className="grid gap-1 text-sm">
      <p className="text-muted-foreground">{t('timetable.load.noTeachers')}</p>
      <ul className="grid gap-1">
        {answer.excluded.map((one) => (
          <li key={one.id}>{reasonOf(one)}</li>
        ))}
      </ul>
    </div>
  );
}
