import {
  attendanceValuesRecordSchema,
  EARLY_WARNING_BOUNDS,
  earlyWarningRecordSchema,
  EDIT_DAYS_MAX,
  EDIT_DAYS_MIN,
  editDaysRecordSchema,
  INSTRUCTION_LANGUAGES,
  PERMISSIONS,
  permits,
  type AttendanceValuesRecord,
  type BranchSettings,
  type EarlyWarningRecord,
  type EditDaysRecord,
  type QuarterAttendanceValues,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { NumberField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from './setup-api';
import { attendanceValuesQuery, invalidateSettings, settingsQuery } from './settings-api';
import { cn } from 'cn';
import { PANEL } from '@/components/ui/control';

/** The four grade bands of `03`, Grade bands, in the order the page lists them. */
const GRADE_BANDS = ['two', 'three', 'four', 'five'] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn(PANEL, 'grid max-w-prose gap-3')}>
      <h2 className="text-[1.0625rem]/6 font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** A value as the roles that only view the settings see it. */
function Values({ rows }: { rows: readonly [string, string][] }) {
  return (
    <dl className="grid gap-3">
      {rows.map(([term, value]) => (
        <div key={term} className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** `07`, Editing rules and locks: "the number is a setting of the Academic Vice Principal". */
function EditDaysSection({
  settings,
  canEdit,
  onSave,
}: {
  settings: BranchSettings;
  canEdit: boolean;
  onSave: (record: EditDaysRecord) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const form = useRecordForm({
    schema: editDaysRecordSchema,
    initial: { editDays: String(settings.editDays) },
    read: (typed) => ({ editDays: wholeNumber(typed.editDays) }),
    save: onSave,
  });
  return (
    <Section title={t('setup.settings.editDaysTitle')}>
      {canEdit ? (
        <RecordForm form={form} label={t('setup.settings.editDaysTitle')}>
          <NumberField
            label={t('setup.settings.editDays')}
            note={t('setup.settings.editDaysNote', {
              min: number.format(EDIT_DAYS_MIN),
              max: number.format(EDIT_DAYS_MAX),
            })}
            {...form.bind('editDays')}
          />
        </RecordForm>
      ) : (
        <Values rows={[[t('setup.settings.editDays'), number.format(settings.editDays)]]} />
      )}
    </Section>
  );
}

const THRESHOLDS = ['lowResult', 'resultDrop', 'attendancePercent', 'absencesInRow'] as const;

/** `08`, Early-warning list: the four thresholds. */
function EarlyWarningSection({
  settings,
  canEdit,
  onSave,
}: {
  settings: BranchSettings;
  canEdit: boolean;
  onSave: (record: EarlyWarningRecord) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const form = useRecordForm({
    schema: earlyWarningRecordSchema,
    initial: {
      lowResult: String(settings.lowResult),
      resultDrop: String(settings.resultDrop),
      attendancePercent: String(settings.attendancePercent),
      absencesInRow: String(settings.absencesInRow),
    },
    read: (typed) => ({
      lowResult: wholeNumber(typed.lowResult),
      resultDrop: wholeNumber(typed.resultDrop),
      attendancePercent: wholeNumber(typed.attendancePercent),
      absencesInRow: wholeNumber(typed.absencesInRow),
    }),
    save: onSave,
  });
  return (
    <Section title={t('setup.settings.earlyWarningTitle')}>
      {canEdit ? (
        <RecordForm form={form} label={t('setup.settings.earlyWarningTitle')}>
          {THRESHOLDS.map((field) => (
            <NumberField
              key={field}
              label={t(`setup.settings.thresholds.${field}`)}
              note={t('setup.settings.rangeNote', {
                min: number.format(EARLY_WARNING_BOUNDS[field].min),
                max: number.format(EARLY_WARNING_BOUNDS[field].max),
              })}
              {...form.bind(field)}
            />
          ))}
        </RecordForm>
      ) : (
        <Values
          rows={THRESHOLDS.map((field) => [
            t(`setup.settings.thresholds.${field}`),
            number.format(settings[field]),
          ])}
        />
      )}
    </Section>
  );
}

/** One quarter's late and skipped values, edited in its own small form. */
function QuarterValuesForm({
  quarter,
  label,
}: {
  quarter: QuarterAttendanceValues;
  label: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (record: AttendanceValuesRecord) =>
      answerOf(
        api.PUT('/api/setup/quarters/{id}/attendance-values', {
          params: { header: branchHeader(), path: { id: quarter.id } },
          body: record,
        }),
      ),
    onSuccess: () => invalidateSettings(queryClient),
  });
  const form = useRecordForm({
    schema: attendanceValuesRecordSchema,
    initial: { lateValue: String(quarter.lateValue), skippedValue: String(quarter.skippedValue) },
    read: (typed) => ({
      lateValue: wholeNumber(typed.lateValue),
      skippedValue: wholeNumber(typed.skippedValue),
    }),
    save: async (record) => {
      await save.mutateAsync(record);
    },
  });
  return (
    <RecordForm form={form} label={label}>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label={t('setup.settings.lateValue')} {...form.bind('lateValue')} />
        <NumberField label={t('setup.settings.skippedValue')} {...form.bind('skippedValue')} />
      </div>
    </RecordForm>
  );
}

/**
 * Answer 20 and `edge/calculation`: late and skipped of every quarter of the
 * planned and current years. A closed year is not listed: its values stay as
 * it was closed with.
 */
function AttendanceValuesSection({ branchId, canEdit }: { branchId: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const list = useQuery(attendanceValuesQuery(branchId));
  const title = t('setup.settings.attendanceTitle');
  const dates = (quarter: QuarterAttendanceValues) =>
    quarter.startDate === null || quarter.endDate === null
      ? t('setup.settings.quarterNotDated')
      : `${schoolDateText(quarter.startDate, i18n.language)} – ${schoolDateText(quarter.endDate, i18n.language)}`;

  let body;
  if (list.isError) {
    body = (
      <ErrorState
        error={list.error}
        onRetry={() => {
          void list.refetch();
        }}
      />
    );
  } else if (list.data === undefined) {
    body = <LoadingOutline lines={3} />;
  } else if (list.data.years.length === 0) {
    body = <EmptyState text={t('setup.settings.attendanceNoYear')} />;
  } else {
    body = list.data.years.map((year) => (
      <div key={year.id} className="grid gap-3">
        <h3 className="text-base font-semibold">{year.name}</h3>
        {canEdit ? (
          year.quarters.map((quarter) => {
            const label = t('setup.settings.quarter', { number: quarter.number });
            return (
              <div key={quarter.id} className="grid gap-2 rounded-lg border p-3">
                <div className="text-sm">
                  <span className="font-medium">{label}</span>{' '}
                  <span className="text-muted-foreground">{dates(quarter)}</span>
                </div>
                <QuarterValuesForm
                  quarter={quarter}
                  label={t('setup.settings.quarterOfYear', {
                    year: year.name,
                    number: quarter.number,
                  })}
                />
              </div>
            );
          })
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('setup.settings.quarterColumn')}</TableHead>
                <TableHead>{t('setup.settings.lateValue')}</TableHead>
                <TableHead>{t('setup.settings.skippedValue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {year.quarters.map((quarter) => (
                <TableRow key={quarter.id}>
                  <TableCell>{t('setup.settings.quarter', { number: quarter.number })}</TableCell>
                  <TableCell>{number.format(quarter.lateValue)}</TableCell>
                  <TableCell>{number.format(quarter.skippedValue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    ));
  }
  return <Section title={title}>{body}</Section>;
}

/** Answer 22: the languages of instruction and the grade bands, read only. */
function FixedSections() {
  const { t } = useTranslation();
  return (
    <>
      <Section title={t('setup.settings.languagesTitle')}>
        <ul className="list-disc pl-5">
          {INSTRUCTION_LANGUAGES.map((language) => (
            <li key={language}>{t(`setup.settings.languages.${language}`)}</li>
          ))}
        </ul>
      </Section>
      <Section title={t('setup.settings.gradeBandsTitle')}>
        <Table aria-label={t('setup.settings.gradeBandsTitle')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('setup.settings.bandScore')}</TableHead>
              <TableHead>{t('setup.settings.bandGrade')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {GRADE_BANDS.map((band) => (
              <TableRow key={band}>
                <TableCell>{t(`setup.settings.gradeBands.${band}.scores`)}</TableCell>
                <TableCell>{t(`setup.settings.gradeBands.${band}.grade`)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}

/**
 * The settings of the branch in use (task 1.6): edit days, early-warning
 * thresholds, late and skipped per quarter, edited by the Super Admin and the
 * Academic Vice Principal and read by the Principal (answer 24); the
 * languages of instruction and the grade bands, fixed (answer 22).
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const canEdit = role !== null && permits(PERMISSIONS, role, 'settings', 'edit');
  const settings = useQuery(settingsQuery(branchId));

  const saved = async (answer: BranchSettings) => {
    queryClient.setQueryData(settingsQuery(branchId).queryKey, answer);
    await invalidateSettings(queryClient);
  };
  const saveEditDays = useMutation({
    mutationFn: (record: EditDaysRecord) =>
      answerOf(
        api.PUT('/api/setup/settings/edit-days', {
          params: { header: branchHeader() },
          body: record,
        }),
      ),
    onSuccess: saved,
  });
  const saveEarlyWarning = useMutation({
    mutationFn: (record: EarlyWarningRecord) =>
      answerOf(
        api.PUT('/api/setup/settings/early-warning', {
          params: { header: branchHeader() },
          body: record,
        }),
      ),
    onSuccess: saved,
  });

  let body;
  if (branchId === null) {
    body = <EmptyState text={t('setup.settings.none')} />;
  } else if (settings.data !== undefined) {
    body = (
      <>
        <EditDaysSection
          key={`edit-days-${branchId}`}
          settings={settings.data}
          canEdit={canEdit}
          onSave={async (record) => {
            await saveEditDays.mutateAsync(record);
          }}
        />
        <EarlyWarningSection
          key={`early-warning-${branchId}`}
          settings={settings.data}
          canEdit={canEdit}
          onSave={async (record) => {
            await saveEarlyWarning.mutateAsync(record);
          }}
        />
        <AttendanceValuesSection key={branchId} branchId={branchId} canEdit={canEdit} />
        <FixedSections />
      </>
    );
  } else if (settings.isError) {
    body = (
      <ErrorState
        error={settings.error}
        onRetry={() => {
          void settings.refetch();
        }}
      />
    );
  } else {
    body = <LoadingOutline lines={5} />;
  }

  return (
    <>
      <PageHeader
        title={t('setup.settings.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
      />
      <div className="grid max-w-3xl gap-8">{body}</div>
    </>
  );
}
