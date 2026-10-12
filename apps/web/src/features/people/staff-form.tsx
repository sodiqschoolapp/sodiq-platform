import {
  CONTRACT_TYPES,
  DEFAULT_PHONE_PREFIX,
  EDUCATION_LEVELS,
  SEXES,
  STAFF_CONTACT_FIELDS,
  staffRecordSchema,
  type DivisionList,
  type StaffDetail,
  type StaffRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import {
  CheckboxGroupField,
  DateField,
  Field,
  listValue,
  listValues,
  NumberField,
  SelectField,
} from '@/components/field';
import { wholeNumber, type FormIssue, type FormSchema } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { nameOf } from '@/features/setup/setup-api';

/** The fields of the form: one per input. */
export type StaffField =
  | 'firstName'
  | 'lastName'
  | 'fatherName'
  | 'sex'
  | 'birthDate'
  | 'educationLevel'
  | 'phone'
  | 'email'
  | 'jshshir'
  | 'admissionDate'
  | 'contractType'
  | 'contractDate'
  | 'weeklyLessons'
  | 'dailyLessons'
  | 'mainDivision'
  | 'mainDepartment'
  | 'furtherDivisions'
  | 'furtherDepartment';

/** The field of the form an issue of the record names: the divisions are the main division's field. */
function fieldOf(path: readonly PropertyKey[]): PropertyKey[] {
  const [first, , third] = path;
  if (first === 'divisions') {
    return [third === 'departmentId' ? 'mainDepartment' : 'mainDivision'];
  }
  return [...path];
}

/** The schema of `packages/shared`, its issues named by the fields of this form. */
const FORM_SCHEMA: FormSchema<StaffRecord> = {
  safeParse: (input) => {
    const result = staffRecordSchema.safeParse(input);
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

const orNull = (typed: string): string | null => (typed === '' ? null : typed);
const numberOrNull = (typed: string) => (typed.trim() === '' ? null : wholeNumber(typed));

interface StaffFormProps {
  /** The person as saved; `null` for a new one. */
  staff: StaffDetail | null;
  /** The divisions of the school with their departments. */
  divisions: DivisionList;
  /** The Academic Vice Principal: name, phone and email only (decision 2); the server decides it. */
  contactOnly: boolean;
  label: string;
  onSave: (record: StaffRecord) => Promise<void>;
}

/**
 * The record of a person (`04`, Teacher and staff record: Personal and
 * Academic blocks). The subjects and languages, the branches and the status
 * have forms of their own. A department is chosen in the main division and,
 * when Academic is a further division, there too ("Teaching from another
 * division", `03`).
 */
export function StaffForm({ staff, divisions, contactOnly, label, onSave }: StaffFormProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const academic = divisions.divisions.find((division) => division.builtIn);
  const main = staff?.divisions.find((division) => division.main);
  const further = staff?.divisions.filter((division) => !division.main) ?? [];
  const furtherAcademic = further.find((division) => division.divisionId === academic?.id);
  const form = useRecordForm<StaffField, StaffRecord>({
    schema: FORM_SCHEMA,
    initial: {
      firstName: staff?.firstName ?? '',
      lastName: staff?.lastName ?? '',
      fatherName: staff?.fatherName ?? '',
      sex: staff?.sex ?? '',
      birthDate: staff?.birthDate ?? '',
      educationLevel: staff?.educationLevel ?? '',
      phone: staff?.phone ?? `${DEFAULT_PHONE_PREFIX} `,
      email: staff?.email ?? '',
      jshshir: staff?.jshshir ?? '',
      admissionDate: staff?.admissionDate ?? '',
      contractType: staff?.contractType ?? '',
      contractDate: staff?.contractDate ?? '',
      weeklyLessons: staff?.weeklyLessons === null ? '' : String(staff?.weeklyLessons ?? ''),
      dailyLessons: staff?.dailyLessons === null ? '' : String(staff?.dailyLessons ?? ''),
      mainDivision: main?.divisionId ?? academic?.id ?? '',
      mainDepartment: main?.departmentId ?? '',
      furtherDivisions: listValue(further.map((division) => division.divisionId)),
      furtherDepartment: furtherAcademic?.departmentId ?? '',
    },
    read: (typed) => ({
      firstName: typed.firstName,
      lastName: typed.lastName,
      fatherName: typed.fatherName,
      sex: typed.sex,
      birthDate: typed.birthDate,
      educationLevel: orNull(typed.educationLevel),
      phone: typed.phone,
      email: typed.email,
      jshshir: typed.jshshir,
      admissionDate: typed.admissionDate,
      contractType: orNull(typed.contractType),
      contractDate: orNull(typed.contractDate),
      weeklyLessons: numberOrNull(typed.weeklyLessons),
      dailyLessons: numberOrNull(typed.dailyLessons),
      divisions: [
        {
          divisionId: typed.mainDivision,
          departmentId: orNull(typed.mainDepartment),
          main: true,
        },
        ...listValues(typed.furtherDivisions)
          .filter((id) => id !== typed.mainDivision)
          .map((id) => ({
            divisionId: id,
            // A department of a further division other than Academic stays as it was.
            departmentId:
              id === academic?.id
                ? orNull(typed.furtherDepartment)
                : (further.find((division) => division.divisionId === id)?.departmentId ?? null),
            main: false,
          })),
      ],
    }),
    save: onSave,
  });

  const locked = (field: StaffField) =>
    contactOnly && !(STAFF_CONTACT_FIELDS as readonly string[]).includes(field);
  const bind = (field: StaffField) => ({ ...form.bind(field), disabled: locked(field) });
  const mainDivision = divisions.divisions.find(
    (division) => division.id === form.bind('mainDivision').value,
  );
  const offered = (id: string, archivedAt: string | null, current: readonly string[]) =>
    archivedAt === null || current.includes(id);
  const currentDivisions = staff?.divisions.map((division) => division.divisionId) ?? [];
  const currentDepartments = (staff?.divisions ?? []).flatMap((division) =>
    division.departmentId === null ? [] : [division.departmentId],
  );
  const departmentOptions = (divisionId: string | undefined) => [
    { value: '', label: t('people.staff.noDepartment') },
    ...(divisions.divisions.find((division) => division.id === divisionId)?.departments ?? [])
      .filter((one) => offered(one.id, one.archivedAt, currentDepartments))
      .map((one) => ({ value: one.id, label: nameOf(one.names, language) })),
  ];
  const furtherChosen = listValues(form.bind('furtherDivisions').value);
  const option = (value: string, labelText: string) => ({ value, label: labelText });

  return (
    <RecordForm form={form} label={label}>
      <Field label={t('people.staff.firstName')} autoComplete="off" {...bind('firstName')} />
      <Field label={t('people.staff.lastName')} autoComplete="off" {...bind('lastName')} />
      <Field label={t('people.staff.fatherName')} autoComplete="off" {...bind('fatherName')} />
      <SelectField
        label={t('people.staff.sex')}
        options={[
          option('', t('people.staff.choose')),
          ...SEXES.map((sex) => option(sex, t(`people.staff.sexes.${sex}`))),
        ]}
        {...bind('sex')}
      />
      <DateField label={t('people.staff.birthDate')} {...bind('birthDate')} />
      <SelectField
        label={t('people.staff.educationLevel')}
        options={[
          option('', t('people.staff.notSet')),
          ...EDUCATION_LEVELS.map((level) =>
            option(level, t(`people.staff.educationLevels.${level}`)),
          ),
        ]}
        {...bind('educationLevel')}
      />
      <Field label={t('people.staff.phone')} type="tel" autoComplete="off" {...bind('phone')} />
      <Field label={t('people.staff.email')} type="email" autoComplete="off" {...bind('email')} />
      <Field label={t('people.staff.jshshir')} inputMode="numeric" {...bind('jshshir')} />
      <DateField label={t('people.staff.admissionDate')} {...bind('admissionDate')} />
      <SelectField
        label={t('people.staff.contractType')}
        options={[
          option('', t('people.staff.notSet')),
          ...CONTRACT_TYPES.map((type) => option(type, t(`people.staff.contractTypes.${type}`))),
        ]}
        {...bind('contractType')}
      />
      <DateField label={t('people.staff.contractDate')} {...bind('contractDate')} />
      <NumberField label={t('people.staff.weeklyLessons')} {...bind('weeklyLessons')} />
      <NumberField label={t('people.staff.dailyLessons')} {...bind('dailyLessons')} />
      <SelectField
        label={t('people.staff.mainDivision')}
        options={divisions.divisions
          .filter((division) => offered(division.id, division.archivedAt, currentDivisions))
          .map((division) => option(division.id, nameOf(division.names, language)))}
        {...bind('mainDivision')}
      />
      <SelectField
        label={t('people.staff.department')}
        options={departmentOptions(mainDivision?.id)}
        {...bind('mainDepartment')}
      />
      <CheckboxGroupField
        label={t('people.staff.furtherDivisions')}
        options={divisions.divisions
          .filter(
            (division) =>
              division.id !== mainDivision?.id &&
              offered(division.id, division.archivedAt, currentDivisions),
          )
          .map((division) => option(division.id, nameOf(division.names, language)))}
        {...bind('furtherDivisions')}
      />
      {academic !== undefined &&
        academic.id !== mainDivision?.id &&
        furtherChosen.includes(academic.id) && (
          <SelectField
            label={t('people.staff.academicDepartment')}
            options={departmentOptions(academic.id)}
            {...bind('furtherDepartment')}
          />
        )}
    </RecordForm>
  );
}
