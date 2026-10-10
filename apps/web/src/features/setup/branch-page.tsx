import {
  branchRecordSchema,
  DEFAULT_WORKING_WEEKDAYS,
  PERMISSIONS,
  permits,
  WEEKDAYS,
  type Branch,
  type BranchRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { CheckboxGroupField, Field, listValue, listValues } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { refreshSession } from '@/features/auth/session';
import { branchQuery, SETUP_KEY, weekdayName } from './setup-api';

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
      phone: branch?.phone ?? '',
      email: branch?.email ?? '',
      workingWeekdays: listValue(
        (branch?.workingWeekdays ?? DEFAULT_WORKING_WEEKDAYS).map((day) => String(day)),
      ),
    },
    read: (typed) => ({
      ...typed,
      workingWeekdays: listValues(typed.workingWeekdays).map((day) => Number(day)),
    }),
    save: onSave,
  });

  return (
    <RecordForm form={form} label={label}>
      <Field label={t('setup.branch.name')} autoComplete="off" {...form.bind('name')} />
      <Field label={t('setup.branch.address')} autoComplete="off" {...form.bind('address')} />
      <Field
        label={t('setup.branch.phone')}
        type="tel"
        autoComplete="off"
        {...form.bind('phone')}
      />
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
    [t('setup.branch.phone'), branch.phone ?? none],
    [t('setup.branch.email'), branch.email ?? none],
    [
      t('setup.branch.workingWeekdays'),
      branch.workingWeekdays.map((day) => weekdayName(i18n.language, day)).join(', '),
    ],
    [t('setup.branch.timeZone'), branch.timeZone],
  ];
  return (
    <dl className="grid max-w-prose gap-3">
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
 * The branch page (task 1.1): the record of the branch in use, edited by the
 * Super Admin and read by the Principal and the Academic Vice Principal
 * (`02`). "New branch" (Super Admin only) opens the same form empty; once it
 * is saved the branch switcher shows the branch and this tab switches to it.
 */
export function BranchPage() {
  const { t } = useTranslation();
  const { role, branchId, chooseBranch } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const canEdit = role !== null && permits(PERMISSIONS, role, 'branches', 'edit');
  const canCreate = role !== null && permits(PERMISSIONS, role, 'branches', 'create');
  const branch = useQuery(branchQuery(branchId));

  const save = useMutation({
    mutationFn: (record: BranchRecord) =>
      answerOf(api.PUT('/api/setup/branch', { params: { header: branchHeader() }, body: record })),
    onSuccess: async (saved) => {
      queryClient.setQueryData(branchQuery(branchId).queryKey, saved);
      // The switcher shows the names: a renamed branch is renamed there too.
      await refreshSession(queryClient);
    },
  });

  const create = useMutation({
    mutationFn: (record: BranchRecord) =>
      answerOf(api.POST('/api/setup/branches', { body: record })),
    onSuccess: async (created) => {
      await refreshSession(queryClient);
      await queryClient.invalidateQueries({ queryKey: SETUP_KEY });
      chooseBranch(created.id);
      setAdding(false);
    },
  });

  let body;
  if (branchId === null) {
    body = <EmptyState text={t('setup.branch.none')} />;
  } else if (branch.data !== undefined) {
    body = canEdit ? (
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
        ]}
        actions={
          canCreate && !adding ? (
            <Button
              variant="outline"
              onClick={() => {
                setAdding(true);
              }}
            >
              {t('setup.branch.newBranch')}
            </Button>
          ) : undefined
        }
      />
      <div className="grid max-w-3xl gap-8">
        {adding && (
          <section
            aria-label={t('setup.branch.newBranchTitle')}
            className="grid gap-3 rounded-lg border p-4"
          >
            <h2 className="text-lg font-semibold">{t('setup.branch.newBranchTitle')}</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t('setup.branch.newBranchText')}
            </p>
            <BranchForm
              branch={null}
              label={t('setup.branch.newBranchTitle')}
              onSave={async (record) => {
                await create.mutateAsync(record);
              }}
            />
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  void leave.leave().then((leaves) => {
                    if (leaves) {
                      setAdding(false);
                    }
                  });
                }}
              >
                {t('setup.branch.cancel')}
              </Button>
            </div>
          </section>
        )}
        {body}
      </div>
    </>
  );
}
