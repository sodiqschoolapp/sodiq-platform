import type { Plan, PlanRow } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { PlanRowPanel } from './plan-row-panel';
import { ExtendWindow, RequestsSection, WindowLine } from './plan-requests';
import { MasterMark } from './plan-master-updated';
import { SharedWith, SharingActions } from './plan-sharing';
import { planQuery } from './plans-api';
import type { PlanSearch } from './plans-search';

/** "Mon 9 Nov · slot 1": a row's date and lesson slot. */
export function rowDateText(
  row: Pick<PlanRow, 'date' | 'slot'>,
  language: string,
  slotText: (slot: number) => string,
): string {
  const date = schoolDateText(row.date, language, false);
  return row.slot === null ? date : `${date} · ${slotText(row.slot)}`;
}

/**
 * The plan of a journal for a quarter (task 7.1a, pull request #212; `09`,
 * What a plan contains: "The form shows one row for every dated lesson of the
 * quarter, with number and date already filled; the teacher fills in the
 * rest"). The rows come from the server; the owner fills a row in its side
 * panel, every other reader reads it there.
 */
export function PlanPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { journalId } = useParams({ from: '/app/plans/$journalId' });
  const search: PlanSearch = useSearch({ from: '/app/plans/$journalId' });
  const { branchId } = useView();
  const plan = useQuery(planQuery(branchId, journalId, search.quarter ?? null));
  const language = i18n.language;
  const data = plan.data;

  const slotText = useMemo(() => (slot: number) => t('plans.plan.slot', { number: slot }), [t]);

  const columns = useMemo(
    (): Column<PlanRow>[] => [
      {
        key: 'number',
        header: t('plans.plan.number'),
        cell: (row) => row.number,
        sortValue: (row) => row.number,
        fixed: true,
      },
      {
        key: 'date',
        header: t('plans.plan.date'),
        cell: (row) => rowDateText(row, language, slotText),
        sortValue: (row) => row.number,
        opens: true,
      },
      {
        key: 'topic',
        header: t('plans.plan.topic'),
        cell: (row) =>
          row.item === null ? (
            <span className="text-muted-foreground">{t('plans.plan.emptyRow')}</span>
          ) : row.item.editedAfterLesson ? (
            // Task 7.2 (`09`: "it carries an \"edited after the lesson\" mark").
            <span className="grid">
              <span>{row.item.topic}</span>
              <span className="text-xs text-muted-foreground">
                {t('plans.plan.editedAfterLesson')}
              </span>
            </span>
          ) : row.item.movedFrom === null ? (
            row.item.topic
          ) : (
            // Task 7.1b (edge/lesson-plans: 'with a "moved from [date]" mark').
            <span className="grid">
              <span>{row.item.topic}</span>
              <span className="text-xs text-muted-foreground">
                {t('plans.plan.movedFrom', {
                  date: schoolDateText(row.item.movedFrom, language, false),
                })}
              </span>
            </span>
          ),
        searchText: (row) => row.item?.topic ?? '',
      },
      {
        key: 'classworks',
        header: t('plans.plan.classworks'),
        cell: (row) => (row.item?.classworks ?? []).map((one) => one.title).join(', '),
      },
      {
        key: 'homeworks',
        header: t('plans.plan.homeworks'),
        cell: (row) => (row.item?.homeworks ?? []).map((one) => one.title).join(', '),
      },
      {
        key: 'files',
        header: t('plans.plan.files'),
        cell: (row) => {
          const count = row.item?.files.length ?? 0;
          return count === 0 ? '' : String(count);
        },
      },
    ],
    [t, language, slotText],
  );

  const go = (next: PlanSearch, how: 'push' | 'replace' = 'push'): void => {
    void navigate({
      to: '/plans/$journalId',
      params: { journalId },
      search: next,
      replace: how === 'replace',
    });
  };

  const title =
    data === undefined
      ? t('plans.plan.title')
      : `${data.unit.name} · ${nameOf(data.subject.names, language)}`;
  const empty = data?.rows.filter((row) => row.item === null).length ?? 0;

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('plans.page.title'), to: '/plans' },
        ]}
      />
      {plan.isError ? (
        <ErrorState
          error={plan.error}
          onRetry={() => {
            void plan.refetch();
          }}
        />
      ) : data === undefined ? (
        <LoadingOutline />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <Segmented
              label={t('plans.plan.quarter')}
              options={data.quarters.map((quarter) => ({
                value: quarter.id,
                label: t('plans.page.quarter', { number: quarter.number }),
              }))}
              value={data.quarterId}
              onChange={(value) => {
                go({ quarter: value });
              }}
            />
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-1">
                <dt className="text-muted-foreground">{t('plans.plan.owner')}</dt>
                <dd>{data.owner ?? t('plans.plan.noOwner')}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-muted-foreground">{t('plans.plan.withoutTopic')}</dt>
                <dd>{empty}</dd>
              </div>
              {data.closed && <dd>{t('plans.plan.closed')}</dd>}
              <WindowLine plan={data} />
            </dl>
            <SharingActions plan={data} />
            <ExtendWindow plan={data} />
          </div>
          <ListPage
            listId="plan-rows"
            caption={t('plans.plan.caption')}
            rows={data.rows}
            rowId={(row) => row.lessonId}
            rowName={(row) => t('plans.plan.rowName', { number: row.number })}
            columns={columns}
            search={search}
            onSearchChange={(next: ListSearch, how) => {
              go(
                { ...(search.quarter === undefined ? {} : { quarter: search.quarter }), ...next },
                how,
              );
            }}
            panel={(row) => <PlanRowPanel key={row.lessonId} plan={data} row={row} />}
            empty={{ title: t('plans.plan.emptyTitle'), text: t('plans.plan.empty') }}
          />
          <SharedWith plan={data} />
          <MasterMark plan={data} />
          <RequestsSection plan={data} />
          {data.notCovered.length > 0 && <NotCovered plan={data} />}
        </div>
      )}
    </>
  );
}

/**
 * The items past the last row, attached to no lesson (task 7.1b; `09`:
 * "Items that no longer fit in the quarter go to a 'not covered' list at the
 * end of the plan"; "'Not covered' items are never dropped silently").
 */
function NotCovered({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  return (
    <section className={`${PANEL} grid gap-2 p-4`} aria-labelledby="plan-not-covered">
      <h2 id="plan-not-covered" className={SECTION_TITLE}>
        {t('plans.plan.notCovered')}
      </h2>
      <ul className="grid gap-1">
        {plan.notCovered.map((item) => (
          <li key={item.id}>{item.topic}</li>
        ))}
      </ul>
    </section>
  );
}
