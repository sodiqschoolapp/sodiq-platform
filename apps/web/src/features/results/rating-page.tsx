import type {
  InstructionLanguage,
  RatingClassesList,
  RatingClassList,
  RatingExport,
  RatingKind,
  RatingSubjectList,
} from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { DownloadIcon } from '@/components/icons';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { useMayView, useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import {
  exportRating,
  ratingChoicesQuery,
  ratingClassesQuery,
  ratingClassQuery,
  ratingSubjectQuery,
} from './rating-api';

export interface RatingSearch extends ListSearch {
  kind?: RatingKind;
  year?: string;
  quarter?: string;
  journal?: string;
  class?: string;
  grade?: number;
  language?: InstructionLanguage;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export function ratingSearch(search: Record<string, unknown>): RatingSearch {
  const result: RatingSearch = listSearch(search);
  if (search.kind === 'subject' || search.kind === 'class' || search.kind === 'classes') {
    result.kind = search.kind;
  }
  for (const key of ['year', 'quarter', 'journal', 'class'] as const) {
    const value = text(search[key]);
    if (value !== undefined) result[key] = value;
  }
  const grade = Number(search.grade);
  if (Number.isInteger(grade) && grade >= 1 && grade <= 11) result.grade = grade;
  if (search.language === 'uz' || search.language === 'ru') result.language = search.language;
  return result;
}

type SubjectRow = RatingSubjectList['rows'][number];
type ClassRow = RatingClassList['rows'][number];
type ClassesRow = RatingClassesList['rows'][number];

/** A figure in tenths with one decimal (`edge/calculation`: "Rating lists show one decimal"). */
function tenthsText(value: number | null, language: string): string {
  if (value === null) return '—';
  const mark = language === 'en' ? '.' : ',';
  return `${String(Math.trunc(value / 10))}${mark}${String(value % 10)}`;
}

const studentName = (student: SubjectRow['student']): string =>
  [student.lastName, student.firstName].join(' ');

/**
 * The rating (task 9.3a; `08`, Rating): the students of a class or group in one subject, the
 * students of a class across all subjects, and the classes of a grade or of the branch, for a
 * quarter. The lists the reader may open come from the server, which decides every place and
 * figure; "Provisional" while the quarter is open.
 */
export function RatingPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search: RatingSearch = useSearch({ from: '/app/results/rating' });
  const { branchId } = useView();
  const mayClose = useMayView('quarter_closing');
  const mayWarn = useMayView('early_warning');
  const choices = useQuery(ratingChoicesQuery(branchId, search.year));
  const data = choices.data;

  const kinds: RatingKind[] =
    data === undefined
      ? []
      : [
          ...(data.journals.length > 0 ? (['subject'] as const) : []),
          ...(data.classes.length > 0 ? (['class'] as const) : []),
          ...(data.classesList ? (['classes'] as const) : []),
        ];
  const kind = search.kind !== undefined && kinds.includes(search.kind) ? search.kind : kinds[0];
  const quarters = data?.quarters ?? [];
  const quarter =
    quarters.find((one) => one.id === search.quarter) ?? quarters[quarters.length - 1];
  // `05`, Reports: "Language is a filter in ... rating": it narrows the pickers too (plan decision 8).
  const inLanguage = (language: InstructionLanguage) =>
    search.language === undefined || language === search.language;
  const journals = (data?.journals ?? []).filter((one) => inLanguage(one.language));
  const journal = journals.find((one) => one.id === search.journal) ?? journals[0];
  const classes = (data?.classes ?? []).filter((one) => inLanguage(one.language));
  const classChosen = classes.find((one) => one.id === search.class) ?? classes[0];
  const filters = {
    ...(search.grade === undefined ? {} : { grade: search.grade }),
    ...(search.language === undefined ? {} : { language: search.language }),
  };

  const subject = useQuery(
    ratingSubjectQuery(
      kind === 'subject' ? branchId : null,
      quarter?.id,
      kind === 'subject' ? journal?.id : undefined,
    ),
  );
  const classList = useQuery(
    ratingClassQuery(
      kind === 'class' ? branchId : null,
      quarter?.id,
      kind === 'class' ? classChosen?.id : undefined,
    ),
  );
  const classesList = useQuery(
    ratingClassesQuery(branchId, quarter?.id, filters, kind === 'classes'),
  );
  const shown = kind === 'subject' ? subject : kind === 'class' ? classList : classesList;

  const body: RatingExport | null =
    quarter === undefined
      ? null
      : kind === 'subject' && journal !== undefined
        ? { kind, quarterId: quarter.id, journalId: journal.id }
        : kind === 'class' && classChosen !== undefined
          ? { kind, quarterId: quarter.id, classId: classChosen.id }
          : kind === 'classes'
            ? { kind, quarterId: quarter.id, ...filters }
            : null;
  const download = useMutation({
    mutationFn: () => (body === null ? Promise.resolve() : exportRating(body)),
  });

  const keep: RatingSearch = {
    ...(search.kind === undefined ? {} : { kind: search.kind }),
    ...(search.year === undefined ? {} : { year: search.year }),
    ...(search.quarter === undefined ? {} : { quarter: search.quarter }),
    ...(search.journal === undefined ? {} : { journal: search.journal }),
    ...(search.class === undefined ? {} : { class: search.class }),
    ...filters,
  };
  const go = (next: RatingSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/results/rating', search: next, replace: how === 'replace' });
  };
  const without = (key: keyof RatingSearch): RatingSearch => {
    const rest = { ...keep };
    // A filter set back to "all" leaves the address.
    Reflect.deleteProperty(rest, key);
    return rest;
  };

  const place = (value: number | null) => (value === null ? '—' : String(value));
  const subjectColumns = useMemo(
    (): Column<SubjectRow>[] => [
      {
        key: 'place',
        header: t('results.ratingList.place'),
        cell: (row) => place(row.place),
        sortValue: (row) => row.place,
        numeric: true,
        fixed: true,
      },
      {
        key: 'student',
        header: t('results.ratingList.student'),
        cell: (row) => studentName(row.student),
        sortValue: (row) => studentName(row.student),
        searchText: (row) => studentName(row.student),
        fixed: true,
      },
      {
        key: 'figure',
        header: t('results.ratingList.figure'),
        cell: (row) =>
          row.state === 'number' ? (
            <span data-figure={row.value}>{tenthsText(row.value, language)}</span>
          ) : (
            <span data-state={row.state}>{t(`results.ratingList.states.${row.state}`)}</span>
          ),
        sortValue: (row) => row.value,
        numeric: true,
      },
      {
        key: 'note',
        header: t('results.ratingList.note'),
        cell: (row) =>
          row.flags
            .map((flag) =>
              flag === 'left_subject' && row.leftSubjectOn !== null
                ? t('results.ratingList.flags.left_subject', {
                    date: schoolDateText(row.leftSubjectOn, language),
                  })
                : t(`results.ratingList.flags.${flag}`),
            )
            .join('; '),
      },
    ],
    [t, language],
  );
  const classColumns = useMemo(
    (): Column<ClassRow>[] => [
      {
        key: 'place',
        header: t('results.ratingList.place'),
        cell: (row) => place(row.place),
        sortValue: (row) => row.place,
        numeric: true,
        fixed: true,
      },
      {
        key: 'student',
        header: t('results.ratingList.student'),
        cell: (row) => studentName(row.student),
        sortValue: (row) => studentName(row.student),
        searchText: (row) => studentName(row.student),
        fixed: true,
      },
      {
        key: 'figure',
        header: t('results.ratingList.figure'),
        cell: (row) => <span data-figure={row.value ?? ''}>{tenthsText(row.value, language)}</span>,
        sortValue: (row) => row.value,
        numeric: true,
      },
      {
        key: 'subjects',
        header: t('results.ratingList.subjects'),
        cell: (row) => (
          <span data-fewer={row.fewerSubjects ? 'true' : 'false'}>
            {row.fewerSubjects
              ? t('results.ratingList.fewerSubjects', { count: row.subjects })
              : String(row.subjects)}
          </span>
        ),
        sortValue: (row) => row.subjects,
        numeric: true,
      },
    ],
    [t, language],
  );
  const classesColumns = useMemo(
    (): Column<ClassesRow>[] => [
      {
        key: 'place',
        header: t('results.ratingList.place'),
        cell: (row) => place(row.place),
        sortValue: (row) => row.place,
        numeric: true,
        fixed: true,
      },
      {
        key: 'class',
        header: t('results.ratingList.class'),
        cell: (row) => row.class.name,
        sortValue: (row) => row.class.name,
        searchText: (row) => row.class.name,
        fixed: true,
      },
      {
        key: 'figure',
        header: t('results.ratingList.figure'),
        cell: (row) => <span data-figure={row.value ?? ''}>{tenthsText(row.value, language)}</span>,
        sortValue: (row) => row.value,
        numeric: true,
      },
      {
        key: 'students',
        header: t('results.ratingList.students'),
        cell: (row) => String(row.students),
        sortValue: (row) => row.students,
        numeric: true,
      },
    ],
    [t, language],
  );

  const onSearchChange = (next: ListSearch, how: 'push' | 'replace') => {
    go({ ...next, ...keep }, how);
  };
  const empty = { title: t('results.ratingList.title'), text: t('results.ratingList.empty') };
  const list =
    kind === 'subject' ? (
      <ListPage
        listId="results-rating-subject"
        caption={t('results.ratingList.kinds.subject')}
        rows={subject.data?.rows}
        error={subject.isError ? subject.error : undefined}
        onRetry={() => void subject.refetch()}
        rowId={(row) => row.student.id}
        rowName={(row) => studentName(row.student)}
        columns={subjectColumns}
        search={search}
        onSearchChange={onSearchChange}
        empty={empty}
      />
    ) : kind === 'class' ? (
      <ListPage
        listId="results-rating-class"
        caption={t('results.ratingList.kinds.class')}
        rows={classList.data?.rows}
        error={classList.isError ? classList.error : undefined}
        onRetry={() => void classList.refetch()}
        rowId={(row) => row.student.id}
        rowName={(row) => studentName(row.student)}
        columns={classColumns}
        search={search}
        onSearchChange={onSearchChange}
        empty={empty}
      />
    ) : (
      <ListPage
        listId="results-rating-classes"
        caption={t('results.ratingList.kinds.classes')}
        rows={classesList.data?.rows}
        error={classesList.isError ? classesList.error : undefined}
        onRetry={() => void classesList.refetch()}
        rowId={(row) => row.class.id}
        rowName={(row) => row.class.name}
        columns={classesColumns}
        search={search}
        onSearchChange={onSearchChange}
        empty={empty}
      />
    );

  const state = shown.data;
  let content: React.ReactNode;
  if (choices.isError) {
    content = <ErrorState error={choices.error} onRetry={() => void choices.refetch()} />;
  } else if (data === undefined) {
    content = <LoadingOutline />;
  } else if (
    kind === undefined ||
    quarter === undefined ||
    (kind === 'subject' && journal === undefined) ||
    (kind === 'class' && classChosen === undefined)
  ) {
    content = (
      <EmptyState title={t('results.ratingList.title')} text={t('results.ratingList.nothing')} />
    );
  } else {
    content = (
      <>
        {state !== undefined && (state.provisional || state.quarter.notOfficial) && (
          <p
            className="flex flex-wrap gap-3 text-sm text-muted-foreground"
            data-rating-state="true"
          >
            {state.provisional && (
              <span data-provisional="true">{t('results.ratingList.provisional')}</span>
            )}
            {state.quarter.notOfficial && (
              <span data-not-official="true">{t('results.ratingList.notOfficial')}</span>
            )}
          </p>
        )}
        {list}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('results.ratingList.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
        actions={
          <>
            {mayWarn && (
              <Link to="/results/early-warning" className="text-link self-center text-sm">
                {t('results.earlyWarning.link')}
              </Link>
            )}
            {mayClose && (
              <Link to="/results/closing" className="text-link self-center text-sm">
                {t('results.ratingList.closingLink')}
              </Link>
            )}
            <Button
              variant="secondary"
              disabled={download.isPending || body === null || shown.data === undefined}
              onClick={() => {
                download.mutate();
              }}
            >
              <DownloadIcon />
              {t('results.ratingList.excel')}
            </Button>
          </>
        }
      />
      <div className="grid gap-4">
        {download.isError && <FailureAlert error={download.error} />}
        {data !== undefined && kind !== undefined && (
          <div className="flex flex-wrap items-end gap-4">
            {kinds.length > 1 && (
              <Segmented
                label={t('results.ratingList.kind')}
                options={kinds.map((one) => ({
                  value: one,
                  label: t(`results.ratingList.kinds.${one}`),
                }))}
                value={kind}
                onChange={(value) => {
                  go({ ...keep, kind: value });
                }}
              />
            )}
            {data.years.length > 1 && data.year !== null && (
              <div className="w-48">
                <SelectField
                  label={t('results.ratingList.year')}
                  value={data.year.id}
                  options={data.years.map((one) => ({
                    value: one.id,
                    label: `${one.startDate.slice(0, 4)}–${one.endDate.slice(0, 4)}`,
                  }))}
                  onChange={(event) => {
                    go({ ...without('quarter'), year: event.target.value });
                  }}
                />
              </div>
            )}
            {quarter !== undefined && (
              <div className="w-40">
                <SelectField
                  label={t('results.ratingList.quarter')}
                  value={quarter.id}
                  options={quarters.map((one) => ({
                    value: one.id,
                    label: t('results.ratingList.quarterNumber', { number: one.number }),
                  }))}
                  onChange={(event) => {
                    go({ ...keep, quarter: event.target.value });
                  }}
                />
              </div>
            )}
            {kind === 'subject' && journal !== undefined && (
              <div className="w-72">
                <SelectField
                  label={t('results.ratingList.journal')}
                  value={journal.id}
                  options={journals.map((one) => ({
                    value: one.id,
                    label: `${nameOf(one.subject.names, language)} · ${one.unit.name}`,
                  }))}
                  onChange={(event) => {
                    go({ ...keep, journal: event.target.value });
                  }}
                />
              </div>
            )}
            {kind === 'class' && classChosen !== undefined && (
              <div className="w-48">
                <SelectField
                  label={t('results.ratingList.class')}
                  value={classChosen.id}
                  options={classes.map((one) => ({ value: one.id, label: one.name }))}
                  onChange={(event) => {
                    go({ ...keep, class: event.target.value });
                  }}
                />
              </div>
            )}
            {kind === 'classes' && (
              <>
                <div className="w-40">
                  <SelectField
                    label={t('results.ratingList.grade')}
                    value={search.grade === undefined ? '' : String(search.grade)}
                    options={[
                      { value: '', label: t('results.ratingList.allGrades') },
                      ...Array.from({ length: 11 }, (_, index) => ({
                        value: String(index + 1),
                        label: String(index + 1),
                      })),
                    ]}
                    onChange={(event) => {
                      go(
                        event.target.value === ''
                          ? without('grade')
                          : { ...keep, grade: Number(event.target.value) },
                      );
                    }}
                  />
                </div>
              </>
            )}
            <div className="w-40">
              <SelectField
                label={t('results.ratingList.language')}
                value={search.language ?? ''}
                options={[
                  { value: '', label: t('results.ratingList.allLanguages') },
                  { value: 'uz', label: t('results.ratingList.languages.uz') },
                  { value: 'ru', label: t('results.ratingList.languages.ru') },
                ]}
                onChange={(event) => {
                  const value = event.target.value;
                  go(
                    value === 'uz' || value === 'ru'
                      ? { ...keep, language: value }
                      : without('language'),
                  );
                }}
              />
            </div>
          </div>
        )}
        {content}
      </div>
    </>
  );
}
