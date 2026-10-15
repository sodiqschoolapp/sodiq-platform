import {
  classDisplayName,
  DEFAULT_PHONE_PREFIX,
  phoneText,
  DOCUMENT_TYPES,
  REGIONS,
  RELATIONSHIPS,
  relativePhoneSchema,
  SCHOLARSHIP_COVERAGES,
  SCHOLARSHIP_TYPES,
  SEXES,
  studentCreateSchema,
  studentRecordSchema,
  type StudentCreate,
  type StudentDetail,
  type RelativeHolder,
  type StudentRecord,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import {
  CHECKED,
  CheckboxField,
  DateField,
  Field,
  NumberField,
  SelectField,
} from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { classesQuery } from '@/features/classes/classes-api';
import { GroupSeatRefusal } from '@/features/classes/class-members';
import { yearsQuery } from '@/features/setup/setup-api';
import { asFormSchema } from './form-schema';
import {
  extraPhoneIssueField,
  extraPhonesInitial,
  extraPhonesTyped,
  ExtraPhonesField,
  NEW_OWNER,
  NoticesField,
  OwnerChoice,
  phoneHolderOf,
  SAME_PERSON,
  smsWarning,
  type ExtraPhoneFields,
} from './relative-form';

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
  // The class of a new student (task 3.1b, decision 2).
  | 'classId'
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
  | 'contractSignedOn'
  // The relative of a new student (task 2.5a): the main contact.
  | 'relativePhone'
  | 'relativeNoPhone'
  | 'relativeName'
  | 'relativeRelationship'
  | 'relativeWorkplace'
  | 'relativeEmail'
  | 'relativePortal'
  | 'relativeNotices'
  // The new owner of a matched phone (task 2.5b-1).
  | 'relativeOwner'
  | 'relativePreviousPhone'
  | 'relativePreviousUnknown'
  // The extra phones of the relative (task 2.5b-2).
  | 'relativeExtraCount'
  | 'relativeExtra1'
  | 'relativeExtra2'
  | 'relativeExtra3';

const RELATIVE_EXTRA_FIELDS: ExtraPhoneFields<
  'relativeExtraCount' | 'relativeExtra1' | 'relativeExtra2' | 'relativeExtra3'
> = {
  count: 'relativeExtraCount',
  phones: ['relativeExtra1', 'relativeExtra2', 'relativeExtra3'],
};

/** The field of the relative step an issue of `relatives.0` names. */
const RELATIVE_FIELDS: Readonly<Record<string, StudentField>> = {
  fullName: 'relativeName',
  phone: 'relativePhone',
  workplace: 'relativeWorkplace',
  email: 'relativeEmail',
  relationship: 'relativeRelationship',
  previousPhone: 'relativePreviousPhone',
};

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
  if (first === 'relatives') {
    const extra = extraPhoneIssueField(path, RELATIVE_EXTRA_FIELDS);
    if (extra !== undefined) {
      return [extra];
    }
    const last = path[path.length - 1];
    return [(typeof last === 'string' ? RELATIVE_FIELDS[last] : undefined) ?? 'relativePhone'];
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

/** A value refused as taken. */
export interface Taken {
  field: StudentField;
  /** The student of this branch who holds it, when named. */
  holderId: string | null;
  /** A UID of a student deleted as created twice: reserved for good (task 2.4b-1). */
  released: boolean;
  /** A UID of a record merged into the holder (task 3.3d, correction 2). */
  merged?: boolean;
}

/** A value refused as taken: the field, and the student of this branch who holds it when named. */
export function takenOf(failure: unknown): Taken | null {
  if (!(failure instanceof ApiFailure) || failure.code !== 'student_value_taken') {
    return null;
  }
  const detail = failure.details?.find((one) => FIELD_OF_DETAIL[one.path] !== undefined);
  const field = detail === undefined ? undefined : FIELD_OF_DETAIL[detail.path];
  return field === undefined || detail === undefined
    ? null
    : {
        field,
        holderId: detail.recordId ?? null,
        released: detail.code === 'uid_released',
        ...(detail.code === 'uid_merged' ? { merged: true } : {}),
      };
}

/**
 * The text under a field refused as taken: the holder of the branch by name
 * and UID, while the list holds them; "another student of this branch" until
 * the list is read again; a UID of a deleted student; "a student of another
 * branch" otherwise.
 */
export function takenText(
  taken: Pick<Taken, 'holderId' | 'released' | 'merged'>,
  holderText: (id: string) => string | null,
):
  | ['people.students.uidMerged', { student: string }]
  | ['people.students.uidMergedUnknown']
  | ['people.students.takenElsewhere']
  | ['people.students.uidReleased']
  | ['people.students.takenHereUnknown']
  | ['people.students.takenHere', { student: string }] {
  const { holderId } = taken;
  if (taken.merged === true && holderId !== null) {
    const kept = holderText(holderId);
    return kept === null
      ? ['people.students.uidMergedUnknown']
      : ['people.students.uidMerged', { student: kept }];
  }
  if (taken.released) {
    return ['people.students.uidReleased'];
  }
  if (holderId === null) {
    return ['people.students.takenElsewhere'];
  }
  const student = holderText(holderId);
  return student === null
    ? ['people.students.takenHereUnknown']
    : ['people.students.takenHere', { student }];
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
  /** Whether a holder of this branch is inactive or graduated, so it can be brought back. */
  holderRestorable?: (id: string) => boolean;
  /** Opens a student of this branch in the side panel. */
  onOpenHolder?: (id: string) => void;
  /** The phone typed first (`04`, Adding a relative): the holder of a phone, or none. */
  onPhoneMatch?: (phone: string) => Promise<RelativeHolder | null>;
  /** Closes the form of a student in the side panel without a change (task 2.7c-2b-2b). */
  onCancel?: () => void;
}

/** A holder found for a phone, with the phone it was found by. */
interface Match {
  phone: string;
  holder: RelativeHolder;
}

/**
 * The record of a student (`04`, Student record: the Personal, Contract and
 * Payment blocks; answers 17 to 23). The UID and the start date are typed
 * when the student is created; the UID has a correction of its own and the
 * start date is fixed (decided in the build of task 2.4a).
 */
export function StudentForm({
  student,
  label,
  holderText,
  onCreate,
  onEdit,
  holderRestorable,
  onOpenHolder,
  onPhoneMatch,
  onCancel,
}: StudentFormProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const creating = student === null;
  const [match, setMatch] = useState<Match | null>(null);
  // The classes a new student can join (task 3.1b): active, in an open year.
  const classes = useQuery({ ...classesQuery(branchId), enabled: branchId !== null && creating });
  const years = useQuery({ ...yearsQuery(branchId), enabled: branchId !== null && creating });
  /** The typed phone of the relative in its stored form, or null. */
  const storedPhone = (typed: string): string | null => {
    const parsed = relativePhoneSchema.safeParse(typed);
    return parsed.success ? parsed.data : null;
  };
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
      classId: '',
      documentType: student?.identity?.documentType ?? '',
      documentNumber: student?.identity?.documentNumber ?? '',
      jshshir: student?.identity?.jshshir ?? '',
      phone:
        student?.contact?.phone === null || student?.contact?.phone === undefined
          ? `${DEFAULT_PHONE_PREFIX} `
          : phoneText(student.contact.phone),
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
      relativePhone: `${DEFAULT_PHONE_PREFIX} `,
      relativeNoPhone: '',
      relativeName: '',
      relativeRelationship: '',
      relativeWorkplace: '',
      relativeEmail: '',
      relativePortal: CHECKED,
      relativeNotices: CHECKED,
      relativeOwner: SAME_PERSON,
      relativePreviousPhone: `${DEFAULT_PHONE_PREFIX} `,
      relativePreviousUnknown: '',
      ...extraPhonesInitial(RELATIVE_EXTRA_FIELDS, []),
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
      if (!creating) {
        return record;
      }
      // The relative found by the phone is linked; otherwise a new one is
      // created (`04`, Adding a relative). The only relative is the main contact.
      const noPhone = typed.relativeNoPhone === CHECKED;
      const phoneNow = noPhone ? null : storedPhone(typed.relativePhone);
      const link = {
        relationship: typed.relativeRelationship,
        mainContact: true,
        portalAccess: typed.relativePortal === CHECKED,
        receivesNotices: typed.relativeNotices === CHECKED,
      };
      const matched =
        match !== null && phoneNow === match.phone && match.holder.id !== null ? match : null;
      const relative =
        matched !== null && matched.holder.id !== null && typed.relativeOwner === NEW_OWNER
          ? {
              // "Different person, the number has a new owner" (task 2.5b-1).
              kind: 'new_owner',
              relative: {
                fullName: typed.relativeName,
                phone: typed.relativePhone,
                workplace: typed.relativeWorkplace,
                email: typed.relativeEmail,
                extraPhones: extraPhonesTyped(RELATIVE_EXTRA_FIELDS, typed),
              },
              previousId: matched.holder.id,
              previousPhone:
                typed.relativePreviousUnknown === CHECKED ? null : typed.relativePreviousPhone,
              ...link,
            }
          : matched !== null && matched.holder.id !== null
            ? { kind: 'existing', relativeId: matched.holder.id, phone: matched.phone, ...link }
            : {
                kind: 'new',
                relative: {
                  fullName: typed.relativeName,
                  phone: noPhone ? null : typed.relativePhone,
                  workplace: typed.relativeWorkplace,
                  email: typed.relativeEmail,
                  extraPhones: extraPhonesTyped(RELATIVE_EXTRA_FIELDS, typed),
                },
                ...link,
              };
      return {
        ...record,
        uid: typed.uid,
        startsOn: typed.startsOn,
        classId: orNull(typed.classId),
        confirmUidSet: false,
        relatives: [relative],
      };
    },
    save: async (values) => {
      if ('uid' in values) {
        try {
          await onCreate?.(values);
        } catch (error) {
          // A phone held by a relative who may be linked: that person is
          // offered, and the next save links them (`04`, Adding a relative).
          const holder = phoneHolderOf(error);
          const sent = values.relatives[0];
          if (
            holder !== null &&
            holder.id !== null &&
            sent?.kind === 'new' &&
            sent.relative.phone !== null
          ) {
            setMatch({
              phone: sent.relative.phone,
              holder: { id: holder.id, fullName: holder.fullName, students: holder.students },
            });
          }
          throw error;
        }
      } else {
        await onEdit?.(values);
      }
    },
  });

  const taken = takenOf(form.failure);
  const refusal = taken === null ? null : t(...takenText(taken, holderText));
  // edge: "A matching JSHSHIR or document number blocks the save and offers
  // \"restore this student\"": for an inactive or graduated holder of the
  // branch (task 2.4b-1, decision 11).
  const restorable =
    taken !== null &&
    (taken.field === 'jshshir' || taken.field === 'documentNumber') &&
    taken.holderId !== null &&
    onOpenHolder !== undefined &&
    holderRestorable?.(taken.holderId) === true
      ? taken.holderId
      : null;
  const bind = (field: StudentField) => {
    const bound = form.bind(field);
    return {
      ...bound,
      error: bound.error ?? (taken?.field === field ? (refusal ?? undefined) : undefined),
    };
  };
  const option = (value: string, text: string) => ({ value, label: text });
  // The classes a new student can join (task 3.1b, decision 2): active, of
  // the grade chosen, in the year that holds the start date.
  const startsOn = form.bind('startsOn').value;
  const startYear = years.data?.years.find(
    (year) => year.startDate <= startsOn && startsOn <= year.endDate,
  );
  const offeredClasses = (classes.data?.classes ?? []).filter(
    (one) =>
      !one.archived &&
      one.yearStatus !== 'closed' &&
      String(one.grade) === form.bind('grade').value &&
      one.academicYearId === startYear?.id,
  );
  // A choice no longer offered (another grade or start date) falls back to
  // none, so what the field shows is what is sent (.claude/rules/web.md).
  const { value: chosenClass, onChange: chooseClass } = form.bind('classId');
  const classOffered = chosenClass === '' || offeredClasses.some((one) => one.id === chosenClass);
  useEffect(() => {
    if (!classOffered) {
      chooseClass({ target: { value: '' } });
    }
  }, [classOffered, chooseClass]);
  const scholarshipType = form.bind('scholarshipType').value;
  const coverage = form.bind('scholarshipCoverage').value;

  return (
    <>
      <RecordForm form={form} label={label} onCancel={onCancel}>
        {creating && (
          <Field label={t('people.students.uid')} inputMode="numeric" {...bind('uid')} />
        )}
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
        {creating &&
          (classes.isError || years.isError ? (
            <ErrorState
              error={classes.error ?? years.error}
              onRetry={() => {
                void classes.refetch();
                void years.refetch();
              }}
            />
          ) : (
            // Required when the start date is today or earlier; the server says so
            // (`student_needs_class`).
            <SelectField
              label={t('people.students.class')}
              options={[
                option('', t('people.students.noClassYet')),
                ...offeredClasses.map((one) =>
                  option(
                    one.id,
                    t('classes.classYear', {
                      class: classDisplayName(one.grade, one.name),
                      year: one.yearName,
                    }),
                  ),
                ),
              ]}
              {...bind('classId')}
            />
          ))}
        {/* Task 3.2c: the subject of the class without a group with a free seat. */}
        {creating && <GroupSeatRefusal error={form.failure} />}
        <SelectField
          label={t('people.students.documentType')}
          options={[
            option('', t('people.students.notSet')),
            ...DOCUMENT_TYPES.map((type) =>
              option(type, t(`people.students.documentTypes.${type}`)),
            ),
          ]}
          {...bind('documentType')}
        />
        <Field
          label={t('people.students.documentNumber')}
          autoComplete="off"
          {...bind('documentNumber')}
        />
        <Field label={t('people.students.jshshir')} inputMode="numeric" {...bind('jshshir')} />
        <Field
          label={t('people.students.phone')}
          type="tel"
          autoComplete="off"
          {...bind('phone')}
        />
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
        {creating && (
          <RelativeStep
            bind={bind}
            found={(() => {
              const typedPhone = form.bind('relativePhone').value;
              const noPhone = form.bind('relativeNoPhone').value === CHECKED;
              return !noPhone && match !== null && storedPhone(typedPhone) === match.phone
                ? match.holder
                : null;
            })()}
            onPhoneDone={(typed) => {
              const phone = storedPhone(typed);
              if (phone === null || onPhoneMatch === undefined || phone === match?.phone) {
                return;
              }
              void onPhoneMatch(phone)
                .then((holder) => {
                  setMatch(holder === null || holder.id === null ? null : { phone, holder });
                })
                .catch(() => {
                  // No match is shown; the save answers a held phone with its holder.
                  setMatch(null);
                });
            }}
          />
        )}
      </RecordForm>
      {restorable !== null && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenHolder?.(restorable);
            }}
          >
            {t('people.students.restoreThis')}
          </Button>
        </div>
      )}
    </>
  );
}

type Bind = (field: StudentField) => {
  name: string;
  value: string;
  error: string | undefined;
  onChange: (event: { target: { value: string } }) => void;
};

/**
 * The relative of a new student (`04`, Close relatives: "A student cannot be
 * saved without at least one relative"; "The phone is typed first. If a
 * relative with that phone already exists, the system shows the person and
 * links them to the student"; task 2.5a). The only relative is the main
 * contact; more are added on the Relatives tab.
 */
function RelativeStep({
  bind,
  found,
  onPhoneDone,
}: {
  bind: Bind;
  found: RelativeHolder | null;
  onPhoneDone: (typed: string) => void;
}) {
  const { t } = useTranslation();
  const noPhone = bind('relativeNoPhone').value === CHECKED;
  const phone = bind('relativePhone');
  const option = (value: string, text: string) => ({ value, label: text });
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-2 text-base font-semibold">{t('people.relatives.stepTitle')}</legend>
      <CheckboxField
        label={t('people.relatives.noPhone')}
        {...bind('relativeNoPhone')}
        note={noPhone ? t('people.relatives.noPhoneMain') : undefined}
      />
      {!noPhone && (
        <Field
          label={t('people.relatives.phone')}
          type="tel"
          autoComplete="off"
          {...phone}
          note={smsWarning(phone.value) ? t('people.relatives.noSms') : undefined}
          onBlur={() => {
            onPhoneDone(phone.value);
          }}
        />
      )}
      {found !== null && (
        <OwnerChoice
          found={found}
          owner={bind('relativeOwner')}
          previousPhone={bind('relativePreviousPhone')}
          previousUnknown={bind('relativePreviousUnknown')}
        />
      )}
      {(found === null || bind('relativeOwner').value === NEW_OWNER) && (
        <>
          <Field
            label={t('people.relatives.fullNameField')}
            autoComplete="off"
            {...bind('relativeName')}
          />
          <ExtraPhonesField
            count={bind(RELATIVE_EXTRA_FIELDS.count)}
            phones={RELATIVE_EXTRA_FIELDS.phones.map((field) => bind(field))}
          />
          <Field
            label={t('people.relatives.workplace')}
            autoComplete="off"
            {...bind('relativeWorkplace')}
          />
          <Field
            label={t('people.relatives.email')}
            type="email"
            autoComplete="off"
            {...bind('relativeEmail')}
          />
        </>
      )}
      <SelectField
        label={t('people.relatives.relationship')}
        options={[
          option('', t('people.relatives.choose')),
          ...RELATIONSHIPS.map((one) => option(one, t(`people.relatives.relationships.${one}`))),
        ]}
        {...bind('relativeRelationship')}
      />
      <CheckboxField label={t('people.relatives.portalAccess')} {...bind('relativePortal')} />
      <NoticesField
        label={t('people.relatives.receivesNotices')}
        hasPhone={!noPhone}
        {...bind('relativeNotices')}
      />
    </fieldset>
  );
}
