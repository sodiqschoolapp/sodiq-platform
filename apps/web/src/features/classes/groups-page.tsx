import {
  CLASS_GRADES,
  classDisplayName,
  classNameKey,
  INSTRUCTION_LANGUAGES,
  PERMISSIONS,
  permits,
  type GroupCreate,
  type SchoolGroup,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/components/list/list-page';
import type { Column, Filter, ListSearch } from '@/components/list/list-state';
import { useExport } from '@/components/list/use-export';
import { useNewRecord } from '@/components/list/use-new-record';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { sessionQuery } from '@/features/auth/session';
import { nameOf, yearsQuery } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { classesQuery } from './classes-api';
import { GroupForm } from './group-form';
import { GroupPanel } from './group-panel';
import { groupTeacherText } from './group-teacher';
import { createGroup, groupsQuery, invalidateGroups } from './groups-api';

/** The classes of a group as a cell: "Split of 7 Oxford", or "7 Oxford, 7 Princeton". */
const classesText = (group: SchoolGroup): string =>
  group.classes.map((one) => classDisplayName(one.grade, one.name)).join(', ');

/**
 * The groups of the branch (`05`, Group; task 3.2a): rows, and at phone width
 * the group cards of `05` ("grade, name, number of students, language,
 * teacher, and the same two figures"; the students today from task 3.2b, the
 * teacher with the teaching load in 3.4 and the figures with the journal,
 * decision 15). Each reader sees the groups of its scope, as the
 * server decides it (decisions 2 and 11). "New group" is switched off, saying
 * what is missing, without a planned or current year, an active class or an
 * active subject (`edge/academic-year`).
 */
export function GroupsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/groups' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const newRecord = useNewRecord();
  const wide = useMinWidth(SM);
  const language = i18n.language;
  const canCreate = role !== null && permits(PERMISSIONS, role, 'groups', 'create');
  const canEdit = role !== null && permits(PERMISSIONS, role, 'groups', 'edit');
  const canArchive = role !== null && permits(PERMISSIONS, role, 'groups', 'archive');
  const canExport = role !== null && permits(PERMISSIONS, role, 'groups', 'export');
  const exporter = useExport<SchoolGroup>('groups', (row) => row.id);
  const groups = useQuery(groupsQuery(branchId));
  // Whether the server lists the groups of own classes only: every
  // assignment of the account that reads groups in the branch is a Tutor one.
  const { data: session } = useQuery(sessionQuery);
  const readers = (session?.assignments ?? []).filter(
    (held) =>
      permits(PERMISSIONS, held.role, 'groups', 'view') &&
      (held.branchId === null || held.branchId === branchId),
  );
  const ownClassesOnly = readers.length > 0 && readers.every((held) => held.role === 'tutor');
  // The years, classes and subjects of the forms: read only by those who change groups.
  const years = useQuery({ ...yearsQuery(branchId), enabled: branchId !== null && canEdit });
  const classes = useQuery({ ...classesQuery(branchId), enabled: branchId !== null && canEdit });
  const subjects = useQuery({ ...subjectsQuery(branchId), enabled: branchId !== null && canEdit });
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const openYears = (years.data?.years ?? []).filter((year) => year.status !== 'closed');
  const noYear = years.data !== undefined && openYears.length === 0;
  const noClass =
    classes.data !== undefined &&
    !classes.data.classes.some(
      (one) => !one.archived && openYears.some((year) => year.id === one.academicYearId),
    );
  const noSubject =
    subjects.data !== undefined &&
    !subjects.data.subjects.some((subject) => subject.archivedAt === null);
  const missing = noYear
    ? t('groups.needYear')
    : noClass
      ? t('groups.needClass')
      : noSubject
        ? t('groups.needSubject')
        : null;
  const formsLoading =
    years.data === undefined || classes.data === undefined || subjects.data === undefined;

  const create = useMutation({
    mutationFn: (record: GroupCreate) => createGroup(record),
    onSuccess: () => invalidateGroups(queryClient),
  });

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/groups', search: next, replace: how === 'replace' });
  };

  const columns = useMemo(
    (): Column<SchoolGroup>[] => [
      {
        key: 'name',
        header: t('groups.columns.name'),
        cell: (row) => row.name,
        sortValue: (row) => classNameKey(row.name),
        searchText: (row) => row.name,
        // `edge/students-classes-groups`: look-alike letters in group names are the same.
        searchFold: classNameKey,
        opens: true,
      },
      {
        key: 'subject',
        header: t('groups.columns.subject'),
        cell: (row) => nameOf(row.subject.names, language),
        sortValue: (row) => nameOf(row.subject.names, language),
        searchText: (row) => nameOf(row.subject.names, language),
      },
      {
        key: 'classes',
        header: t('groups.columns.classes'),
        cell: (row) => classesText(row),
        sortValue: (row) => classesText(row),
        searchText: (row) => classesText(row),
      },
      {
        key: 'language',
        header: t('groups.columns.language'),
        cell: (row) => t(`people.staff.languages.${row.language}`),
        sortValue: (row) => row.language,
      },
      {
        // Task 3.2b: the members today, the card's count.
        key: 'students',
        header: t('groups.columns.students'),
        cell: (row) => number.format(row.students),
        sortValue: (row) => row.students,
        numeric: true,
      },
      {
        key: 'maxSize',
        header: t('groups.columns.maxSize'),
        cell: (row) => number.format(row.maxSize),
        sortValue: (row) => row.maxSize,
        numeric: true,
      },
      {
        key: 'status',
        header: t('groups.columns.status'),
        cell: (row) => (row.archived ? t('groups.archived') : t('groups.active')),
        sortValue: (row) => (row.archived ? 1 : 0),
      },
    ],
    [t, number, language],
  );

  const filters = useMemo((): Filter<SchoolGroup>[] => {
    const rows = groups.data?.groups ?? [];
    const yearOptions = [...new Map(rows.map((row) => [row.academicYearId, row.yearName]))].map(
      ([value, label]) => ({ value, label }),
    );
    const subjectOptions = [
      ...new Map(rows.map((row) => [row.subject.id, nameOf(row.subject.names, language)])),
    ].map(([value, label]) => ({ value, label }));
    return [
      {
        key: 'subject',
        label: t('groups.subject'),
        options: subjectOptions,
        matches: (row, value) => row.subject.id === value,
      },
      {
        key: 'grade',
        label: t('groups.grade'),
        options: CLASS_GRADES.map((grade) => ({
          value: String(grade),
          label: t('groups.gradeOption', { grade: number.format(grade) }),
        })),
        matches: (row, value) => row.grades.includes(Number(value)),
      },
      {
        key: 'language',
        label: t('groups.language'),
        options: INSTRUCTION_LANGUAGES.map((one) => ({
          value: one,
          label: t(`people.staff.languages.${one}`),
        })),
        matches: (row, value) => row.language === value,
      },
      {
        key: 'year',
        label: t('groups.year'),
        options: yearOptions,
        matches: (row, value) => row.academicYearId === value,
      },
      {
        key: 'status',
        label: t('groups.status'),
        options: [
          { value: 'active', label: t('groups.active') },
          { value: 'archived', label: t('groups.archived') },
        ],
        matches: (row, value) => (value === 'archived') === row.archived,
      },
    ];
  }, [t, number, language, groups.data]);

  const addButton = (
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/classes" className="text-link">
        {t('groups.classesLink')}
      </Link>
      {canEdit && (
        <Link to="/groups/placement" className="text-link">
          {t('groups.placementLink')}
        </Link>
      )}
      {canCreate && newRecord.value === null && (
        <>
          <Button
            id={newRecord.buttonId}
            disabled={formsLoading || missing !== null}
            onClick={() => {
              newRecord.start(true);
            }}
          >
            {t('groups.add')}
          </Button>
          {missing !== null && <span className="text-sm text-muted-foreground">{missing}</span>}
        </>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('groups.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('classes.title'), to: '/classes' },
        ]}
        actions={addButton}
      />
      <ListPage
        listId="groups"
        caption={t('groups.caption')}
        rows={groups.data?.groups}
        error={groups.error ?? years.error ?? classes.error ?? subjects.error ?? undefined}
        onRetry={() => {
          void groups.refetch();
          void years.refetch();
          void classes.refetch();
          void subjects.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        onExport={canExport ? exporter.onExport : undefined}
        exportState={exporter.state}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('groups.emptyTitle'),
          text: ownClassesOnly
            ? t('groups.emptyTutor')
            : noYear
              ? t('groups.emptyNoYear')
              : t('groups.empty'),
          action:
            canCreate && newRecord.value === null && missing === null ? (
              <Button
                variant="secondary"
                disabled={formsLoading}
                onClick={() => {
                  newRecord.start(true);
                }}
              >
                {t('groups.add')}
              </Button>
            ) : undefined,
        }}
        view={
          wide
            ? undefined
            : ({ rows, open: openGroup }) => (
                <ul className="grid gap-3">
                  {rows.map((row) => (
                    <li key={row.id} data-group-card="" className={`${PANEL} grid gap-2 p-4`}>
                      <button
                        type="button"
                        className="text-link justify-self-start"
                        onClick={() => {
                          openGroup(row.id);
                        }}
                      >
                        {row.name}
                      </button>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        {(
                          [
                            [
                              t('groups.grade'),
                              row.grades.map((one) => number.format(one)).join(', '),
                            ],
                            [t('groups.columns.subject'), nameOf(row.subject.names, language)],
                            [t('groups.students'), number.format(row.students)],
                            [
                              t('groups.columns.language'),
                              t(`people.staff.languages.${row.language}`),
                            ],
                            [t('groups.teacher'), groupTeacherText(t, row)],
                            [t('groups.average'), t('groups.notYet')],
                            [t('groups.attendance'), t('groups.notYet')],
                          ] as const
                        ).map(([term, value]) => (
                          <div key={term} className="grid gap-0.5">
                            <dt className="text-muted-foreground">{term}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              )
        }
        creating={
          newRecord.value === null
            ? undefined
            : {
                key: 'group',
                title: t('groups.newTitle'),
                content: ({ saved, close, open: openHolder }) => (
                  <div className="grid gap-4">
                    <GroupForm
                      group={null}
                      years={years.data?.years ?? []}
                      classes={classes.data?.classes ?? []}
                      subjects={subjects.data?.subjects ?? []}
                      label={t('groups.newTitle')}
                      onSave={async (record) => {
                        if (!('version' in record)) {
                          saved((await create.mutateAsync(record)).id);
                        }
                      }}
                      onOpenTaken={openHolder}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('groups.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) => (
          <GroupPanel
            key={row.id}
            row={row}
            columns={columns}
            years={years.data?.years ?? []}
            classes={classes.data?.classes ?? []}
            subjects={subjects.data?.subjects ?? []}
            canEdit={canEdit}
            canArchive={canArchive}
          />
        )}
      />
    </>
  );
}
