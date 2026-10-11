import {
  JOURNAL_TYPES,
  newSubjectRecordSchema,
  SUBJECT_COLOURS,
  SUBJECT_GRADES,
  subjectRecordSchema,
  type Subject,
  type SubjectColour,
  type SubjectRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import {
  CHECKED,
  CheckboxField,
  CheckboxGroupField,
  Field,
  listValue,
  listValues,
  SelectField,
} from '@/components/field';
import { wholeNumber, type FormIssue, type FormSchema } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { takenNameOf } from './division-panel';
import { SubjectSwatch } from './subject-colour';
import { WeightFields } from './weights-form';

/** The fields of the form: one per input, the daily parts under `daily`, and the total. */
type SubjectField =
  | 'nameUz'
  | 'nameRu'
  | 'nameEn'
  | 'departmentId'
  | 'grades'
  | 'colour'
  | 'journalType'
  | 'ratingExam'
  | 'groupSubject'
  | 'languageRule'
  | 'demanding'
  | 'dailyattendance'
  | 'dailyclasswork'
  | 'dailyhomework'
  | 'dailyratingExam'
  | 'dailytotal';

/** The field of the form an issue of the record names: `names.uz` is `nameUz`, `daily.total` is `dailytotal`. */
function fieldOf(path: readonly PropertyKey[]): PropertyKey[] {
  const [first, second] = path;
  if (first === 'names' && typeof second === 'string') {
    return [`name${second.charAt(0).toUpperCase()}${second.slice(1)}`];
  }
  if (first === 'daily') {
    return [`daily${typeof second === 'string' ? second : 'total'}`];
  }
  return [...path];
}

/**
 * The schema of `packages/shared` the server checks the record with, its
 * issues named by the fields of this form: the rules stay the shared ones.
 */
function formSchema(isNew: boolean): FormSchema<SubjectRecord> {
  const schema = isNew ? newSubjectRecordSchema : subjectRecordSchema;
  return {
    safeParse: (input) => {
      const result = schema.safeParse(input);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return {
        success: false,
        error: {
          issues: result.error.issues.map((issue): FormIssue => ({
            ...issue,
            path: fieldOf(issue.path),
          })),
        },
      };
    },
  };
}

export interface DepartmentChoice {
  id: string;
  name: string;
}

interface SubjectFormProps {
  /** The subject as saved; `null` for a new one. */
  subject: Subject | null;
  /** The active departments of Academic (decision 6). */
  departments: readonly DepartmentChoice[];
  /**
   * Whether the form asks for this branch's daily distribution: always for a
   * new subject, and on an edit while the branch has none (decision 15).
   */
  asksDaily: boolean;
  label: string;
  /** What the name field says when the server answers that the name is taken. */
  onSave: (record: SubjectRecord) => Promise<void>;
}

/**
 * The record of a subject (`05`, Subject: "Name in three languages, colour,
 * department, grades, rating exam switch, group subject switch, ... journal
 * type (graded or attendance only), daily distribution, ... language rule
 * switch (on by default)"; `edge/timetable`: the "demanding" switch). An
 * attendance-only subject has no rating exam and no weights.
 */
export function SubjectForm({ subject, departments, asksDaily, label, onSave }: SubjectFormProps) {
  const { t } = useTranslation();
  const switchValue = (on: boolean) => (on ? CHECKED : '');
  const form = useRecordForm<SubjectField, SubjectRecord>({
    schema: formSchema(subject === null),
    initial: {
      nameUz: subject?.names.uz ?? '',
      nameRu: subject?.names.ru ?? '',
      nameEn: subject?.names.en ?? '',
      departmentId: subject?.departmentId ?? '',
      grades: listValue((subject?.grades ?? []).map(String)),
      colour: subject?.colour ?? 'blue',
      journalType: subject?.journalType ?? 'graded',
      ratingExam: switchValue(subject?.ratingExam ?? false),
      groupSubject: switchValue(subject?.groupSubject ?? false),
      languageRule: switchValue(subject?.languageRule ?? true),
      demanding: switchValue(subject?.demanding ?? false),
      dailyattendance: '',
      dailyclasswork: '',
      dailyhomework: '',
      dailyratingExam: '',
      dailytotal: '',
    },
    read: (typed) => {
      const graded = typed.journalType === 'graded';
      return {
        names: { uz: typed.nameUz, ru: typed.nameRu, en: typed.nameEn },
        departmentId: typed.departmentId,
        grades: listValues(typed.grades).map(Number),
        colour: typed.colour,
        journalType: typed.journalType,
        ratingExam: graded && typed.ratingExam === CHECKED,
        groupSubject: typed.groupSubject === CHECKED,
        languageRule: typed.languageRule === CHECKED,
        demanding: typed.demanding === CHECKED,
        daily:
          graded && asksDaily
            ? {
                attendance: wholeNumber(typed.dailyattendance),
                classwork: wholeNumber(typed.dailyclasswork),
                homework: wholeNumber(typed.dailyhomework),
              }
            : null,
      };
    },
    message: (field) => (field === 'dailytotal' ? t('setup.subjects.totalWrong') : undefined),
    save: onSave,
  });
  const taken = takenNameOf(form.failure);
  const graded = form.bind('journalType').value === 'graded';
  const colour = form.bind('colour');
  const nameField = (field: 'nameUz' | 'nameRu' | 'nameEn', language: 'uz' | 'ru' | 'en') => {
    const bound = form.bind(field);
    return (
      <Field
        label={t(`setup.subjects.${field}`)}
        autoComplete="off"
        {...bound}
        error={bound.error ?? (taken === language ? t('setup.subjects.nameTaken') : undefined)}
      />
    );
  };

  return (
    <RecordForm form={form} label={label}>
      {nameField('nameUz', 'uz')}
      {nameField('nameRu', 'ru')}
      {nameField('nameEn', 'en')}
      <SelectField
        label={t('setup.subjects.department')}
        options={[
          { value: '', label: t('setup.subjects.chooseDepartment') },
          ...departments.map((one) => ({ value: one.id, label: one.name })),
        ]}
        {...form.bind('departmentId')}
      />
      <CheckboxGroupField
        label={t('setup.subjects.grades')}
        options={SUBJECT_GRADES.map((grade) => ({
          value: String(grade),
          label: t('setup.subjects.grade', { grade }),
        }))}
        {...form.bind('grades')}
      />
      <div className="flex items-end gap-2">
        <div className="grow">
          <SelectField
            label={t('setup.subjects.colour')}
            options={SUBJECT_COLOURS.map((one) => ({
              value: one,
              label: t(`setup.subjects.colours.${one}`),
            }))}
            {...colour}
          />
        </div>
        <SubjectSwatch colour={colour.value as SubjectColour} className="mb-3 size-5" />
      </div>
      <SelectField
        label={t('setup.subjects.journalType')}
        options={JOURNAL_TYPES.map((type) => ({
          value: type,
          label: t(`setup.subjects.journalTypes.${type}`),
        }))}
        {...form.bind('journalType')}
      />
      {graded && (
        <CheckboxField label={t('setup.subjects.ratingExam')} {...form.bind('ratingExam')} />
      )}
      <CheckboxField label={t('setup.subjects.groupSubject')} {...form.bind('groupSubject')} />
      <CheckboxField label={t('setup.subjects.languageRule')} {...form.bind('languageRule')} />
      <CheckboxField label={t('setup.subjects.demanding')} {...form.bind('demanding')} />
      {graded && asksDaily && (
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t('setup.subjects.daily')}</legend>
          <WeightFields
            form={form}
            parts={['attendance', 'classwork', 'homework']}
            prefix="daily"
          />
        </fieldset>
      )}
    </RecordForm>
  );
}
