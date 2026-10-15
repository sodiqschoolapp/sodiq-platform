import {
  DEFAULT_PHONE_PREFIX,
  phoneText,
  branchRecordSchema,
  goLiveRecordSchema,
  DEFAULT_WORKING_WEEKDAYS,
  PERMISSIONS,
  permits,
  WEEKDAYS,
  type Branch,
  type BranchRecord,
  type GoLiveRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import {
  CheckboxGroupField,
  DateField,
  Field,
  listValue,
  PhoneField,
  listValues,
} from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { buttonVariants } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { invalidateBranchesWithoutVice } from '@/features/access/vice-principal-banner';
import { refreshSession } from '@/features/auth/session';
import { branchQuery, invalidateYears, yearsQuery } from './setup-api';
import { cn } from 'cn';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { schoolDateText, weekdayName } from '@/lib/dates';

interface BranchFormProps {
  /** The record as saved; `null` for a new branch. */
  branch: Branch | null;
  label: string;
  onSave: (record: BranchRecord) => Promise<void>;
}

/**
 * The record of a branch (`03`, Branch: "Name, address, working weekdays,
 * contacts"), as the Super Admin types it. The weekdays are seven switches,
 * Monday first, named in the chosen language.
 */
export function BranchForm({ branch, label, onSave }: BranchFormProps) {
  const { t, i18n } = useTranslation();
  const form = useRecordForm({
    schema: branchRecordSchema,
    initial: {
      name: branch?.name ?? '',
      address: branch?.address ?? '',
      // "+998" and nine digits ("Decided ahead for tasks 2.2d and 2.7", item 10).
      phone:
        branch?.phone === null || branch?.phone === undefined
          ? `${DEFAULT_PHONE_PREFIX} `
          : phoneText(branch.phone),
      email: branch?.email ?? '',
      workingWeekdays: listValue(
        (branch?.workingWeekdays ?? DEFAULT_WORKING_WEEKDAYS).map((day) => String(day)),
      ),
    },
    read: (typed) => ({
      ...typed,
      // The country code alone is no phone, as on the student form.
      phone: typed.phone.trim() === DEFAULT_PHONE_PREFIX ? '' : typed.phone,
      workingWeekdays: listValues(typed.workingWeekdays).map((day) => Number(day)),
    }),
    save: onSave,
    // Finding 21: the weekdays say what is missing on Save, not as they are ticked.
    checkedOnSave: ['workingWeekdays'],
  });

  return (
    <RecordForm form={form} label={label}>
      <Field label={t('setup.branch.name')} autoComplete="off" {...form.bind('name')} />
      <Field label={t('setup.branch.address')} autoComplete="off" {...form.bind('address')} />
      <PhoneField label={t('setup.branch.phone')} uzbekOnly {...form.bind('phone')} />
      <Field
        label={t('setup.branch.email')}
        type="email"
        autoComplete="off"
        {...form.bind('email')}
      />
      <CheckboxGroupField
        label={t('setup.branch.workingWeekdays')}
        options={WEEKDAYS.map((day) => ({
          value: String(day),
          label: weekdayName(i18n.language, day),
        }))}
        {...form.bind('workingWeekdays')}
      />
    </RecordForm>
  );
}

/** The record as the roles that only view it see it. */
function BranchDetails({ branch }: { branch: Branch }) {
  const { t, i18n } = useTranslation();
  const none = t('setup.branch.notGiven');
  const rows: [string, string][] = [
    [t('setup.branch.name'), branch.name],
    [t('setup.branch.address'), branch.address ?? none],
    [t('setup.branch.phone'), branch.phone === null ? none : phoneText(branch.phone)],
    [t('setup.branch.email'), branch.email ?? none],
    [
      t('setup.branch.workingWeekdays'),
      branch.workingWeekdays.map((day) => weekdayName(i18n.language, day)).join(', '),
    ],
    [t('setup.branch.timeZone'), branch.timeZone],
  ];
  return (
    <dl className={cn(PANEL, 'grid max-w-prose gap-3')}>
      {rows.map(([term, value]) => (
        <div key={term} className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The go-live start date of the branch (`edge/academic-year`, "The school
 * goes live in the middle of the year": "The Super Admin sets a start date for
 * each branch"; owner's answer 7; task 1.3). The Super Admin sets it inside a
 * planned or current year; without one the form is not shown and one line
 * says what is missing (`edge/academic-year`: "An action whose prerequisite is
 * missing is switched off and says what is missing"). An empty field clears it.
 */
function GoLiveSection({ branch, canEdit }: { branch: Branch; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const years = useQuery({ ...yearsQuery(branch.id), enabled: canEdit });
  const save = useMutation({
    mutationFn: (record: GoLiveRecord) =>
      answerOf(
        api.PUT('/api/setup/branch/go-live', { params: { header: branchHeader() }, body: record }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(branchQuery(branch.id).queryKey, saved);
      await invalidateYears(queryClient);
    },
  });
  const form = useRecordForm({
    schema: goLiveRecordSchema,
    initial: { goLiveDate: branch.goLiveDate ?? '' },
    read: (typed) => ({ goLiveDate: typed.goLiveDate === '' ? null : typed.goLiveDate }),
    save: async (record) => {
      await save.mutateAsync(record);
    },
  });
  const hasYear = years.data?.years.some(
    (year) => year.status === 'planned' || year.status === 'current',
  );
  const shown =
    branch.goLiveDate === null
      ? t('setup.branch.goLiveNotSet')
      : schoolDateText(branch.goLiveDate, i18n.language);

  let body;
  if (!canEdit) {
    body = <p>{shown}</p>;
  } else if (hasYear === false) {
    // Every year is closed: a date already set can still be cleared (decision 6).
    body = (
      <>
        {branch.goLiveDate === null ? (
          <p>{shown}</p>
        ) : (
          <RecordForm form={form} label={t('setup.branch.goLiveTitle')}>
            <DateField label={t('setup.branch.goLiveDate')} {...form.bind('goLiveDate')} />
          </RecordForm>
        )}
        <p className="text-sm text-muted-foreground">{t('setup.branch.goLiveNoYear')}</p>
      </>
    );
  } else if (years.isError) {
    body = (
      <ErrorState
        error={years.error}
        onRetry={() => {
          void years.refetch();
        }}
      />
    );
  } else if (hasYear === true) {
    body = (
      <RecordForm form={form} label={t('setup.branch.goLiveTitle')}>
        <DateField label={t('setup.branch.goLiveDate')} {...form.bind('goLiveDate')} />
      </RecordForm>
    );
  } else {
    body = <LoadingOutline lines={1} />;
  }

  return (
    <section
      aria-label={t('setup.branch.goLiveTitle')}
      className={cn(PANEL, 'grid max-w-prose gap-3')}
    >
      <h2 className={SECTION_TITLE}>{t('setup.branch.goLiveTitle')}</h2>
      {body}
    </section>
  );
}

/**
 * The branch page (task 1.1): the record of the branch in use, edited by the
 * Super Admin and read by the Principal and the Academic Vice Principal
 * (`02`). "New branch" is on the Branches list (`03`, Branch; task 2.7c-3,
 * decision 7); with no branch chosen yet, the Super Admin is sent there.
 * Below the record, the go-live date (task 1.3).
 */
export function BranchPage() {
  const { t } = useTranslation();
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const canEdit = role !== null && permits(PERMISSIONS, role, 'branches', 'edit');
  const canList = role !== null && permits(PERMISSIONS, role, 'branches', 'create');
  const branch = useQuery(branchQuery(branchId));

  const save = useMutation({
    mutationFn: (record: BranchRecord) =>
      answerOf(api.PUT('/api/setup/branch', { params: { header: branchHeader() }, body: record })),
    onSuccess: async (saved) => {
      queryClient.setQueryData(branchQuery(branchId).queryKey, saved);
      // The switcher and the alert of a branch without an Academic Vice
      // Principal show the names: a renamed branch is renamed there too.
      await Promise.all([refreshSession(queryClient), invalidateBranchesWithoutVice(queryClient)]);
    },
  });

  let body;
  if (branchId === null) {
    body = (
      <EmptyState
        text={t('setup.branch.none')}
        action={
          canList ? (
            <Link to="/setup/branches" className={buttonVariants({ variant: 'secondary' })}>
              {t('setup.branch.goToList')}
            </Link>
          ) : undefined
        }
      />
    );
  } else if (branch.data !== undefined) {
    body = (
      <>
        {canEdit ? (
          <BranchForm
            key={branch.data.id}
            branch={branch.data}
            label={branch.data.name}
            onSave={async (record) => {
              await save.mutateAsync(record);
            }}
          />
        ) : (
          <BranchDetails branch={branch.data} />
        )}
        <GoLiveSection key={branch.data.id} branch={branch.data} canEdit={canEdit} />
      </>
    );
  } else if (branch.isError) {
    body = (
      <ErrorState
        error={branch.error}
        onRetry={() => {
          void branch.refetch();
        }}
      />
    );
  } else {
    body = <LoadingOutline lines={5} />;
  }

  return (
    <>
      <PageHeader
        title={t('setup.branch.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
          // The Super Admin comes here from the Branches list (decision 7).
          ...(canList
            ? [{ label: t('setup.branches.title'), to: '/setup/branches' } as const]
            : []),
        ]}
      />
      <div className="grid max-w-3xl min-w-0 gap-6">{body}</div>
    </>
  );
}
