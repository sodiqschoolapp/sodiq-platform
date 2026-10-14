import {
  INSTRUCTION_LANGUAGES,
  vacancyRecordSchema,
  type DivisionList,
  type Subject,
  type VacancyDetail,
  type VacancyRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import {
  CheckboxGroupField,
  Field,
  listValue,
  listValues,
  NumberField,
  SelectField,
} from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { nameOf } from '@/features/setup/setup-api';
import { asFormSchema, isGradesField, subjectsFieldOf } from './form-schema';

type Fields =
  | 'name'
  | 'departmentId'
  | 'subjects'
  | 'languages'
  | 'weeklyLessons'
  | 'dailyLessons'
  | `grades.${string}`;

const numberOrNull = (typed: string) => (typed.trim() === '' ? null : wholeNumber(typed));

/**
 * What is typed for a vacancy (`04`, Vacancy: "a name such as "English
 * vacancy 2", one branch, the Academic division and one department, subjects
 * with the grades taught, languages of instruction ... and contract load, and
 * nothing personal"; task 2.2b). The departments offered are those of the
 * Academic division; the subjects those of the chosen department, and a
 * subject the vacancy already has.
 */
export function VacancyForm({
  vacancy,
  divisions,
  subjects,
  label,
  onSave,
  onCancel,
}: {
  vacancy: VacancyDetail | null;
  divisions: DivisionList;
  subjects: readonly Subject[];
  label: string;
  onSave: (record: VacancyRecord) => Promise<void>;
  /** Closes the form (opened by Edit in the side panel). */
  onCancel?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const academic = divisions.divisions.find((division) => division.builtIn);
  const departments = (academic?.departments ?? []).filter(
    (department) => department.archivedAt === null || department.id === vacancy?.departmentId,
  );
  const initial: Record<string, string> = {
    name: vacancy?.name ?? '',
    departmentId: vacancy?.departmentId ?? '',
    subjects: listValue((vacancy?.subjects ?? []).map((own) => own.subjectId)),
    languages: listValue(vacancy?.languages ?? []),
    weeklyLessons:
      vacancy?.weeklyLessons === null || vacancy === null ? '' : String(vacancy.weeklyLessons),
    dailyLessons:
      vacancy?.dailyLessons === null || vacancy === null ? '' : String(vacancy.dailyLessons),
  };
  for (const subject of subjects) {
    initial[`grades.${subject.id}`] = listValue(
      (vacancy?.subjects.find((own) => own.subjectId === subject.id)?.grades ?? []).map(String),
    );
  }
  const form = useRecordForm<Fields, VacancyRecord>({
    schema: asFormSchema<VacancyRecord>(vacancyRecordSchema, subjectsFieldOf),
    initial: initial,
    read: (typed) => ({
      name: typed.name,
      departmentId: typed.departmentId,
      subjects: listValues(typed.subjects).map((subjectId) => ({
        subjectId,
        grades: listValues(typed[`grades.${subjectId}`] ?? '')
          .map(Number)
          .sort((a, b) => a - b),
      })),
      languages: listValues(typed.languages),
      weeklyLessons: numberOrNull(typed.weeklyLessons),
      dailyLessons: numberOrNull(typed.dailyLessons),
    }),
    // Finding 21: a subject's grades say what is missing on Save, under that
    // subject's grades.
    // The languages too: a subject needs one (review of the build, must fix 1).
    checkedOnSave: [...(Object.keys(initial) as Fields[]).filter(isGradesField), 'languages'],
    message: (field) =>
      isGradesField(field)
        ? t('form.chooseGrade')
        : field === 'languages'
          ? t('form.chooseOne')
          : undefined,
    save: onSave,
  });
  const department = form.bind('departmentId').value;
  const offered = subjects.filter(
    (subject) =>
      (vacancy?.subjects.some((own) => own.subjectId === subject.id) ?? false) ||
      (subject.archivedAt === null && subject.departmentId === department),
  );
  const chosen = listValues(form.bind('subjects').value);
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <Field label={t('people.vacancies.name')} autoComplete="off" {...form.bind('name')} />
      <SelectField
        label={t('people.vacancies.department')}
        options={[
          { value: '', label: t('people.staff.choose') },
          ...departments.map((one) => ({ value: one.id, label: nameOf(one.names, language) })),
        ]}
        {...form.bind('departmentId')}
      />
      {offered.length > 0 && (
        <CheckboxGroupField
          label={t('people.vacancies.subjects')}
          options={offered.map((subject) => ({
            value: subject.id,
            label: nameOf(subject.names, language),
          }))}
          {...form.bind('subjects')}
        />
      )}
      {offered
        .filter((subject) => chosen.includes(subject.id))
        .map((subject) => (
          <CheckboxGroupField
            key={subject.id}
            label={t('people.staff.gradesOf', { subject: nameOf(subject.names, language) })}
            options={subject.grades.map((grade) => ({
              value: String(grade),
              label: t('setup.subjects.grade', { grade }),
            }))}
            {...form.bind(`grades.${subject.id}`)}
          />
        ))}
      <CheckboxGroupField
        label={t('people.staff.languagesTitle')}
        options={INSTRUCTION_LANGUAGES.map((one) => ({
          value: one,
          label: t(`people.staff.languages.${one}`),
        }))}
        {...form.bind('languages')}
      />
      <NumberField label={t('people.staff.weeklyLessons')} {...form.bind('weeklyLessons')} />
      <NumberField label={t('people.staff.dailyLessons')} {...form.bind('dailyLessons')} />
    </RecordForm>
  );
}
