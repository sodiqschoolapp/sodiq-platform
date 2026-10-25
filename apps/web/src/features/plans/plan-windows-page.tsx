import { planWindowSaveSchema, type PlanWindows, type PlanWindowSave } from '@sodiq/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import { PlanMinimumsSection } from './plan-minimums';
import { invalidatePlans, planWindowsQuery, savePlanWindow } from './plans-api';

/**
 * The plan windows of a year (task 7.2, pull request #215; `09`, The plan
 * window: "The Academic Vice Principal opens a window for a quarter: a start
 * date and an end date. It can be opened only when the timetable covering that
 * quarter is published"; `edge/lesson-plans`: "If it ends after the quarter's
 * first lesson, the system shows how many lessons will be held without a plan
 * and asks for confirmation"). Every reader of plans sees the windows; the
 * server answers whether the reader may open them.
 */
export function PlanWindowsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { branchId } = useView();
  const windows = useQuery(planWindowsQuery(branchId, null));
  const data = windows.data;
  return (
    <>
      <PageHeader
        title={t('plans.windows.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('plans.page.title'), to: '/plans' },
        ]}
      />
      {windows.isError ? (
        <ErrorState
          error={windows.error}
          onRetry={() => {
            void windows.refetch();
          }}
        />
      ) : data === undefined ? (
        <LoadingOutline />
      ) : data.quarters.length === 0 ? (
        <EmptyState title={t('plans.windows.emptyTitle')} text={t('plans.windows.empty')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.quarters.map((one) => (
            <QuarterWindow key={one.quarter.id} one={one} canEdit={data.canEdit} />
          ))}
        </div>
      )}
      {/* Task 8.8 (decision 11): the minimum works of each subject per quarter. */}
      <div className="mt-4">
        <PlanMinimumsSection />
      </div>
    </>
  );
}

function QuarterWindow({
  one,
  canEdit,
}: {
  one: PlanWindows['quarters'][number];
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const date = (value: string) => schoolDateText(value, i18n.language, false);
  const window = one.window;
  const form = useRecordForm<'startDate' | 'endDate', PlanWindowSave>({
    schema: planWindowSaveSchema,
    initial: {
      startDate: window?.startDate ?? one.quarter.startDate,
      endDate: window?.endDate ?? one.quarter.endDate,
    },
    read: (typed) => ({ startDate: typed.startDate, endDate: typed.endDate }),
    save: async (body) => {
      try {
        await savePlanWindow(one.quarter.id, body);
      } catch (error) {
        const count =
          error instanceof ApiFailure && error.code === 'plan_window_confirm'
            ? error.details?.[0]?.lessonsWithoutPlan
            : undefined;
        if (count === undefined) throw error;
        const sure = await confirm({
          title: t('plans.windows.confirmTitle'),
          text: t('plans.windows.confirmText', { count }),
          action: t('plans.windows.save'),
        });
        // A decline writes nothing: the form keeps the dates and says so.
        if (!sure) throw new SaveCancelled();
        await savePlanWindow(one.quarter.id, { ...body, confirm: true });
      }
      await invalidatePlans(queryClient);
    },
  });
  const titleId = `quarter-window-${one.quarter.id}`;
  return (
    <section
      className={`${PANEL} grid gap-3 p-4`}
      aria-labelledby={titleId}
      data-quarter={one.quarter.number}
    >
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('plans.page.quarter', { number: one.quarter.number })}
      </h2>
      <p className="text-sm text-muted-foreground">
        {date(one.quarter.startDate)} – {date(one.quarter.endDate)}
      </p>
      <p className="text-sm" data-window-state={window?.state ?? 'not_opened'}>
        {window === null
          ? one.published
            ? t('plans.window.state.not_opened')
            : t('plans.windows.unpublished')
          : t(`plans.window.state.${window.state}`, {
              start: date(window.startDate),
              end: date(window.endDate),
            })}
      </p>
      {window !== null && window.extensions.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {window.extensions.map((extension) => (
            <li key={extension.staffId}>
              {t('plans.windows.extension', {
                name: extension.name,
                date: date(extension.endDate),
              })}
            </li>
          ))}
        </ul>
      )}
      {canEdit && one.published && (
        // A record form (review of the code, round 1): typed dates are an unsent
        // entry, and leaving asks first.
        <RecordForm
          form={form}
          label={t('plans.windows.formTitle', { number: one.quarter.number })}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField label={t('plans.windows.start')} {...form.bind('startDate')} />
            <DateField label={t('plans.windows.end')} {...form.bind('endDate')} />
          </div>
        </RecordForm>
      )}
    </section>
  );
}
