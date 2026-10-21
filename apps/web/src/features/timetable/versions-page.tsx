import {
  PERMISSIONS,
  permits,
  type AcademicYear,
  type TimetableHistory,
  type TimetableVersion,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import { type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SUBSECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { yearsQuery } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { comparisonQuery, createVersion, historyQuery, invalidateTimetable } from './timetable-api';
import { NewDraftForm } from './version-form';
import { VersionsCompare } from './versions-compare';

/** The quarters on whose first day a version is in force, by number. */
const quartersOf = (history: TimetableHistory, id: string): number[] =>
  history.quarters.filter((one) => one.version?.id === id).map((one) => one.number);

/**
 * Version history (task 5.8a, pull request #194; `06`, Protection: "Version
 * history shows every version in the order of their start dates, names the
 * version in force on the first day of each quarter, compares two versions,
 * and can reopen an old one as a new draft"): the versions of a year, each
 * opened in the side panel to compare it with another version of the year or
 * to restore it as a new draft. The Super Admin, the Principal and the
 * Academic Vice Principal read (`timetable` `view`); restoring is a new draft
 * (`timetable` `create`).
 */
export function VersionsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/timetable/versions' });
  const { role, branchId } = useView();
  const canCreate = role !== null && permits(PERMISSIONS, role, 'timetable', 'create');
  const years = useQuery(yearsQuery(branchId));
  const offered = useMemo(
    () => (years.data?.years ?? []).filter((year) => year.status !== 'closed'),
    [years.data],
  );
  const [chosenYear, setChosenYear] = useState<string | null>(null);
  // A year no longer offered falls back to the current one, else the first.
  const yearId =
    offered.find((year) => year.id === chosenYear)?.id ??
    offered.find((year) => year.status === 'current')?.id ??
    offered[0]?.id ??
    null;
  const history = useQuery(historyQuery(branchId, yearId));

  const columns = useMemo((): Column<TimetableVersion>[] => {
    const date = (value: string) => schoolDateText(value, i18n.language);
    return [
      {
        key: 'number',
        header: t('timetable.history.columns.version'),
        cell: (row) => t('timetable.history.versionName', { number: row.number }),
        sortValue: (row) => row.number,
        opens: true,
      },
      {
        key: 'startsOn',
        header: t('timetable.history.columns.validFrom'),
        cell: (row) => date(row.startsOn),
        sortValue: (row) => row.startsOn,
      },
      {
        key: 'status',
        header: t('timetable.history.columns.status'),
        cell: (row) =>
          row.outOfDate
            ? t('timetable.load.statuses.outOfDate')
            : t(`timetable.load.statuses.${row.status}`),
        sortValue: (row) => row.status,
      },
      {
        key: 'from',
        header: t('timetable.history.columns.copiedFrom'),
        cell: (row) =>
          row.fromVersion === null
            ? t('timetable.history.none')
            : t('timetable.history.versionName', { number: row.fromVersion.number }),
      },
      {
        key: 'inForce',
        header: t('timetable.history.columns.inForce'),
        cell: (row) => {
          const numbers = history.data === undefined ? [] : quartersOf(history.data, row.id);
          return numbers.length === 0
            ? ''
            : t('timetable.history.inForce', { quarters: numbers.join(', ') });
        },
      },
    ];
  }, [t, i18n.language, history.data]);

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/timetable/versions', search: next, replace: how === 'replace' });
  };

  const yearField =
    offered.length > 1 ? (
      <div className="min-w-56">
        <SelectField
          label={t('timetable.history.year')}
          name="year"
          value={yearId ?? ''}
          options={offered.map((year) => ({ value: year.id, label: year.name }))}
          onChange={(event) => {
            setChosenYear(event.target.value);
          }}
        />
      </div>
    ) : undefined;

  return (
    <>
      <PageHeader
        title={t('timetable.history.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('timetable.title'), to: '/timetable' },
        ]}
        actions={yearField}
      />
      <ListPage
        listId="timetable-versions"
        caption={t('timetable.history.caption')}
        rows={years.data !== undefined && yearId === null ? [] : history.data?.versions}
        error={years.error ?? history.error ?? undefined}
        onRetry={() => {
          void years.refetch();
          void history.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => t('timetable.history.versionName', { number: row.number })}
        columns={columns}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('timetable.history.emptyTitle'),
          text: t('timetable.history.empty'),
        }}
        panel={(row) =>
          history.data === undefined ? null : (
            <VersionPanel
              key={row.id}
              version={row}
              history={history.data}
              years={offered}
              canCreate={canCreate}
            />
          )
        }
      />
    </>
  );
}

/** A version of the history: where it stands, a comparison with another version, and its restore. */
function VersionPanel({
  version,
  history,
  years,
  canCreate,
}: {
  version: TimetableVersion;
  history: TimetableHistory;
  years: readonly AcademicYear[];
  canCreate: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const others = history.versions.filter((one) => one.id !== version.id);
  const [otherId, setOtherId] = useState<string>('');
  const chosen = others.find((one) => one.id === otherId) ?? null;
  const comparison = useQuery(
    comparisonQuery(branchId, chosen?.id ?? '', chosen === null ? null : version.id),
  );
  const [restoring, setRestoring] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    if (opened === null) return;
    void navigate({ to: '/timetable/builder', search: { version: opened, step: 'grid' } });
  }, [opened, navigate]);
  const create = useMutation({
    mutationFn: createVersion,
    onSuccess: () => invalidateTimetable(queryClient),
  });
  const quarters = quartersOf(history, version.id);
  const year = years.find((one) => one.id === version.academicYearId);
  const name = (number: number) => t('timetable.history.versionName', { number });

  return (
    <div className="grid gap-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-semibold">{t('timetable.history.columns.validFrom')}</dt>
        <dd>{schoolDateText(version.startsOn, i18n.language)}</dd>
        <dt className="font-semibold">{t('timetable.history.columns.status')}</dt>
        <dd>
          {version.outOfDate
            ? t('timetable.load.statuses.outOfDate')
            : t(`timetable.load.statuses.${version.status}`)}
        </dd>
        <dt className="font-semibold">{t('timetable.history.columns.copiedFrom')}</dt>
        <dd>
          {version.fromVersion === null
            ? t('timetable.history.none')
            : name(version.fromVersion.number)}
        </dd>
        <dt className="font-semibold">{t('timetable.history.columns.inForce')}</dt>
        <dd data-in-force="">
          {quarters.length === 0
            ? t('timetable.history.none')
            : t('timetable.history.inForce', { quarters: quarters.join(', ') })}
        </dd>
      </dl>

      <section aria-labelledby={`compare-${version.id}`} className="grid gap-3">
        <h3 id={`compare-${version.id}`} className={SUBSECTION_TITLE}>
          {t('timetable.history.compareTitle')}
        </h3>
        {others.length === 0 ? (
          <p className="text-sm">{t('timetable.history.nothingToCompare')}</p>
        ) : (
          <SelectField
            label={t('timetable.history.compareWith')}
            name="compareWith"
            value={chosen?.id ?? ''}
            options={[
              { value: '', label: t('timetable.history.chooseVersion') },
              ...others.map((one) => ({ value: one.id, label: name(one.number) })),
            ]}
            onChange={(event) => {
              setOtherId(event.target.value);
            }}
          />
        )}
        {chosen !== null && (
          <>
            <p className="text-sm font-semibold" data-comparison-of="">
              {t('timetable.history.changesFrom', {
                before: name(chosen.number),
                after: name(version.number),
              })}
            </p>
            {comparison.isError ? (
              <ErrorState
                error={comparison.error}
                onRetry={() => {
                  void comparison.refetch();
                }}
              />
            ) : comparison.data === undefined ? (
              <LoadingOutline />
            ) : (
              <VersionsCompare comparison={comparison.data} />
            )}
          </>
        )}
      </section>

      {canCreate && year !== undefined && (
        <section aria-labelledby={`restore-${version.id}`} className="grid gap-3">
          <h3 id={`restore-${version.id}`} className={SUBSECTION_TITLE}>
            {t('timetable.history.restoreTitle')}
          </h3>
          {restoring ? (
            <NewDraftForm
              years={[year]}
              versions={[version]}
              today={history.today}
              copyFrom={version.id}
              onSave={async (record) => {
                const created = await create.mutateAsync(record);
                // The builder opens once the form is gone, so leaving it asks nothing.
                setRestoring(false);
                setOpened(created.id);
              }}
              onCancel={() => {
                setRestoring(false);
              }}
            />
          ) : (
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  setRestoring(true);
                }}
              >
                {t('timetable.history.restore')}
              </Button>
            </div>
          )}
          {create.error !== null && <FailureAlert error={create.error} />}
        </section>
      )}
    </div>
  );
}
