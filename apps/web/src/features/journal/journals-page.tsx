import type { JournalList } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import type { Column, Filter, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Segmented } from '@/components/ui/segmented';
import { useMayView, useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectChip } from '@/features/setup/subject-colour';
import { journalsQuery } from './journal-api';
import type { JournalsSearch } from './journal-search';

type Row = JournalList['journals'][number];

/** "2026–2027": the years an academic year spans. */
export const yearText = (year: { startDate: string; endDate: string }): string =>
  `${year.startDate.slice(0, 4)}–${year.endDate.slice(0, 4)}`;

/**
 * The Journals page (task 6.2, pull request #210; `07`, Opening a journal:
 * "From the Journals page: tabs Classes and Groups, then the subject"): the
 * journals of the year the role may open, as the server answers them; a row
 * opens its journal.
 */
export function JournalsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: JournalsSearch = useSearch({ from: '/app/journal' });
  const { branchId } = useView();
  // Task 6.3: the roles that read the reasons of absence reach their page from here.
  const absences = useMayView('absence_reasons');
  // Task 8.4: the unlock requests and the branch-wide extension.
  const unlocks = useMayView('journal_unlocks');
  const exemptions = useMayView('exemptions');
  // Task 8.7: the counts per teacher and the orphan lessons.
  const discipline = useMayView('journal_discipline');
  const orphans = useMayView('journal_orphans');
  const list = useQuery(journalsQuery(branchId, search.year ?? null));
  const language = i18n.language;
  const tab = search.tab ?? 'class';

  const subjectName = useMemo(() => (row: Row) => nameOf(row.subject.names, language), [language]);

  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'unit',
        header: tab === 'class' ? t('journal.page.class') : t('journal.page.group'),
        cell: (row) => row.unit.name,
        sortValue: (row) => row.unit.name,
        searchText: (row) => `${row.unit.name} ${subjectName(row)}`,
        opens: true,
        fixed: true,
      },
      {
        key: 'subject',
        header: t('journal.page.subject'),
        cell: (row) => <SubjectChip colour={row.subject.colour} name={subjectName(row)} />,
        sortValue: subjectName,
      },
    ],
    [t, tab, subjectName],
  );

  const rows = list.data?.journals.filter((row) => row.unit.kind === tab);

  const filters = useMemo(
    (): Filter<Row>[] => [
      {
        key: 'subject',
        label: t('journal.page.subject'),
        options: [
          ...new Map(
            (list.data?.journals ?? []).map((row) => [row.subject.id, subjectName(row)]),
          ).entries(),
        ]
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label, language)),
        matches: (row, value) => row.subject.id === value,
      },
    ],
    [t, list.data, subjectName, language],
  );

  const go = (next: JournalsSearch, how: 'push' | 'replace' = 'push'): void => {
    void navigate({ to: '/journal', search: next, replace: how === 'replace' });
  };
  const keep = {
    ...(search.tab === undefined ? {} : { tab: search.tab }),
    ...(search.year === undefined ? {} : { year: search.year }),
  };

  return (
    <>
      <PageHeader
        title={t('journal.page.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
        actions={
          absences || unlocks || exemptions || discipline || orphans ? (
            <span className="flex flex-wrap gap-4">
              {absences && (
                <Link to="/journal/student-absences" className="text-link">
                  {t('journal.absences.title')}
                </Link>
              )}
              {unlocks && (
                <Link to="/journal/unlocks" className="text-link">
                  {t('journal.unlocks.title')}
                </Link>
              )}
              {exemptions && (
                <Link to="/journal/exemptions" className="text-link">
                  {t('journal.exemptions.title')}
                </Link>
              )}
              {discipline && (
                <Link to="/journal/discipline" className="text-link">
                  {t('journal.discipline.title')}
                </Link>
              )}
              {orphans && (
                <Link to="/journal/orphans" className="text-link">
                  {t('journal.orphans.title')}
                </Link>
              )}
            </span>
          ) : undefined
        }
      />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            label={t('journal.page.tabs')}
            options={[
              { value: 'class', label: t('journal.page.classes') },
              { value: 'group', label: t('journal.page.groups') },
            ]}
            value={tab}
            onChange={(value) => {
              go({ ...keep, tab: value });
            }}
          />
          {list.data !== undefined && list.data.years.length > 1 && (
            <div className="w-48">
              <SelectField
                label={t('journal.page.year')}
                value={list.data.yearId ?? ''}
                options={list.data.years.map((year) => ({ value: year.id, label: yearText(year) }))}
                onChange={(event) => {
                  go({ tab, year: event.target.value });
                }}
              />
            </div>
          )}
        </div>
        <ListPage
          listId="journals"
          caption={t('journal.page.caption')}
          rows={rows}
          error={list.error ?? undefined}
          onRetry={() => {
            void list.refetch();
          }}
          rowId={(row) => row.id}
          rowName={(row) => `${row.unit.name} · ${subjectName(row)}`}
          columns={columns}
          filters={filters}
          search={search}
          onSearchChange={(next: ListSearch, how) => {
            go({ ...keep, ...next }, how);
          }}
          onOpenRow={(row) => {
            void navigate({ to: '/journal/$journalId', params: { journalId: row.id } });
          }}
          empty={{ title: t('journal.page.emptyTitle'), text: t('journal.page.empty') }}
        />
      </div>
    </>
  );
}
