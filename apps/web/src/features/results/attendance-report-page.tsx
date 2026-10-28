import type { AttendanceCountsShown, AttendanceFigure } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DateField, SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { PreparedStamp } from '@/components/prepared-stamp';
import { Segmented } from '@/components/ui/segmented';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import {
  clockText,
  DATE,
  ExcelButton,
  localDate,
  percentText,
  textOf,
  useDownload,
  wholeOf,
} from './report-parts';
import { attendanceReportQuery, exportAttendance, type AttendanceFilters } from './reports-api';

export interface AttendanceReportSearch extends ListSearch {
  from?: string;
  to?: string;
  grade?: number;
  class?: string;
  subject?: string;
  teacher?: string;
  start?: number;
  by?: 'tutor';
}

export function attendanceReportSearch(search: Record<string, unknown>): AttendanceReportSearch {
  const result: AttendanceReportSearch = listSearch(search);
  for (const key of ['from', 'to'] as const) {
    const value = textOf(search[key]);
    if (value !== undefined && DATE.test(value)) result[key] = value;
  }
  for (const key of ['class', 'subject', 'teacher'] as const) {
    const value = textOf(search[key]);
    if (value !== undefined) result[key] = value;
  }
  const grade = wholeOf(search.grade, 1, 11);
  if (grade !== undefined) result.grade = grade;
  const start = wholeOf(search.start, 0, 1439);
  if (start !== undefined) result.start = start;
  if (search.by === 'tutor') result.by = 'tutor';
  return result;
}

/** One line of the list: a class, a tutor, or (with a class chosen) a day. */
interface Line {
  readonly id: string;
  readonly name: string;
  readonly counts: AttendanceCountsShown | null;
  readonly daily: AttendanceFigure;
}

/**
 * The attendance report (task 9.3b-2; `08`, Analytics, Attendance; `07`, Effect on totals; decision
 * 2): each category of the expected cells with its percent, exempt apart, and the daily attendance
 * of `edge/journal`; by class or by tutor, or by day once a class is chosen. The range defaults to
 * this week; the server decides the classes the reader sees.
 */
export function AttendanceReportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search: AttendanceReportSearch = useSearch({ from: '/app/results/attendance' });
  const { branchId } = useView();
  const filters: AttendanceFilters = {
    from: search.from ?? localDate(0, true),
    to: search.to ?? localDate(0),
    groupBy: search.by === 'tutor' ? 'tutor' : 'class',
    ...(search.grade === undefined ? {} : { grade: search.grade }),
    ...(search.class === undefined ? {} : { classId: search.class }),
    ...(search.subject === undefined ? {} : { subjectId: search.subject }),
    ...(search.teacher === undefined ? {} : { teacherId: search.teacher }),
    ...(search.start === undefined ? {} : { start: search.start }),
  };
  const report = useQuery(attendanceReportQuery(branchId, filters));
  const download = useDownload(() => exportAttendance(filters));
  const keep: AttendanceReportSearch = {
    ...(search.from === undefined ? {} : { from: search.from }),
    ...(search.to === undefined ? {} : { to: search.to }),
    ...(search.grade === undefined ? {} : { grade: search.grade }),
    ...(search.class === undefined ? {} : { class: search.class }),
    ...(search.subject === undefined ? {} : { subject: search.subject }),
    ...(search.teacher === undefined ? {} : { teacher: search.teacher }),
    ...(search.start === undefined ? {} : { start: search.start }),
    ...(search.by === undefined ? {} : { by: search.by }),
  };
  const go = (next: AttendanceReportSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/results/attendance', search: next, replace: how === 'replace' });
  };
  const choose = (key: 'grade' | 'class' | 'subject' | 'teacher' | 'start', value: string) => {
    const rest = { ...keep };
    // A filter set back to "all" leaves the address.
    Reflect.deleteProperty(rest, key);
    if (value === '') go(rest);
    else go({ ...rest, [key]: key === 'grade' || key === 'start' ? Number(value) : value });
  };
  const data = report.data;
  const byDay = search.class !== undefined;
  const lines: Line[] | undefined =
    data === undefined
      ? undefined
      : byDay
        ? data.days.map((one) => ({
            id: one.date,
            name: schoolDateText(one.date, language),
            counts: null,
            daily: one.daily,
          }))
        : data.rows.map((row) =>
            row.key.kind === 'class'
              ? { id: row.key.class.id, name: row.key.class.name, ...row }
              : {
                  id: row.key.tutor?.id ?? 'none',
                  name: row.key.tutor?.name ?? t('results.reports.attendance.noTutor'),
                  ...row,
                },
          );
  const columns = useMemo((): Column<Line>[] => {
    const count = (key: Exclude<keyof AttendanceCountsShown, 'percents' | 'expected'>) => ({
      key,
      header: t(`results.reports.attendance.${key}`),
      cell: (line: Line) =>
        line.counts === null ? (
          '—'
        ) : (
          <span data-count={key}>
            {t('results.reports.attendance.share', {
              count: line.counts[key],
              percent: percentText(line.counts.percents[key]),
            })}
          </span>
        ),
      sortValue: (line: Line) => line.counts?.[key] ?? null,
      numeric: true,
    });
    return [
      {
        key: 'name',
        header: byDay
          ? t('results.reports.attendance.date')
          : search.by === 'tutor'
            ? t('results.reports.attendance.tutor')
            : t('results.reports.attendance.class'),
        cell: (line) => line.name,
        sortValue: (line) => (byDay ? line.id : line.name),
        searchText: (line) => line.name,
        fixed: true,
      },
      ...(byDay
        ? []
        : (['present', 'late', 'absent', 'skipped', 'unmarked', 'exempt'] as const).map(count)),
      ...(byDay
        ? []
        : [
            {
              key: 'expected',
              header: t('results.reports.attendance.expected'),
              cell: (line: Line) => line.counts?.expected ?? '—',
              sortValue: (line: Line) => line.counts?.expected ?? null,
              numeric: true,
            },
          ]),
      {
        key: 'daily',
        header: t('results.reports.attendance.daily'),
        cell: (line) => <span data-daily="">{percentText(line.daily.percent)}</span>,
        sortValue: (line) => line.daily.percent,
        numeric: true,
      },
    ];
  }, [t, byDay, search.by]);
  const choices = data?.choices;
  return (
    <>
      <PageHeader
        title={t('results.reports.links.attendance')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('results.reports.title'), to: '/results/reports' },
        ]}
        actions={
          <ExcelButton area="attendance_report" download={download} disabled={data === undefined} />
        }
      />
      <div className="grid gap-4">
        {download.isError && <FailureAlert error={download.error} />}
        {data !== undefined && (
          <PreparedStamp
            stamp={data.prepared}
            refreshing={report.isFetching}
            onRefresh={() => {
              void report.refetch();
            }}
          />
        )}
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <DateField
              label={t('results.reports.from')}
              value={filters.from}
              onChange={(event) => {
                go({ ...keep, from: event.target.value });
              }}
            />
          </div>
          <div className="w-44">
            <DateField
              label={t('results.reports.to')}
              value={filters.to}
              onChange={(event) => {
                go({ ...keep, to: event.target.value });
              }}
            />
          </div>
          {choices !== undefined && (
            <>
              <div className="w-40">
                <SelectField
                  label={t('results.reports.attendance.grade')}
                  value={search.grade === undefined ? '' : String(search.grade)}
                  options={[
                    { value: '', label: t('results.reports.attendance.allGrades') },
                    ...choices.grades.map((one) => ({ value: String(one), label: String(one) })),
                  ]}
                  onChange={(event) => {
                    choose('grade', event.target.value);
                  }}
                />
              </div>
              <div className="w-44">
                <SelectField
                  label={t('results.reports.attendance.class')}
                  value={search.class ?? ''}
                  options={[
                    { value: '', label: t('results.reports.attendance.allClasses') },
                    ...choices.classes.map((one) => ({ value: one.id, label: one.name })),
                  ]}
                  onChange={(event) => {
                    choose('class', event.target.value);
                  }}
                />
              </div>
              <div className="w-56">
                <SelectField
                  label={t('results.reports.attendance.subject')}
                  value={search.subject ?? ''}
                  options={[
                    { value: '', label: t('results.reports.attendance.allSubjects') },
                    ...choices.subjects.map((one) => ({
                      value: one.id,
                      label: nameOf(one.names, language),
                    })),
                  ]}
                  onChange={(event) => {
                    choose('subject', event.target.value);
                  }}
                />
              </div>
              <div className="w-56">
                <SelectField
                  label={t('results.reports.attendance.teacher')}
                  value={search.teacher ?? ''}
                  options={[
                    { value: '', label: t('results.reports.attendance.allTeachers') },
                    ...choices.teachers.map((one) => ({ value: one.id, label: one.name })),
                  ]}
                  onChange={(event) => {
                    choose('teacher', event.target.value);
                  }}
                />
              </div>
              <div className="w-36">
                <SelectField
                  label={t('results.reports.attendance.period')}
                  value={search.start === undefined ? '' : String(search.start)}
                  options={[
                    { value: '', label: t('results.reports.attendance.allPeriods') },
                    ...choices.starts.map((one) => ({ value: String(one), label: clockText(one) })),
                  ]}
                  onChange={(event) => {
                    choose('start', event.target.value);
                  }}
                />
              </div>
            </>
          )}
          {!byDay && (
            <Segmented
              label={t('results.reports.attendance.groupBy')}
              options={[
                { value: 'class', label: t('results.reports.attendance.byClass') },
                { value: 'tutor', label: t('results.reports.attendance.byTutor') },
              ]}
              value={search.by === 'tutor' ? 'tutor' : 'class'}
              onChange={(value) => {
                const rest = { ...keep };
                Reflect.deleteProperty(rest, 'by');
                go(value === 'tutor' ? { ...rest, by: 'tutor' } : rest);
              }}
            />
          )}
        </div>
        {data !== undefined && (
          <p className="tabular-nums" data-total="">
            {t('results.reports.attendance.totalDaily', {
              percent: percentText(data.total.daily.percent),
            })}
          </p>
        )}
        <ListPage
          listId="results-attendance"
          caption={t('results.reports.links.attendance')}
          rows={lines}
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
            title: t('results.reports.links.attendance'),
            text: t('results.reports.attendance.empty'),
          }}
        />
      </div>
    </>
  );
}
