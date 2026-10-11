import {
  academicYearRecordSchema,
  QUARTER_FORM_FIELDS,
  QUARTER_NUMBERS,
  quartersFormSchema,
  quartersOfForm,
  type AcademicYear,
  type AcademicYearRecord,
  type QuarterFormField,
  type QuartersForm,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField } from '@/components/field';
import type { FormIssue } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { invalidateYears, monthsText, schoolDateText } from './setup-api';

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
}

/** The two dates of a year (`03`, Academic year: "Start and end date"); the name follows from them. */
export function YearForm({ year, label, onSave }: YearFormProps) {
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
    <RecordForm form={form} label={label}>
      <DateField label={t('setup.years.startDate')} {...form.bind('startDate')} />
      <DateField label={t('setup.years.endDate')} {...form.bind('endDate')} />
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
}: {
  year: AcademicYear;
  onSave: (form: QuartersForm) => Promise<void>;
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
    <RecordForm form={form} label={t('setup.years.quartersTitle')}>
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

  const saveQuarters = useMutation({
    mutationFn: (form: QuartersForm) =>
      answerOf(
        api.PUT('/api/setup/academic-years/{id}/quarters', {
          params: { path: { id: year.id }, header: branchHeader() },
          body: quartersOfForm(form),
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
        <h3 className="text-base font-semibold">{t('setup.years.datesTitle')}</h3>
        {canEditYear && !closed ? (
          <YearForm
            key={`${year.startDate}-${year.endDate}`}
            year={year}
            label={year.name}
            onSave={async (record) => {
              await edit.mutateAsync(record);
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
          </dl>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          {t('setup.years.status')}: {statusText}
        </span>
        {canEditYear && year.status === 'planned' && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={startBlocked !== null || start.isPending}
              onClick={() => {
                void askStart();
              }}
            >
              {t('setup.years.start')}
            </Button>
            {startBlocked !== null && (
              <span className="text-sm text-muted-foreground">{startBlocked}</span>
            )}
          </>
        )}
      </div>
      <FailureAlert error={start.error} />

      <section className="grid gap-3">
        <h3 className="text-base font-semibold">{t('setup.years.quartersTitle')}</h3>
        {canEditQuarters && !closed ? (
          <QuartersFormView
            key={year.quarters
              .map((quarter) => `${quarter.startDate ?? ''}${quarter.endDate ?? ''}`)
              .join('|')}
            year={year}
            onSave={async (form) => {
              await saveQuarters.mutateAsync(form);
            }}
          />
        ) : (
          <QuartersTable year={year} />
        )}
      </section>
    </div>
  );
}
