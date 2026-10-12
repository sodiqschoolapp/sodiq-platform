import type { SampleRecord } from '@sodiq/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { ListPage, type BulkAction } from '@/components/list/list-page';
import {
  listSearch,
  type Column,
  type Filter,
  type ListSearch,
} from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Letterhead } from '@/components/print/letterhead';
import { PANEL } from '@/components/ui/control';
import { Button } from '@/components/ui/button';
import { SampleForm } from './sample-form';
import { sampleRows, type SampleRow } from './sample-rows';

/** The states of a list a developer can look at: `?demo=empty` and so on. */
const DEMOS = ['empty', 'loading', 'error', 'many', 'save-fails'] as const;

export type Demo = (typeof DEMOS)[number];

/** A class as it is shown everywhere: grade and name, for example 7 Oxford. */
const classOf = (row: SampleRow): string => `${String(row.grade)} ${row.className}`;

export interface SampleSearch extends ListSearch {
  demo?: Demo;
}

export function sampleSearch(search: Record<string, unknown>): SampleSearch {
  const demo = DEMOS.find((one) => one === search.demo);
  return demo === undefined ? listSearch(search) : { ...listSearch(search), demo };
}

/**
 * Tasks 0.8b-1 and 0.8b-2, done when: "a sample list uses only the shared
 * pieces" and "a sample form uses only the shared pieces". For development and
 * the tests; the page does not open in the built app. Its rows are invented
 * and live in the page: nothing is asked of the server. `?demo=save-fails`
 * shows a save that is refused.
 */
export function SampleListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { demo, ...search } = useSearch({ from: '/app/dev/patterns' });

  const [archived, setArchived] = useState<ReadonlySet<string>>(new Set());
  const [exported, setExported] = useState<number | null>(null);
  const [edited, setEdited] = useState<ReadonlyMap<string, SampleRecord>>(new Map());

  const rows = useMemo(() => {
    if (demo === 'loading' || demo === 'error') {
      return undefined;
    }
    if (demo === 'empty') {
      return [];
    }
    return sampleRows(demo === 'many' ? 2500 : 240).map((row): SampleRow => ({
      ...row,
      ...edited.get(row.id),
      status: archived.has(row.id) ? 'archived' : row.status,
    }));
  }, [demo, archived, edited]);

  const columns = useMemo(
    (): Column<SampleRow>[] => [
      {
        key: 'name',
        header: t('sample.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'class',
        header: t('sample.class'),
        cell: (row) => classOf(row),
        sortValue: (row) => classOf(row),
        searchText: (row) => classOf(row),
      },
      {
        key: 'language',
        header: t('sample.language'),
        cell: (row) => t(row.language === 'uz' ? 'sample.uzbek' : 'sample.russian'),
      },
      {
        key: 'status',
        header: t('sample.status'),
        cell: (row) => t(row.status === 'active' ? 'sample.active' : 'sample.archived'),
      },
      {
        key: 'score',
        header: t('sample.score'),
        cell: (row) => row.score,
        sortValue: (row) => row.score,
        numeric: true,
      },
    ],
    [t],
  );

  const filters = useMemo(
    (): Filter<SampleRow>[] => [
      {
        key: 'status',
        label: t('sample.status'),
        options: [
          { value: 'active', label: t('sample.active') },
          { value: 'archived', label: t('sample.archived') },
        ],
        matches: (row, value) => row.status === value,
      },
      {
        key: 'language',
        label: t('sample.language'),
        options: [
          { value: 'uz', label: t('sample.uzbek') },
          { value: 'ru', label: t('sample.russian') },
        ],
        matches: (row, value) => row.language === value,
      },
    ],
    [t],
  );

  const bulkActions = useMemo(
    (): BulkAction<SampleRow>[] => [
      {
        key: 'archive',
        label: t('sample.archive'),
        run: (ticked) => {
          setArchived((before) => new Set([...before, ...ticked.map((row) => row.id)]));
        },
        confirm: (ticked) => ({
          title: t('sample.archiveTitle', {
            count: ticked.length,
            n: new Intl.NumberFormat(i18n.language).format(ticked.length),
          }),
          text: t('sample.archiveText'),
          action: t('sample.archive'),
        }),
      },
    ],
    [t, i18n.language],
  );

  const open = (next: SampleSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/dev/patterns', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader title={t('sample.title')} breadcrumbs={[{ label: t('home.title'), to: '/' }]} />
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">{t('sample.intro')}</p>
      {exported !== null && (
        <p role="status" className="mb-3 text-sm">
          {t('sample.exported', {
            count: exported,
            n: new Intl.NumberFormat(i18n.language).format(exported),
          })}
        </p>
      )}
      <ListPage
        listId="sample"
        caption={t('sample.caption')}
        rows={rows}
        error={demo === 'error' ? new ApiFailure('no_answer') : undefined}
        onRetry={() => {
          open(search, 'replace');
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={(next, how) => {
          open(demo === undefined ? next : { ...next, demo }, how);
        }}
        empty={{
          title: t('sample.emptyTitle'),
          text: t('sample.empty'),
          action: (
            <Button
              onClick={() => {
                open(search, 'push');
              }}
            >
              {t('sample.showRows')}
            </Button>
          ),
        }}
        bulkActions={bulkActions}
        onExport={(matching) => {
          setExported(matching.length);
        }}
        panel={(row) => (
          <SampleForm
            key={row.id}
            row={row}
            onSave={async (record) => {
              // As a call of the server: the answer comes a moment later.
              await Promise.resolve();
              if (demo === 'save-fails') {
                throw new ApiFailure('no_answer');
              }
              setEdited((before) => new Map(before).set(row.id, record));
            }}
          />
        )}
      />
      {/* The print letterhead (task 2.2d-2), shown here until its first document (2.3). */}
      <section className={`mt-6 grid gap-3 ${PANEL}`}>
        <h2 className="text-[1.0625rem]/6 font-bold">{t('sample.letterhead')}</h2>
        <Letterhead />
      </section>
    </>
  );
}
