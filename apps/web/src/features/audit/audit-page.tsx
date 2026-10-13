import {
  AUDIT_GROUPS,
  AUDIT_PERSON_KINDS,
  AUDIT_SCOPES,
  permits,
  PERMISSIONS,
  type AuditEntryAnswer,
  type AuditPersonKind,
} from '@sodiq/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DateField, SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import { type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { formatMoment } from '@/features/auth/moments';
import { relativesQuery, staffQuery, studentsQuery } from '@/features/people/people-api';
import { auditEntriesQuery } from './audit-api';
import { filtersOf, personOf, type AuditSearch } from './audit-search';
import { actionName, EntryPanel, recordTypeName } from './entry-panel';

/** The people of one kind the reader may open in the branch, by name, for the person filter. */
function usePeople(kind: AuditPersonKind | undefined, branchId: string | null) {
  const { role } = useView();
  const views = (area: string) => role !== null && permits(PERMISSIONS, role, area, 'view');
  const staff = useQuery({
    ...staffQuery(branchId),
    enabled: branchId !== null && kind === 'staff' && views('staff'),
  });
  const students = useQuery({
    ...studentsQuery(branchId),
    enabled: branchId !== null && kind === 'student' && views('students'),
  });
  const relatives = useQuery({
    ...relativesQuery(branchId),
    enabled: branchId !== null && kind === 'relative' && views('relatives'),
  });
  const people =
    kind === 'staff'
      ? staff.data?.staff.map((person) => ({
          id: person.id,
          name: `${person.lastName} ${person.firstName}`,
        }))
      : kind === 'student'
        ? students.data?.students.map((one) => ({
            id: one.id,
            name: `${one.lastName} ${one.firstName}`,
          }))
        : kind === 'relative'
          ? relatives.data?.relatives.map((one) => ({ id: one.id, name: one.fullName }))
          : [];
  return (people ?? []).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The Audit log (edge/people-roles-accounts, Personal data and the audit log:
 * "It can be searched by person, record and date"; task 2.6a). The shared
 * list, with the search the server answers in the address beside the list
 * state, and the next page loaded with "Load more" (decision 8). The Super
 * Admin chooses the log (decision 4); the server decides what each reader
 * reads and hides.
 */
export function AuditPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: AuditSearch = useSearch({ from: '/app/audit' });
  const { branchId, branches, role } = useView();
  const filters = filtersOf(search);
  const entries = useInfiniteQuery(auditEntriesQuery(branchId, filters));
  const first = entries.data?.pages[0];
  const rows = useMemo(() => entries.data?.pages.flatMap((page) => page.entries), [entries.data]);
  const superAdmin = role === 'super_admin';
  const person = personOf(search.person);
  const kind = person?.kind ?? search.personKind;
  const people = usePeople(kind, branchId);

  const setFilters = (patch: Partial<AuditSearch>): void => {
    const next: Record<string, unknown> = { ...search, ...patch, open: undefined };
    void navigate({
      to: '/audit',
      search: Object.fromEntries(
        Object.entries(next).filter(([, value]) => value !== undefined && value !== ''),
      ),
    });
  };

  const columns = useMemo((): Column<AuditEntryAnswer>[] => {
    const named = (value: { name: string | null } | null, none: string) =>
      value === null ? none : (value.name ?? t('audit.unnamed'));
    const branchName = (row: AuditEntryAnswer) =>
      row.branchId === null
        ? t('audit.schoolWide')
        : (branches.find((one) => one.id === row.branchId)?.name ?? '');
    return [
      {
        key: 'when',
        header: t('audit.when'),
        cell: (row) => formatMoment(i18n.language, row.occurredAt),
        sortValue: (row) => row.occurredAt,
        opens: true,
      },
      {
        key: 'action',
        header: t('audit.action'),
        cell: (row) => actionName(t, row.action),
        sortValue: (row) => actionName(t, row.action),
        searchText: (row) => actionName(t, row.action),
      },
      {
        key: 'who',
        header: t('audit.who'),
        cell: (row) => named(row.actor, t('audit.system')),
        sortValue: (row) => named(row.actor, t('audit.system')),
        searchText: (row) => named(row.actor, t('audit.system')),
      },
      {
        key: 'about',
        header: t('audit.about'),
        cell: (row) => named(row.person, ''),
        searchText: (row) => named(row.person, ''),
      },
      {
        key: 'record',
        header: t('audit.record'),
        cell: (row) =>
          row.record === null
            ? ''
            : [recordTypeName(t, row.record.type), row.record.name]
                .filter((part) => part !== null)
                .join(': '),
        searchText: (row) => row.record?.name ?? '',
      },
      ...(superAdmin
        ? [
            {
              key: 'branch',
              header: t('audit.branch'),
              cell: branchName,
              sortValue: branchName,
            },
          ]
        : []),
    ];
  }, [t, i18n.language, branches, superAdmin]);

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/audit', search: { ...filters, ...next }, replace: how === 'replace' });
  };

  const recordFilter =
    search.recordType === undefined ? null : recordTypeName(t, search.recordType);

  return (
    <>
      <PageHeader title={t('audit.title')} breadcrumbs={[{ label: t('home.title'), to: '/' }]} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <DateField
          label={t('audit.from')}
          value={search.from ?? first?.from ?? ''}
          onChange={(event) => {
            setFilters({ from: event.target.value || undefined });
          }}
        />
        <DateField
          label={t('audit.to')}
          value={search.to ?? first?.to ?? ''}
          onChange={(event) => {
            setFilters({ to: event.target.value || undefined });
          }}
        />
        <SelectField
          label={t('audit.group')}
          value={search.group ?? ''}
          options={[
            { value: '', label: t('list.all') },
            ...AUDIT_GROUPS.map((group) => ({ value: group, label: t(`audit.groups.${group}`) })),
          ]}
          onChange={(event) => {
            const group = AUDIT_GROUPS.find((one) => one === event.target.value);
            setFilters({ group });
          }}
        />
        {superAdmin && (
          <SelectField
            label={t('audit.scope')}
            value={search.scope ?? 'branch'}
            options={AUDIT_SCOPES.map((scope) => ({
              value: scope,
              label: t(`audit.scopes.${scope}`),
            }))}
            onChange={(event) => {
              const scope = AUDIT_SCOPES.find((one) => one === event.target.value);
              setFilters({ scope: scope === 'branch' ? undefined : scope });
            }}
          />
        )}
        <SelectField
          label={t('audit.personKind')}
          value={kind ?? ''}
          options={[
            { value: '', label: t('audit.anyone') },
            ...AUDIT_PERSON_KINDS.map((kind) => ({
              value: kind,
              label: t(`audit.personKinds.${kind}`),
            })),
          ]}
          onChange={(event) => {
            // A kind without a person yet: the list of that kind is offered.
            setFilters({
              person: undefined,
              personKind: AUDIT_PERSON_KINDS.find((one) => one === event.target.value),
            });
          }}
        />
        {kind !== undefined && (
          <SelectField
            label={t('audit.person')}
            value={person?.id ?? ''}
            options={[
              { value: '', label: t('audit.choose') },
              ...people.map((one) => ({ value: one.id, label: one.name })),
            ]}
            onChange={(event) => {
              setFilters(
                event.target.value === ''
                  ? { person: undefined, personKind: kind }
                  : { person: `${kind}:${event.target.value}`, personKind: undefined },
              );
            }}
          />
        )}
        {recordFilter !== null && (
          <div className="flex items-center gap-2 text-sm">
            <span>{t('audit.onlyRecordOf', { name: recordFilter })}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters({ recordType: undefined, recordId: undefined });
              }}
            >
              {t('audit.clear')}
            </Button>
          </div>
        )}
      </div>
      <ListPage
        listId="audit"
        caption={t('audit.caption')}
        rows={rows}
        error={entries.error ?? undefined}
        onRetry={() => {
          void entries.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => actionName(t, row.action)}
        columns={columns}
        search={search}
        onSearchChange={open}
        empty={{ title: t('audit.emptyTitle'), text: t('audit.empty') }}
        panel={(row) => <EntryPanel key={row.id} entry={row} />}
        more={
          entries.hasNextPage
            ? {
                onMore: () => {
                  void entries.fetchNextPage();
                },
                loading: entries.isFetchingNextPage,
              }
            : undefined
        }
      />
    </>
  );
}
