import {
  DEFAULT_PHONE_PREFIX,
  DOCUMENT_TYPES,
  REGIONS,
  SCHOLARSHIP_COVERAGES,
  SCHOLARSHIP_TYPES,
  SEXES,
  studentCreateSchema,
  studentRecordSchema,
  type StudentCreate,
  type StudentDetail,
  type StudentRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { DateField, Field, NumberField, SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { asFormSchema } from './form-schema';

/** The fields of the form: one per input. */
export type StudentField =
  | 'uid'
  | 'firstName'
  | 'lastName'
  | 'paternalName'
  | 'sex'
  | 'birthDate'
  | 'grade'
  | 'startsOn'
  | 'documentType'
  | 'documentNumber'
  | 'jshshir'
  | 'phone'
  | 'email'
  | 'address'
  | 'region'
  | 'previousSchool'
  | 'diagnosticScore'
  | 'scholarshipType'
  | 'scholarshipCoverage'
  | 'scholarshipAmount'
  | 'consentSignedOn'
  | 'contractNumber'
  | 'contractSignedOn';

/** The field of the form an issue of the record names. */
function fieldOf(path: readonly PropertyKey[]): PropertyKey[] {
  const [first, second] = path;
  if (first === 'scholarship') {
    return [
      second === 'amount'
        ? 'scholarshipAmount'
        : second === 'coverage'
          ? 'scholarshipCoverage'
          : 'scholarshipType',
    ];
  }
  if (first === 'contract') {
    return [second === 'signedOn' ? 'contractSignedOn' : 'contractNumber'];
  }
  return [...path];
}

/** The field a refusal of the server names (`details` of 409 `student_value_taken`). */
const FIELD_OF_DETAIL: Readonly<Record<string, StudentField>> = {
  uid: 'uid',
  jshshir: 'jshshir',
  documentNumber: 'documentNumber',
  'contract.number': 'contractNumber',
};

/** A value refused as taken: the field, and the student of this branch who holds it when named. */
export function takenOf(failure: unknown): { field: StudentField; holderId: string | null } | null {
  if (!(failure instanceof ApiFailure) || failure.code !== 'student_value_taken') {
    return null;
  }
  const detail = failure.details?.find((one) => FIELD_OF_DETAIL[one.path] !== undefined);
  const field = detail === undefined ? undefined : FIELD_OF_DETAIL[detail.path];
  return field === undefined || detail === undefined
    ? null
    : { field, holderId: detail.recordId ?? null };
}

const CREATE_SCHEMA = asFormSchema<StudentCreate>(studentCreateSchema, fieldOf);
const EDIT_SCHEMA = asFormSchema<StudentRecord>(studentRecordSchema, fieldOf);

const orNull = (typed: string): string | null => (typed === '' ? null : typed);
const numberOrNull = (typed: string) => (typed.trim() === '' ? null : wholeNumber(typed));

interface StudentFormProps {
  /** The student as saved, read by a reader of every group; `null` for a new one. */
  student: StudentDetail | null;
  label: string;
  /** The name and UID of a student of this branch, by id, for a refusal that names one. */
  holderText: (id: string) => string | null;
  onCreate?: (record: StudentCreate) => Promise<void>;
  onEdit?: (record: StudentRecord) => Promise<void>;
}

/**
 * The record of a student (`04`, Student record: the Personal, Contract and
 * Payment blocks; answers 17 to 23). The UID and the start date are typed
 * when the student is created; the UID has a correction of its own and the
 * start date is fixed (decided in the build of task 2.4a).
 */
export function StudentForm({ student, label, holderText, onCreate, onEdit }: StudentFormProps) {
  const { t } = useTranslation();
  const creating = student === null;
  const contract = student?.financial?.contracts[0];
  const form = useRecordForm<StudentField, StudentCreate | StudentRecord>({
    schema: creating ? CREATE_SCHEMA : EDIT_SCHEMA,
    initial: {
      uid: student?.uid ?? '',
      firstName: student?.firstName ?? '',
      lastName: student?.lastName ?? '',
      paternalName: student?.paternalName ?? '',
      sex: student?.sex ?? '',
      birthDate: student?.identity?.birthDate ?? '',
      grade: student === null ? '' : String(student.grade),
      startsOn: student?.startsOn ?? '',
      documentType: student?.identity?.documentType ?? '',
      documentNumber: student?.identity?.documentNumber ?? '',
      jshshir: student?.identity?.jshshir ?? '',
      phone: student?.contact?.phone ?? `${DEFAULT_PHONE_PREFIX} `,
      email: student?.contact?.email ?? '',
      address: student?.identity?.address ?? '',
      region: student?.identity?.region ?? '',
      previousSchool: student?.financial?.previousSchool ?? '',
      diagnosticScore:
        student?.financial?.diagnosticScore === null ||
        student?.financial?.diagnosticScore === undefined
          ? ''
          : String(student.financial.diagnosticScore),
      scholarshipType: student?.financial?.scholarship.type ?? 'none',
      scholarshipCoverage: student?.financial?.scholarship.coverage ?? '',
      scholarshipAmount:
        student?.financial?.scholarship.amount === null ||
        student?.financial?.scholarship.amount === undefined
          ? ''
          : String(student.financial.scholarship.amount),
      consentSignedOn: student?.financial?.consentSignedOn ?? '',
      contractNumber: contract?.number ?? '',
      contractSignedOn: contract?.signedOn ?? '',
    },
    read: (typed) => {
      // The country code alone is no phone.
      const phone = typed.phone.trim() === DEFAULT_PHONE_PREFIX ? '' : typed.phone;
      const record = {
        firstName: typed.firstName,
        lastName: typed.lastName,
        paternalName: typed.paternalName,
        sex: typed.sex,
        birthDate: typed.birthDate,
        grade: numberOrNull(typed.grade),
        documentType: orNull(typed.documentType),
        documentNumber: typed.documentNumber,
        jshshir: typed.jshshir,
        phone,
        email: typed.email,
        address: typed.address,
        region: orNull(typed.region),
        previousSchool: typed.previousSchool,
        diagnosticScore: numberOrNull(typed.diagnosticScore),
        scholarship: {
          type: typed.scholarshipType,
          coverage: typed.scholarshipType === 'none' ? null : orNull(typed.scholarshipCoverage),
          amount:
            typed.scholarshipCoverage === 'partial' && typed.scholarshipType !== 'none'
              ? numberOrNull(typed.scholarshipAmount)
              : null,
        },
        consentSignedOn: orNull(typed.consentSignedOn),
        contract: { number: typed.contractNumber, signedOn: typed.contractSignedOn },
      };
      return creating
        ? { ...record, uid: typed.uid, startsOn: typed.startsOn, confirmUidSet: false }
        : record;
    },
    save: async (values) => {
      if ('uid' in values) {
        await onCreate?.(values);
      } else {
        await onEdit?.(values);
      }
    },
  });

  const taken = takenOf(form.failure);
  const takenText =
    taken === null
      ? null
      : taken.holderId === null
        ? t('people.students.takenElsewhere')
        : t('people.students.takenHere', { student: holderText(taken.holderId) ?? '' });
  const bind = (field: StudentField) => {
    const bound = form.bind(field);
    return {
      ...bound,
      error: bound.error ?? (taken?.field === field ? (takenText ?? undefined) : undefined),
    };
  };
  const option = (value: string, text: string) => ({ value, label: text });
  const scholarshipType = form.bind('scholarshipType').value;
  const coverage = form.bind('scholarshipCoverage').value;

  return (
    <RecordForm form={form} label={label}>
      {creating && <Field label={t('people.students.uid')} inputMode="numeric" {...bind('uid')} />}
      <Field label={t('people.students.lastName')} autoComplete="off" {...bind('lastName')} />
      <Field label={t('people.students.firstName')} autoComplete="off" {...bind('firstName')} />
      <Field
        label={t('people.students.paternalName')}
        autoComplete="off"
        {...bind('paternalName')}
      />
      <SelectField
        label={t('people.students.sex')}
        options={[
          option('', t('people.students.choose')),
          ...SEXES.map((sex) => option(sex, t(`people.staff.sexes.${sex}`))),
        ]}
        {...bind('sex')}
      />
      <DateField label={t('people.students.birthDate')} {...bind('birthDate')} />
      <SelectField
        label={t('people.students.grade')}
        options={[
          option('', t('people.students.choose')),
          ...Array.from({ length: 11 }, (_unused, index) =>
            option(String(index + 1), t('setup.subjects.grade', { grade: index + 1 })),
          ),
        ]}
        {...bind('grade')}
      />
      {creating && <DateField label={t('people.students.startsOn')} {...bind('startsOn')} />}
      <SelectField
        label={t('people.students.documentType')}
        options={[
          option('', t('people.students.notSet')),
          ...DOCUMENT_TYPES.map((type) => option(type, t(`people.students.documentTypes.${type}`))),
        ]}
        {...bind('documentType')}
      />
      <Field
        label={t('people.students.documentNumber')}
        autoComplete="off"
        {...bind('documentNumber')}
      />
      <Field label={t('people.students.jshshir')} inputMode="numeric" {...bind('jshshir')} />
      <Field label={t('people.students.phone')} type="tel" autoComplete="off" {...bind('phone')} />
      <Field
        label={t('people.students.email')}
        type="email"
        autoComplete="off"
        {...bind('email')}
      />
      <Field label={t('people.students.address')} autoComplete="off" {...bind('address')} />
      <SelectField
        label={t('people.students.region')}
        options={[
          option('', t('people.students.notSet')),
          ...REGIONS.map((region) => option(region, t(`people.students.regions.${region}`))),
        ]}
        {...bind('region')}
      />
      <Field
        label={t('people.students.previousSchool')}
        autoComplete="off"
        {...bind('previousSchool')}
      />
      <NumberField label={t('people.students.diagnosticScore')} {...bind('diagnosticScore')} />
      <Field
        label={t('people.students.contractNumber')}
        autoComplete="off"
        {...bind('contractNumber')}
      />
      <DateField label={t('people.students.contractSignedOn')} {...bind('contractSignedOn')} />
      <SelectField
        label={t('people.students.scholarshipType')}
        options={SCHOLARSHIP_TYPES.map((type) =>
          option(type, t(`people.students.scholarshipTypes.${type}`)),
        )}
        {...bind('scholarshipType')}
      />
      {scholarshipType !== 'none' && (
        <SelectField
          label={t('people.students.scholarshipCoverage')}
          options={[
            option('', t('people.students.choose')),
            ...SCHOLARSHIP_COVERAGES.map((one) =>
              option(one, t(`people.students.scholarshipCoverages.${one}`)),
            ),
          ]}
          {...bind('scholarshipCoverage')}
        />
      )}
      {scholarshipType !== 'none' && coverage === 'partial' && (
        <NumberField
          label={t('people.students.scholarshipAmount')}
          {...bind('scholarshipAmount')}
        />
      )}
      <DateField label={t('people.students.consentSignedOn')} {...bind('consentSignedOn')} />
    </RecordForm>
  );
}
