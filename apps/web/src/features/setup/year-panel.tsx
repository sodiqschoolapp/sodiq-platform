import {
  academicYearRecordSchema,
  classDisplayName,
  QUARTER_FORM_FIELDS,
  QUARTER_NUMBERS,
  quartersFormSchema,
  quartersOfForm,
  type AcademicYear,
  type AcademicYearRecord,
  type QuarterFormField,
  type QuartersForm,
  type TemplateDaysBody,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField } from '@/components/field';
import type { FormIssue } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { invalidateYears } from './setup-api';
import { QuarterRefusalLines, useQuartersPreview } from './quarters-preview';
import { monthsText, schoolDateText } from '@/lib/dates';
import { SECTION_TITLE } from '@/components/ui/control';

/**
 * The stays that stand in the days a change of the dates would cut off
 * (`year_cut_holds`, task 3.6b-2, L128): one line each, then "and N more".
 */
function CutHoldsList({ failure }: { failure: unknown }) {
  const { t, i18n } = useTranslation();
  if (!(failure instanceof ApiFailure) || failure.code !== 'year_cut_holds') {
    return null;
  }
  const details = failure.details ?? [];
  const more = details.find((one) => one.path === 'more')?.more ?? 0;
  return (
    <ul className="grid list-disc gap-1 pl-5 text-sm" aria-label={t('setup.years.cutHoldsList')}>
      {details.flatMap(({ path, stay }) =>
        stay === undefined
          ? []
          : [
              <li key={path}>
                {t('setup.years.cutHoldsLine', {
                  student: stay.studentName ?? t('setup.years.cutHoldsOtherBranch'),
                  unit:
                    stay.unit.grade === null
                      ? stay.unit.name
                      : classDisplayName(stay.unit.grade, stay.unit.name),
                  from: schoolDateText(stay.firstDay, i18n.language),
                  until: schoolDateText(stay.lastDay, i18n.language),
                })}
              </li>,
            ],
      )}
      {more > 0 && <li>{t('setup.years.cutHoldsMore', { count: more })}</li>}
    </ul>
  );
}

/** The reason a custom issue of a shared schema names (`params.reason`), if any. */
function reasonOf(issue: FormIssue): string | undefined {
  const params = (issue as { params?: { reason?: unknown } }).params;
  return typeof params?.reason === 'string' ? params.reason : undefined;
}

interface YearFormProps {
  /** The year as saved; `null` for a new year. */
  year: AcademicYear | null;
  label: string;
  onSave: (record: AcademicYearRecord) => Promise<void>;
  /** Closes the form (opened by Edit in the side panel). */
  onCancel?: () => void;
}

/** The two dates of a year (`03`, Academic year: "Start and end date"); the name follows from them. */
export function YearForm({ year, label, onSave, onCancel }: YearFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: academicYearRecordSchema,
    initial: { startDate: year?.startDate ?? '', endDate: year?.endDate ?? '' },
    save: onSave,
    message: (_field, issue) => {
      const reason = reasonOf(issue);
      if (reason === 'end_year') {
        return t('setup.years.endYear');
      }
      return reason === 'too_long' ? t('setup.years.tooLong') : undefined;
    },
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <DateField label={t('setup.years.startDate')} {...form.bind('startDate')} />
      <DateField label={t('setup.years.endDate')} {...form.bind('endDate')} />
      <CutHoldsList failure={form.failure} />
      <QuarterRefusalLines failure={form.failure} />
    </RecordForm>
  );
}

/** The fields the server named outside the year (`quarters.3.endDate` is `q4End`). */
function outsideFields(failure: unknown): Set<QuarterFormField> {
  const fields = new Set<QuarterFormField>();
  if (!(failure instanceof ApiFailure) || failure.code !== 'outside_year') {
    return fields;
  }
  for (const detail of failure.details ?? []) {
    const match = /^quarters\.(\d)\.(startDate|endDate)$/.exec(detail.path);
    if (match !== null) {
      const number = Number(match[1]) + 1;
      const field = QUARTER_FORM_FIELDS.find(
        (one) => one === `q${String(number)}${match[2] === 'startDate' ? 'Start' : 'End'}`,
      );
      if (field !== undefined) {
        fields.add(field);
      }
    }
  }
  return fields;
}

const startField = (number: number): QuarterFormField =>
  QUARTER_FORM_FIELDS[(number - 1) * 2] ?? 'q1Start';
const endField = (number: number): QuarterFormField =>
  QUARTER_FORM_FIELDS[(number - 1) * 2 + 1] ?? 'q1End';

/**
 * The four quarters of a year, dated in one save (`03`, Quarters, owner:
 * Academic Vice Principal). A quarter has both dates or neither; the months
 * it covers are shown beside it.
 */
function QuartersFormView({
  year,
  onSave,
  onCancel,
}: {
  year: AcademicYear;
  onSave: (form: QuartersForm) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const initial = Object.fromEntries(
    QUARTER_NUMBERS.flatMap((number) => {
      const quarter = year.quarters.find((one) => one.number === number);
      return [
        [startField(number), quarter?.startDate ?? ''],
        [endField(number), quarter?.endDate ?? ''],
      ];
    }),
  ) as Record<QuarterFormField, string>;
  const form = useRecordForm({
    schema: quartersFormSchema,
    initial,
    save: onSave,
    message: (_field, issue) => {
      const reason = reasonOf(issue);
      if (reason === 'order') {
        return t('setup.years.order');
      }
      return reason === 'end_before_start' ? t('setup.years.endBeforeStart') : undefined;
    },
  });
  const outside = outsideFields(form.failure);
  const bind = (field: QuarterFormField) => {
    const bound = form.bind(field);
    return {
      ...bound,
      error: bound.error ?? (outside.has(field) ? t('setup.years.outsideYear') : undefined),
    };
  };
  return (
    <RecordForm form={form} label={t('setup.years.quartersTitle')} onCancel={onCancel}>
      {QUARTER_NUMBERS.map((number) => {
        const quarter = year.quarters.find((one) => one.number === number);
        return (
          <fieldset key={number} className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-medium">
              {t('setup.years.quarter', { number })}
              {quarter?.startDate != null && quarter.endDate != null && (
                <span className="ml-2 font-normal text-muted-foreground">
                  {monthsText(quarter.startDate, quarter.endDate, i18n.language)}
                </span>
              )}
            </legend>
            <DateField
              label={t('setup.years.quarterStart', { number })}
              {...bind(startField(number))}
            />
            <DateField
              label={t('setup.years.quarterEnd', { number })}
              {...bind(endField(number))}
            />
          </fieldset>
        );
      })}
      <QuarterRefusalLines failure={form.failure} />
    </RecordForm>
  );
}

/** The quarters as the roles that only view them see them. */
function QuartersTable({ year }: { year: AcademicYear }) {
  const { t, i18n } = useTranslation();
  const date = (value: string | null) =>
    value === null ? t('setup.years.notDated') : schoolDateText(value, i18n.language);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('setup.years.quartersTitle')}</TableHead>
          <TableHead>{t('setup.years.startDate')}</TableHead>
          <TableHead>{t('setup.years.endDate')}</TableHead>
          <TableHead>{t('setup.years.months')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {year.quarters.map((quarter) => (
          <TableRow key={quarter.number}>
            <TableCell>{t('setup.years.quarter', { number: quarter.number })}</TableCell>
            <TableCell>{date(quarter.startDate)}</TableCell>
            <TableCell>{date(quarter.endDate)}</TableCell>
            <TableCell>
              {quarter.startDate !== null && quarter.endDate !== null
                ? monthsText(quarter.startDate, quarter.endDate, i18n.language)
                : ''}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface YearPanelProps {
  year: AcademicYear;
  /** Every year of the branch: "Start year" is switched off while another is current or an earlier one is open. */
  years: readonly AcademicYear[];
  /** The Super Admin: the dates and "Start year" (`academic_years` edit). */
  canEditYear: boolean;
  /** The Super Admin and the Academic Vice Principal (`quarters` edit). */
  canEditQuarters: boolean;
}

/**
 * A year in the side panel of the list: its dates, its status with "Start
 * year", and its four quarters. A closed year is read only.
 */
export function YearPanel({ year, years, canEditYear, canEditQuarters }: YearPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const refresh = () => invalidateYears(queryClient);
  const closed = year.status === 'closed';
  // One form open at a time: the dates or the quarters (task 2.7c-2b-1).
  const panel = usePanelEditing();

  const edit = useMutation({
    mutationFn: (record: AcademicYearRecord) =>
      answerOf(
        api.PUT('/api/setup/academic-years/{id}', {
          params: { path: { id: year.id }, header: branchHeader() },
          body: record,
        }),
      ),
    onSuccess: refresh,
  });

  const start = useMutation({
    mutationFn: () =>
      answerOf(
        api.POST('/api/setup/academic-years/{id}/start', {
          params: { path: { id: year.id }, header: branchHeader() },
        }),
      ),
    onSuccess: refresh,
  });

  // Task 5.6b-5b: the preview of what the new dates do to the published
  // timetable comes first; the save sends the choices made there.
  const preview = useQuartersPreview();
  const saveQuarters = useMutation({
    mutationFn: ({ form, days }: { form: QuartersForm; days: TemplateDaysBody }) =>
      answerOf(
        api.PUT('/api/setup/academic-years/{id}/quarters', {
          params: { path: { id: year.id }, header: branchHeader() },
          body: { ...quartersOfForm(form), days },
        }),
      ),
    onSuccess: refresh,
  });

  // `edge/academic-year`: "An action whose prerequisite is missing is switched
  // off and says what is missing."
  const startBlocked = years.some((other) => other.id !== year.id && other.status === 'current')
    ? t('setup.years.startBlockedCurrent')
    : years.some(
          (other) =>
            other.id !== year.id && other.startDate < year.startDate && other.status !== 'closed',
        )
      ? t('setup.years.startBlockedEarlier')
      : null;

  const askStart = async () => {
    if (
      await confirm({
        title: t('setup.years.startTitle', { name: year.name }),
        text: t('setup.years.startText'),
        names: [year.name],
        action: t('setup.years.start'),
      })
    ) {
      start.mutate();
    }
  };

  const statusText = t(`setup.years.${year.status}`);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h3 className={SECTION_TITLE}>{t('setup.years.datesTitle')}</h3>
        {canEditYear && !closed && panel.editing === 'record' ? (
          // The form takes the read view's place and its Save and Cancel are last.
          <YearForm
            year={year}
            label={year.name}
            onSave={async (record) => {
              await edit.mutateAsync(record);
              panel.stop({ saved: true, key: 'record' });
            }}
            onCancel={() => {
              panel.stop();
            }}
          />
        ) : (
          <dl className="grid gap-2 text-sm">
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">{t('setup.years.startDate')}</dt>
              <dd>{schoolDateText(year.startDate, i18n.language)}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">{t('setup.years.endDate')}</dt>
              <dd>{schoolDateText(year.endDate, i18n.language)}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">{t('setup.years.status')}</dt>
              <dd>{statusText}</dd>
            </div>
          </dl>
        )}
      </section>

      {panel.editing !== 'record' && (
        <section className="grid gap-3">
          <h3 className={SECTION_TITLE}>{t('setup.years.quartersTitle')}</h3>
          {canEditQuarters && !closed && panel.editing === 'quarters' ? (
            <QuartersFormView
              year={year}
              onSave={async (form) => {
                const days = await preview.confirm(year.id, quartersOfForm(form));
                await saveQuarters.mutateAsync({ form, days });
                panel.stop({ saved: true, key: 'quarters' });
              }}
              onCancel={() => {
                panel.stop();
              }}
            />
          ) : (
            <>
              <QuartersTable year={year} />
              {canEditQuarters && !closed && (
                <div>
                  <Button
                    variant="secondary"
                    {...panel.opener('quarters')}
                    onClick={() => {
                      panel.start('quarters');
                    }}
                  >
                    {t('setup.years.changeQuarters')}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {(canEditYear || canEditQuarters) && panel.editing === null && (
        <PanelActions
          primary={
            canEditYear &&
            !closed && (
              <Button
                {...panel.opener('record')}
                onClick={() => {
                  panel.start('record');
                }}
              >
                {t('form.edit')}
              </Button>
            )
          }
          secondary={
            canEditYear &&
            year.status === 'planned' && (
              <Button
                variant="secondary"
                disabled={startBlocked !== null || start.isPending}
                onClick={() => {
                  void askStart();
                }}
              >
                {t('setup.years.start')}
              </Button>
            )
          }
          // `edge/academic-year`: "An action whose prerequisite is missing is
          // switched off and says what is missing."
          note={canEditYear && year.status === 'planned' ? startBlocked : null}
          error={start.error}
          saved={panel.saved}
        />
      )}
      {preview.dialog}
    </div>
  );
}
