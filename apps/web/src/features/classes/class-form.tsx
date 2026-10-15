import {
  CLASS_GRADES,
  CLASS_MAX_SIZE,
  classCreateSchema,
  classEditSchema,
  INSTRUCTION_LANGUAGES,
  type AcademicYear,
  type ClassCreate,
  type ClassDetail,
  type ClassEdit,
  type Room,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { Field, NumberField, SelectField } from '@/components/field';
import type { FormSchema } from '@/components/form/form-messages';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { classesQuery } from './classes-api';
import { useTakenRecord } from './taken-name';

interface ClassFormProps {
  /** The class as saved; `null` for a new class. */
  schoolClass: ClassDetail | null;
  /** The planned and current years of the branch, for a new class (decision 6). */
  years: readonly AcademicYear[];
  /** The rooms of the branch: those not closed are offered (decision 7). */
  rooms: readonly Room[];
  label: string;
  onSave: (record: ClassCreate | ClassEdit) => Promise<void>;
  onCancel?: () => void;
  /** Opens the class that holds the name, archived or not ("adding one that exists offers restore"). */
  onOpenTaken?: (id: string) => void;
}

/** The class that holds a name refused as taken (`details` of `already_exists`), or none. */
export function takenClassOf(failure: unknown): string | null {
  if (!(failure instanceof ApiFailure) || failure.code !== 'already_exists') {
    return null;
  }
  return failure.details?.find((one) => one.path === 'name')?.recordId ?? null;
}

/**
 * The record of a class (`05`, Class: grade, name, language of instruction,
 * main classroom, maximum size, academic year). The year is chosen at the
 * create and fixed afterwards (decision 6); the edit sends the state it was
 * made on.
 */
export function ClassForm({
  schoolClass,
  years,
  rooms,
  label,
  onSave,
  onCancel,
  onOpenTaken,
}: ClassFormProps) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const open = years.filter((year) => year.status !== 'closed');
  const current = open.find((year) => year.status === 'current') ?? open[0];
  const schema: FormSchema<ClassCreate | ClassEdit> =
    schoolClass === null ? classCreateSchema : classEditSchema;
  const form = useRecordForm({
    schema,
    initial: {
      academicYearId: schoolClass?.academicYearId ?? current?.id ?? '',
      grade: schoolClass === null ? '' : String(schoolClass.grade),
      name: schoolClass?.name ?? '',
      language: schoolClass?.language ?? 'uz',
      mainRoomId: schoolClass?.mainRoom?.id ?? '',
      maxSize: schoolClass === null ? '' : String(schoolClass.maxSize),
    },
    read: (typed) => ({
      ...(schoolClass === null
        ? { academicYearId: typed.academicYearId }
        : { version: schoolClass.version }),
      grade: wholeNumber(typed.grade),
      name: typed.name,
      language: typed.language,
      mainRoomId: typed.mainRoomId === '' ? null : typed.mainRoomId,
      maxSize: wholeNumber(typed.maxSize),
    }),
    save: onSave,
  });
  const taken = takenClassOf(form.failure);
  const { branchId } = useView();
  const classes = useQuery({ ...classesQuery(branchId), select: (list) => list.classes });
  const holder = useTakenRecord(taken, classes);
  // A room closed after it was chosen stays on its class (decision 7) and is offered as it is.
  const kept = schoolClass?.mainRoom ?? null;
  const roomOptions = [
    { value: '', label: t('classes.noRoom') },
    ...rooms
      .filter((room) => room.status !== 'closed' || room.id === kept?.id)
      .map((room) => ({
        value: room.id,
        label: room.status === 'closed' ? t('classes.closedRoom', { room: room.name }) : room.name,
      })),
  ];

  return (
    <RecordForm
      form={form}
      label={label}
      onCancel={onCancel}
      failureText={
        holder === undefined
          ? undefined
          : t('classes.nameTaken', { grade: number.format(holder.grade), name: holder.name })
      }
    >
      {schoolClass === null && (
        <SelectField
          label={t('classes.year')}
          options={open.map((year) => ({ value: year.id, label: year.name }))}
          {...form.bind('academicYearId')}
        />
      )}
      <SelectField
        label={t('classes.grade')}
        options={[
          { value: '', label: t('classes.grade') },
          ...CLASS_GRADES.map((grade) => ({
            value: String(grade),
            label: t('classes.gradeOption', { grade: number.format(grade) }),
          })),
        ]}
        {...form.bind('grade')}
      />
      <Field label={t('classes.className')} autoComplete="off" {...form.bind('name')} />
      {taken !== null && onOpenTaken !== undefined && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenTaken(taken);
            }}
          >
            {t('classes.takenOpen')}
          </Button>
        </div>
      )}
      <SelectField
        label={t('classes.language')}
        options={INSTRUCTION_LANGUAGES.map((language) => ({
          value: language,
          label: t(`people.staff.languages.${language}`),
        }))}
        {...form.bind('language')}
      />
      <SelectField
        label={t('classes.mainRoom')}
        options={roomOptions}
        {...form.bind('mainRoomId')}
      />
      <NumberField
        label={t('classes.maxSize')}
        note={t('classes.maxSizeNote', {
          min: number.format(1),
          max: number.format(CLASS_MAX_SIZE),
        })}
        {...form.bind('maxSize')}
      />
    </RecordForm>
  );
}
