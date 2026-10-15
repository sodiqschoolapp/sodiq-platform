import {
  classDisplayName,
  GROUP_MAX_SIZE,
  groupCreateSchema,
  groupEditSchema,
  INSTRUCTION_LANGUAGES,
  type AcademicYear,
  type GroupCreate,
  type GroupDetail,
  type GroupEdit,
  type InstructionLanguage,
  type SchoolClass,
  type Subject,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import {
  CheckboxGroupField,
  Field,
  listValue,
  listValues,
  NumberField,
  SelectField,
} from '@/components/field';
import type { FormSchema } from '@/components/form/form-messages';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { GroupSlots } from './group-slots';
import { groupSlotsQuery, groupsQuery } from './groups-api';
import { useTakenRecord } from './taken-name';

interface GroupFormProps {
  /** The group as saved; `null` for a new group. */
  group: GroupDetail | null;
  /** The planned and current years of the branch, for a new group (decision 5). */
  years: readonly AcademicYear[];
  /** The classes of the branch: the active ones of the group's year are offered. */
  classes: readonly SchoolClass[];
  /** The subjects: the active ones are offered for a new group. */
  subjects: readonly Subject[];
  label: string;
  onSave: (record: GroupCreate | GroupEdit) => Promise<void>;
  onCancel?: () => void;
  /** Opens the group that holds the name, archived or not. */
  onOpenTaken?: (id: string) => void;
}

/** The group that holds a name refused as taken (`details` of `already_exists`), or none. */
function takenGroupOf(failure: unknown): string | null {
  if (!(failure instanceof ApiFailure) || failure.code !== 'already_exists') {
    return null;
  }
  return failure.details?.find((one) => one.path === 'name')?.recordId ?? null;
}

/** The one language of these classes, or `null` when they differ (decision 8). */
export function sharedLanguage(
  classes: readonly { language: InstructionLanguage }[],
): InstructionLanguage | null {
  const languages = new Set(classes.map((one) => one.language));
  const [only] = [...languages];
  return languages.size === 1 && only !== undefined ? only : null;
}

/**
 * The record of a group (`05`, Group: subject, grade or two grades, name,
 * language, maximum size; task 3.2a). The year and the subject are chosen at
 * the create and fixed (decision 5). The classes give the grades, and their
 * language when they share one; mixed classes take a chosen language, with a
 * confirmed warning for a subject under the language rule (decision 8). A
 * group of two grades shows the lesson slots both grades share (decision 9).
 */
export function GroupForm({
  group,
  years,
  classes,
  subjects,
  label,
  onSave,
  onCancel,
  onOpenTaken,
}: GroupFormProps) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const confirm = useConfirm();
  const number = new Intl.NumberFormat(i18n.language);
  const open = years.filter((year) => year.status !== 'closed');
  const current = open.find((year) => year.status === 'current') ?? open[0];
  const activeSubjects = subjects.filter((subject) => subject.archivedAt === null);
  const schema: FormSchema<GroupCreate | GroupEdit> =
    group === null ? groupCreateSchema : groupEditSchema;

  const chosenOf = (typed: { classIds: string }) => {
    const ids = new Set(listValues(typed.classIds));
    return classes.filter((one) => ids.has(one.id));
  };
  const subjectOf = (id: string) => subjects.find((subject) => subject.id === id);

  const form = useRecordForm({
    schema,
    initial: {
      academicYearId: group?.academicYearId ?? current?.id ?? '',
      subjectId: group?.subject.id ?? '',
      classIds: listValue(group?.classes.map((one) => one.id) ?? []),
      name: group?.name ?? '',
      language: group?.language ?? '',
      maxSize: group === null ? '' : String(group.maxSize),
    },
    read: (typed) => {
      const mixed = sharedLanguage(chosenOf(typed)) === null;
      return {
        ...(group === null
          ? { academicYearId: typed.academicYearId, subjectId: typed.subjectId }
          : { version: group.version }),
        classIds: listValues(typed.classIds),
        name: typed.name,
        // Decision 8: the classes' language when they share one.
        language: mixed && typed.language !== '' ? typed.language : null,
        maxSize: wholeNumber(typed.maxSize),
        confirmMixedLanguage: false,
      };
    },
    checkedOnSave: ['classIds'],
    message: (field) => (field === 'classIds' ? t('groups.chooseClasses') : undefined),
    save: async (record) => {
      const chosen = chosenOf({ classIds: listValue(record.classIds) });
      const ruled =
        group === null
          ? subjectOf('subjectId' in record ? record.subjectId : '')?.languageRule
          : group.subject.languageRule;
      let confirmed = false;
      if (chosen.length > 0 && sharedLanguage(chosen) === null && ruled === true) {
        confirmed = await confirm({
          title: t('groups.mixedTitle'),
          text: t('groups.mixedText'),
          names: chosen.map((one) => classDisplayName(one.grade, one.name)),
          action: t('groups.mixedConfirm'),
        });
        if (!confirmed) {
          throw new SaveCancelled();
        }
      }
      await onSave({ ...record, confirmMixedLanguage: confirmed });
    },
  });
  const taken = takenGroupOf(form.failure);
  const groups = useQuery({ ...groupsQuery(branchId), select: (list) => list.groups });
  const holder = useTakenRecord(taken, groups);
  const yearId = form.bind('academicYearId').value;
  const offered = classes.filter(
    (one) =>
      one.academicYearId === yearId &&
      (!one.archived || group?.classes.some((kept) => kept.id === one.id) === true),
  );
  const chosen = chosenOf({ classIds: form.bind('classIds').value });
  const shared = sharedLanguage(chosen);
  const grades = new Set(chosen.map((one) => one.grade));
  const slots = useQuery({
    ...groupSlotsQuery(
      branchId,
      chosen.map((one) => one.id),
    ),
    enabled: branchId !== null && grades.size === 2,
  });

  return (
    <RecordForm
      form={form}
      label={label}
      onCancel={onCancel}
      failureText={holder === undefined ? undefined : t('groups.nameTaken', { name: holder.name })}
    >
      {group === null && (
        <SelectField
          label={t('groups.year')}
          options={open.map((year) => ({ value: year.id, label: year.name }))}
          {...form.bind('academicYearId')}
        />
      )}
      {group === null && (
        <SelectField
          label={t('groups.subject')}
          options={[
            { value: '', label: t('groups.chooseSubject') },
            ...activeSubjects.map((subject) => ({
              value: subject.id,
              label: nameOf(subject.names, i18n.language),
            })),
          ]}
          {...form.bind('subjectId')}
        />
      )}
      {offered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('groups.noClasses')}</p>
      ) : (
        <CheckboxGroupField
          label={t('groups.classes')}
          options={offered.map((one) => ({
            value: one.id,
            label: classDisplayName(one.grade, one.name),
          }))}
          {...form.bind('classIds')}
        />
      )}
      {grades.size === 2 && <GroupSlots query={slots} />}
      <Field label={t('groups.groupName')} autoComplete="off" {...form.bind('name')} />
      {taken !== null && onOpenTaken !== undefined && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenTaken(taken);
            }}
          >
            {t('groups.takenOpen')}
          </Button>
        </div>
      )}
      {shared !== null || chosen.length === 0 ? (
        shared !== null && (
          <p className="text-sm">
            {t('groups.languageOfClasses', {
              language: t(`people.staff.languages.${shared}`),
            })}
          </p>
        )
      ) : (
        <SelectField
          label={t('groups.language')}
          options={[
            { value: '', label: t('groups.language') },
            ...INSTRUCTION_LANGUAGES.map((language) => ({
              value: language,
              label: t(`people.staff.languages.${language}`),
            })),
          ]}
          {...form.bind('language')}
        />
      )}
      <NumberField
        label={t('groups.maxSize')}
        note={t('groups.maxSizeNote', {
          min: number.format(1),
          max: number.format(GROUP_MAX_SIZE),
        })}
        {...form.bind('maxSize')}
      />
    </RecordForm>
  );
}
