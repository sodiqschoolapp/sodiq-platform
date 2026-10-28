import type { SubjectMastery } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { PreparedStamp } from '@/components/prepared-stamp';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { ExcelButton, percentText, textOf, useDownload, wholeOf } from './report-parts';
import {
  exportResultsReport,
  resultsReportChoicesQuery,
  subjectMasteryQuery,
  type MasteryFilters,
} from './reports-api';

export interface SubjectMasterySearch extends ListSearch {
  quarter?: string;
  subject?: string;
  grade?: number;
  class?: string;
  teacher?: string;
}

export function subjectMasterySearch(search: Record<string, unknown>): SubjectMasterySearch {
  const result: SubjectMasterySearch = listSearch(search);
  for (const key of ['quarter', 'subject', 'class', 'teacher'] as const) {
    const value = textOf(search[key]);
    if (value !== undefined) result[key] = value;
  }
  const grade = wholeOf(search.grade, 1, 11);
  if (grade !== undefined) result.grade = grade;
  return result;
}

/** A line: a band of grades, or one of the states beside the bands. */
interface Line {
  readonly id: string;
  readonly name: string;
  readonly range: string;
  readonly students: number;
  readonly percent: number | null;
}

/**
 * Subject mastery (task 9.3b-2; `08`, Analytics, "Share of students in each grade band for a
 * subject"; decision 3): the students with a number in each band, and "Exempt", "Not assessed" and
 * "No result" counted beside the bands, never in one.
 */
export function SubjectMasteryPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: SubjectMasterySearch = useSearch({ from: '/app/results/mastery' });
  const { branchId } = useView();
  const choices = useQuery(resultsReportChoicesQuery(branchId));
  const quarters = choices.data?.quarters ?? [];
  const subjects = choices.data?.subjects ?? [];
  const quarter = quarters.find((one) => one.id === search.quarter) ?? quarters.at(-1);
  const subject = subjects.find((one) => one.id === search.subject) ?? subjects[0];
  const filters: MasteryFilters = {
    ...(quarter === undefined ? {} : { quarterId: quarter.id }),
    ...(subject === undefined ? {} : { subjectId: subject.id }),
    ...(search.grade === undefined ? {} : { grade: search.grade }),
    ...(search.class === undefined ? {} : { classId: search.class }),
    ...(search.teacher === undefined ? {} : { teacherId: search.teacher }),
  };
  const mastery = useQuery(subjectMasteryQuery(branchId, filters));
  const download = useDownload(() =>
    filters.quarterId === undefined || filters.subjectId === undefined
      ? Promise.resolve()
      : exportResultsReport({
          kind: 'mastery',
          quarterId: filters.quarterId,
          subjectId: filters.subjectId,
          ...(filters.grade === undefined ? {} : { grade: filters.grade }),
          ...(filters.classId === undefined ? {} : { classId: filters.classId }),
          ...(filters.teacherId === undefined ? {} : { teacherId: filters.teacherId }),
        }),
  );
  const keep: SubjectMasterySearch = {
    ...(search.quarter === undefined ? {} : { quarter: search.quarter }),
    ...(search.subject === undefined ? {} : { subject: search.subject }),
    ...(search.grade === undefined ? {} : { grade: search.grade }),
    ...(search.class === undefined ? {} : { class: search.class }),
    ...(search.teacher === undefined ? {} : { teacher: search.teacher }),
  };
  const go = (next: SubjectMasterySearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/results/mastery', search: next, replace: how === 'replace' });
  };
  const choose = (key: 'grade' | 'class' | 'teacher', value: string) => {
    const rest = { ...keep };
    // A filter set back to "all" leaves the address.
    Reflect.deleteProperty(rest, key);
    if (value === '') go(rest);
    else go({ ...rest, [key]: key === 'grade' ? Number(value) : value });
  };
  const data: SubjectMastery | undefined = mastery.data;
  const lines: Line[] | undefined =
    data === undefined
      ? undefined
      : [
          ...data.bands.map((band) => ({
            id: `band-${String(band.grade)}`,
            name: String(band.grade),
            range: t('results.reports.mastery.bandRange', {
              from: String(band.from),
              to: String(band.to),
            }),
            students: band.students,
            percent: band.percent,
          })),
          ...(
            [
              ['exempt', data.exempt],
              ['notAssessed', data.notAssessed],
              ['noResult', data.noResult],
            ] as const
          ).map(([key, students]) => ({
            id: key,
            name: t(`results.reports.mastery.${key}`),
            range: t('results.reports.mastery.beside'),
            students,
            percent: null,
          })),
        ];
  const columns = useMemo(
    (): Column<Line>[] => [
      {
        key: 'mark',
        header: t('results.reports.mastery.mark'),
        cell: (line) => line.name,
        fixed: true,
      },
      { key: 'band', header: t('results.reports.mastery.band'), cell: (line) => line.range },
      {
        key: 'students',
        header: t('results.reports.mastery.students'),
        cell: (line) => <span data-students="">{line.students}</span>,
        numeric: true,
      },
      {
        key: 'percent',
        header: t('results.reports.mastery.percent'),
        cell: (line) => <span data-percent="">{percentText(line.percent)}</span>,
        numeric: true,
      },
    ],
    [t],
  );
  let content: React.ReactNode;
  if (choices.isError) {
    content = <ErrorState error={choices.error} onRetry={() => void choices.refetch()} />;
  } else if (choices.data === undefined) {
    content = <LoadingOutline />;
  } else if (quarter === undefined || subject === undefined) {
    content = (
      <EmptyState
        title={t('results.reports.links.mastery')}
        text={t('results.reports.mastery.nothing')}
      />
    );
  } else {
    content = (
      <ListPage
        listId="results-mastery"
        caption={t('results.reports.links.mastery')}
        rows={lines}
        error={mastery.isError ? mastery.error : undefined}
        onRetry={() => void mastery.refetch()}
        rowId={(line) => line.id}
        rowName={(line) => line.name}
        columns={columns}
        search={search}
        onSearchChange={(next: ListSearch, how) => {
          go({ ...next, ...keep }, how);
        }}
        empty={{
          title: t('results.reports.links.mastery'),
          text: t('results.reports.mastery.nothing'),
        }}
      />
    );
  }
  return (
    <>
      <PageHeader
        title={t('results.reports.links.mastery')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('results.reports.title'), to: '/results/reports' },
        ]}
        actions={
          <ExcelButton area="results_reports" download={download} disabled={data === undefined} />
        }
      />
      <div className="grid gap-4">
        {download.isError && <FailureAlert error={download.error} />}
        {data !== undefined && (
          <PreparedStamp
            stamp={data.prepared}
            refreshing={mastery.isFetching}
            onRefresh={() => {
              void mastery.refetch();
            }}
          />
        )}
        {data?.provisional === true && (
          <p className="text-muted-foreground">{t('results.reports.provisional')}</p>
        )}
        {quarter !== undefined && subject !== undefined && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <SelectField
                label={t('results.reports.quarter')}
                value={quarter.id}
                options={quarters.map((one) => ({
                  value: one.id,
                  label: t('results.reports.quarterNumber', { number: one.number }),
                }))}
                onChange={(event) => {
                  go({ ...keep, quarter: event.target.value });
                }}
              />
            </div>
            <div className="w-56">
              <SelectField
                label={t('results.reports.mastery.subject')}
                value={subject.id}
                options={subjects.map((one) => ({
                  value: one.id,
                  label: nameOf(one.names, i18n.language),
                }))}
                onChange={(event) => {
                  go({ quarter: quarter.id, subject: event.target.value });
                }}
              />
            </div>
            {data !== undefined && (
              <>
                <div className="w-40">
                  <SelectField
                    label={t('results.reports.mastery.grade')}
                    value={search.grade === undefined ? '' : String(search.grade)}
                    options={[
                      { value: '', label: t('results.reports.mastery.allGrades') },
                      ...data.choices.grades.map((one) => ({
                        value: String(one),
                        label: String(one),
                      })),
                    ]}
                    onChange={(event) => {
                      choose('grade', event.target.value);
                    }}
                  />
                </div>
                <div className="w-44">
                  <SelectField
                    label={t('results.reports.mastery.class')}
                    value={search.class ?? ''}
                    options={[
                      { value: '', label: t('results.reports.mastery.allClasses') },
                      ...data.choices.classes.map((one) => ({ value: one.id, label: one.name })),
                    ]}
                    onChange={(event) => {
                      choose('class', event.target.value);
                    }}
                  />
                </div>
                <div className="w-56">
                  <SelectField
                    label={t('results.reports.mastery.teacher')}
                    value={search.teacher ?? ''}
                    options={[
                      { value: '', label: t('results.reports.mastery.allTeachers') },
                      ...data.choices.teachers.map((one) => ({ value: one.id, label: one.name })),
                    ]}
                    onChange={(event) => {
                      choose('teacher', event.target.value);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}
        {content}
      </div>
    </>
  );
}
