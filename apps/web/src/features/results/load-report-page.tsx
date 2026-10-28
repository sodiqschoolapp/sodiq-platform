import type { LoadReport } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DateField, SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Segmented } from '@/components/ui/segmented';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import {
  clockText,
  DATE,
  ExcelButton,
  localDate,
  percentText,
  textOf,
  useDownload,
} from './report-parts';
import { exportLoadReport, loadReportQuery } from './reports-api';

const VIEWS = ['teachers', 'classes', 'rooms', 'freePeriods'] as const;

type View = (typeof VIEWS)[number];

export interface LoadReportSearch extends ListSearch {
  week?: string;
  department?: string;
  show?: Exclude<View, 'teachers'>;
}

export function loadReportSearch(search: Record<string, unknown>): LoadReportSearch {
  const result: LoadReportSearch = listSearch(search);
  const week = textOf(search.week);
  if (week !== undefined && DATE.test(week)) result.week = week;
  const department = textOf(search.department);
  if (department !== undefined) result.department = department;
  if (search.show === 'classes' || search.show === 'rooms' || search.show === 'freePeriods') {
    result.show = search.show;
  }
  return result;
}

/** One line of any of the four lists. */
interface Line {
  readonly id: string;
  readonly name: string;
  readonly cells: readonly (string | number | null)[];
}

/**
 * The timetable load report (task 9.3b-2; `06`, Views and outputs, "Load report"; `08`,
 * Analytics, Timetable load): the teachers against their planned load, the other branches and the
 * contract; the classes and groups against the load; the rooms in use; the free periods the rule
 * engine finds. The week defaults to this one.
 */
export function LoadReportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: LoadReportSearch = useSearch({ from: '/app/results/load' });
  const { branchId } = useView();
  const week = search.week ?? localDate(0, true);
  const report = useQuery(loadReportQuery(branchId, week, search.department));
  const download = useDownload(() => exportLoadReport(week, search.department));
  const view: View = search.show ?? 'teachers';
  const keep: LoadReportSearch = {
    ...(search.week === undefined ? {} : { week: search.week }),
    ...(search.department === undefined ? {} : { department: search.department }),
    ...(search.show === undefined ? {} : { show: search.show }),
  };
  const go = (next: LoadReportSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/results/load', search: next, replace: how === 'replace' });
  };
  const data: LoadReport | undefined = report.data;
  const k = useCallback(
    (key: string) => t(`results.reports.load.${key}` as 'results.reports.load.week'),
    [t],
  );
  const shape = useMemo((): { headers: string[]; lines: Line[] | undefined } => {
    if (view === 'teachers') {
      return {
        headers: [
          'teacher',
          'lessons',
          'planned',
          'elsewhere',
          'total',
          'contract',
          'againstContract',
          'invigilations',
        ],
        lines: data?.teachers.map((one) => ({
          id: one.teacher.id,
          name: one.vacancy ? `${one.teacher.name} · ${k('vacancy')}` : one.teacher.name,
          cells: [
            one.lessons,
            one.planned,
            one.elsewhere,
            one.total,
            one.contract,
            one.againstContract === null
              ? null
              : t(`results.reports.load.contractStates.${one.againstContract}`),
            one.invigilations,
          ],
        })),
      };
    }
    if (view === 'classes') {
      return {
        headers: ['unit', 'subject', 'lessons', 'load'],
        lines: data?.classes.map((one) => ({
          id: `${one.unit.id}|${one.subject.id}`,
          name: one.unit.name,
          cells: [nameOf(one.subject.names, i18n.language), one.lessons, one.load],
        })),
      };
    }
    if (view === 'rooms') {
      return {
        headers: ['room', 'roomLessons', 'periods', 'use'],
        lines: data?.rooms.map((one) => ({
          id: one.room.id,
          name: one.room.name,
          cells: [one.lessons, one.periods, percentText(one.percent)],
        })),
      };
    }
    return {
      headers: ['class', 'weekday', 'time'],
      lines: data?.freePeriods.map((one) => ({
        id: `${one.class.id}|${String(one.weekday)}|${String(one.start)}`,
        name: one.class.name,
        cells: [
          t(`dates.weekdays.${String(one.weekday)}` as 'dates.weekdays.1'),
          `${clockText(one.start)}–${clockText(one.end)}`,
        ],
      })),
    };
  }, [view, data, t, k, i18n.language]);
  const columns = useMemo(
    (): Column<Line>[] =>
      shape.headers.map((header, index) =>
        index === 0
          ? {
              key: header,
              header: k(header),
              cell: (line: Line) => line.name,
              sortValue: (line: Line) => line.name,
              searchText: (line: Line) => line.name,
              fixed: true,
            }
          : {
              key: header,
              header: k(header),
              cell: (line: Line) => <span data-cell={header}>{line.cells[index - 1] ?? '—'}</span>,
              sortValue: (line: Line) => line.cells[index - 1] ?? null,
              numeric: typeof shape.lines?.[0]?.cells[index - 1] === 'number',
            },
      ),
    [shape, k],
  );
  return (
    <>
      <PageHeader
        title={t('results.reports.links.load')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('results.reports.title'), to: '/results/reports' },
        ]}
        actions={
          <ExcelButton area="timetable_load" download={download} disabled={data === undefined} />
        }
      />
      <div className="grid gap-4">
        {download.isError && <FailureAlert error={download.error} />}
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <DateField
              label={k('week')}
              value={week}
              onChange={(event) => {
                go({ ...keep, week: event.target.value });
              }}
            />
          </div>
          {data !== undefined && data.departments.length > 0 && (
            <div className="w-56">
              <SelectField
                label={k('department')}
                value={search.department ?? ''}
                options={[
                  { value: '', label: k('allDepartments') },
                  ...data.departments.map((one) => ({
                    value: one.id,
                    label: nameOf(one.names, i18n.language),
                  })),
                ]}
                onChange={(event) => {
                  const rest = { ...keep };
                  Reflect.deleteProperty(rest, 'department');
                  go(
                    event.target.value === '' ? rest : { ...rest, department: event.target.value },
                  );
                }}
              />
            </div>
          )}
          <Segmented
            label={t('results.reports.links.load')}
            options={VIEWS.map((one) => ({ value: one, label: k(one) }))}
            value={view}
            onChange={(value) => {
              const rest = { ...keep };
              Reflect.deleteProperty(rest, 'show');
              go(value === 'teachers' ? rest : { ...rest, show: value });
            }}
          />
        </div>
        <ListPage
          key={view}
          listId={`results-load-${view}`}
          caption={k(view)}
          rows={shape.lines}
          error={report.isError ? report.error : undefined}
          onRetry={() => void report.refetch()}
          rowId={(line) => line.id}
          rowName={(line) => line.name}
          columns={columns}
          search={search}
          onSearchChange={(next: ListSearch, how) => {
            go({ ...next, ...keep }, how);
          }}
          empty={{
            title: k(view),
            text: view === 'freePeriods' ? k('noFreePeriods') : k('empty'),
          }}
        />
      </div>
    </>
  );
}
