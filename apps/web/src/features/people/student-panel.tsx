import {
  studentDetailSchema,
  studentIdentitySchema,
  studentUidCorrectionSchema,
  type StudentDetail,
  type StudentIdentity,
  type StudentRecord,
  type StudentUidCorrection,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/features/setup/setup-api';
import { asFormSchema } from './form-schema';
import { invalidateStudents, studentDetailQuery } from './people-api';
import { StudentForm, takenOf } from './student-form';

type Tab = 'overview' | 'contract';

interface StudentPanelProps {
  id: string;
  name: string;
  /** The name and UID of a student of this branch, by id, for a refusal that names one. */
  holderText: (id: string) => string | null;
}

/**
 * A student in the side panel of the list (`04`, Student record, "Profile
 * tabs"; task 2.4a): the tabs that have data so far, Overview and Contract and
 * scholarship. Each group of fields is drawn only when the server answers it
 * (edge/people-roles-accounts, Personal data and the audit log); the Principal
 * sees the identity fields behind a logged show.
 */
export function StudentPanel({ id, name, holderText }: StudentPanelProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const detail = useQuery(studentDetailQuery(branchId, id));
  const [tab, setTab] = useState<Tab>('overview');
  const where = () => ({ header: branchHeader(), path: { id } });
  const refresh = async (answer: unknown) => {
    queryClient.setQueryData(
      studentDetailQuery(branchId, id).queryKey,
      studentDetailSchema.parse(answer),
    );
    await invalidateStudents(queryClient);
  };
  const edit = useMutation({
    mutationFn: (record: StudentRecord) =>
      answerOf(api.PUT('/api/people/students/{id}', { params: where(), body: record })),
    onSuccess: refresh,
  });
  const correct = useMutation({
    mutationFn: async (input: StudentUidCorrection) => {
      try {
        return await answerOf(
          api.PUT('/api/people/students/{id}/uid', { params: where(), body: input }),
        );
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.code !== 'uid_set_mismatch') {
          throw error;
        }
        const go = await confirm({
          title: t('people.students.setTitle'),
          text: t('people.students.setText'),
          names: [input.uid],
          action: t('people.students.saveAnyway'),
          destructive: false,
        });
        if (!go) {
          throw new SaveCancelled();
        }
        return answerOf(
          api.PUT('/api/people/students/{id}/uid', {
            params: where(),
            body: { ...input, confirmUidSet: true },
          }),
        );
      }
    },
    onSuccess: refresh,
  });

  if (detail.isError) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (detail.data === undefined) {
    return <LoadingOutline />;
  }
  const student = detail.data;
  const tabs: { key: Tab; title: string }[] = [
    { key: 'overview', title: t('people.students.tabs.overview') },
    ...(student.financial === null
      ? []
      : [{ key: 'contract' as const, title: t('people.students.tabs.contract') }]),
  ];
  const shownTab = tabs.some((one) => one.key === tab) ? tab : 'overview';

  return (
    <div className="grid gap-6">
      <div
        role="tablist"
        aria-label={t('people.students.tabs.label')}
        className="flex gap-6 border-b"
      >
        {tabs.map((one) => (
          <button
            key={one.key}
            type="button"
            role="tab"
            aria-selected={shownTab === one.key}
            className={
              shownTab === one.key
                ? 'border-b-2 border-foreground px-1 pb-2 font-semibold'
                : 'border-b-2 border-transparent px-1 pb-2 text-muted-foreground hover:text-foreground'
            }
            onClick={() => {
              setTab(one.key);
            }}
          >
            {one.title}
          </button>
        ))}
      </div>
      {shownTab === 'overview' ? <Overview student={student} /> : <ContractTab student={student} />}
      {student.canEdit && (
        <>
          <section className="grid gap-3">
            <h3 className="text-base font-semibold">{t('people.students.recordTitle')}</h3>
            <StudentForm
              key={`${student.id}-record`}
              student={student}
              label={name}
              holderText={holderText}
              onEdit={async (record) => {
                await edit.mutateAsync(record);
              }}
            />
          </section>
          <UidCorrection
            key={`${student.id}-${student.uid}`}
            student={student}
            label={name}
            holderText={holderText}
            onSave={async (input) => {
              await correct.mutateAsync(input);
            }}
          />
        </>
      )}
    </div>
  );
}

/** A list of terms and values. */
function Terms({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="grid gap-0.5">
          <dt className="text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Basic, Contact and Identity, as far as the reader may see them; Identity behind a show for the Principal. */
function Overview({ student }: { student: StudentDetail }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [shown, setShown] = useState<StudentIdentity | null>(null);
  const show = useMutation({
    mutationFn: async () =>
      studentIdentitySchema.parse(
        await answerOf(
          api.POST('/api/people/students/{id}/identity', {
            params: { header: branchHeader(), path: { id: student.id } },
          }),
        ),
      ),
    onSuccess: setShown,
  });
  const notSet = t('people.students.notSet');
  const identity = student.identity ?? shown;
  const rows: [string, string][] = [
    [t('people.students.uid'), student.uid],
    [t('people.students.class'), t('people.students.noClass')],
    [t('people.students.grade'), t('setup.subjects.grade', { grade: student.grade })],
    [t('people.students.sex'), t(`people.staff.sexes.${student.sex}`)],
    [t('people.students.startsOn'), schoolDateText(student.startsOn, language)],
    [
      t('people.students.status'),
      student.status === null
        ? t('people.students.notStarted')
        : t(`people.students.statuses.${student.status}`),
    ],
  ];
  if (student.contact !== null) {
    rows.push(
      [t('people.students.phone'), student.contact.phone ?? notSet],
      [t('people.students.email'), student.contact.email ?? notSet],
    );
  }
  if (identity !== null) {
    rows.push(
      [t('people.students.birthDate'), schoolDateText(identity.birthDate, language)],
      [
        t('people.students.document'),
        identity.documentType === null
          ? notSet
          : `${t(`people.students.documentTypes.${identity.documentType}`)} ${identity.documentNumber ?? ''}`,
      ],
      [t('people.students.jshshir'), identity.jshshir ?? notSet],
      [t('people.students.address'), identity.address ?? notSet],
      [
        t('people.students.region'),
        identity.region === null ? notSet : t(`people.students.regions.${identity.region}`),
      ],
    );
  } else if (student.identityHidden) {
    rows.push(
      [t('people.students.birthDate'), t('people.students.hidden')],
      [t('people.students.document'), t('people.students.hidden')],
    );
  }
  return (
    <section className="grid gap-3">
      <Terms rows={rows} />
      {student.identityHidden && shown === null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={show.isPending}
            onClick={() => {
              show.mutate();
            }}
          >
            {t('people.students.showIdentity')}
          </Button>
          <FailureAlert error={show.error} />
        </div>
      )}
    </section>
  );
}

/** The Financial group: contracts, scholarship, and the enrolment fields of decision 4. */
function ContractTab({ student }: { student: StudentDetail }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const financial = student.financial;
  if (financial === null) {
    return null;
  }
  const notSet = t('people.students.notSet');
  const { scholarship } = financial;
  const scholarshipText =
    scholarship.type === 'none'
      ? t('people.students.scholarshipTypes.none')
      : [
          t(`people.students.scholarshipTypes.${scholarship.type}`),
          scholarship.coverage === null
            ? ''
            : t(`people.students.scholarshipCoverages.${scholarship.coverage}`),
          scholarship.amount === null
            ? ''
            : t('people.students.amount', { amount: scholarship.amount }),
        ]
          .filter((part) => part !== '')
          .join(', ');
  return (
    <section className="grid gap-3">
      <Terms
        rows={[
          ...financial.contracts.map(
            (contract) =>
              [
                t('people.students.contract'),
                t('people.students.contractText', {
                  number: contract.number,
                  date: schoolDateText(contract.signedOn, language),
                }),
              ] as const,
          ),
          [t('people.students.scholarship'), scholarshipText],
          [t('people.students.previousSchool'), financial.previousSchool ?? notSet],
          [
            t('people.students.diagnosticScore'),
            financial.diagnosticScore === null ? notSet : String(financial.diagnosticScore),
          ],
          [
            t('people.students.consentSignedOn'),
            financial.consentSignedOn === null
              ? t('people.students.noConsent')
              : schoolDateText(financial.consentSignedOn, language),
          ],
        ]}
      />
    </section>
  );
}

type UidField = 'uid' | 'reason';

const UID_SCHEMA = asFormSchema<StudentUidCorrection>(studentUidCorrectionSchema, (path) => [
  ...path,
]);

/** The correction of a mistyped UID with a reason (edge/students-classes-groups). */
function UidCorrection({
  student,
  label,
  holderText,
  onSave,
}: {
  student: StudentDetail;
  label: string;
  holderText: (id: string) => string | null;
  onSave: (input: StudentUidCorrection) => Promise<void>;
}) {
  const { t } = useTranslation();
  const form = useRecordForm<UidField, StudentUidCorrection>({
    schema: UID_SCHEMA,
    initial: { uid: student.uid, reason: '' },
    read: (typed) => ({ uid: typed.uid, reason: typed.reason, confirmUidSet: false }),
    save: onSave,
  });
  const taken = takenOf(form.failure);
  const uid = form.bind('uid');
  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">{t('people.students.uidTitle')}</h3>
      <RecordForm form={form} label={t('people.students.uidLabel', { name: label })}>
        <Field
          label={t('people.students.uid')}
          inputMode="numeric"
          {...uid}
          error={
            uid.error ??
            (taken === null
              ? undefined
              : taken.holderId === null
                ? t('people.students.takenElsewhere')
                : t('people.students.takenHere', { student: holderText(taken.holderId) ?? '' }))
          }
        />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}
