import {
  CLASS_GRADES,
  classDisplayName,
  classNameKey,
  INSTRUCTION_LANGUAGES,
  PERMISSIONS,
  permits,
  type ClassCreate,
  type SchoolClass,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { ListPage } from '@/components/list/list-page';
import type { Column, Filter, ListSearch } from '@/components/list/list-state';
import { useExport } from '@/components/list/use-export';
import { useNewRecord } from '@/components/list/use-new-record';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { roomsQuery, yearsQuery } from '@/features/setup/setup-api';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { ClassForm } from './class-form';
import { ClassPanel } from './class-panel';
import { tutorName } from './class-tutors';
import { classesQuery, createClass, invalidateClasses } from './classes-api';

/**
 * The classes of the branch (`05`, Class; task 3.1a): rows, and at phone width
 * the class cards of `05` ("grade, name, language, number of students, tutor,
 * main classroom, and the current quarter's average and attendance"; the
 * figures show "—" until memberships and the journal, decision 13). A class
 * with no Tutor carries a "No Tutor" mark, and a filter finds them
 * (edge/students-classes-groups; decision 11). "New class" is switched off
 * while the branch has no planned or current year (decision 12).
 */
export function ClassesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/classes' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const newRecord = useNewRecord();
  const wide = useMinWidth(SM);
  const canCreate = role !== null && permits(PERMISSIONS, role, 'classes', 'create');
  const canEdit = role !== null && permits(PERMISSIONS, role, 'classes', 'edit');
  const canArchive = role !== null && permits(PERMISSIONS, role, 'classes', 'archive');
  const canExport = role !== null && permits(PERMISSIONS, role, 'classes', 'export');
  const exporter = useExport<SchoolClass>('classes', (row) => row.id);
  const classes = useQuery(classesQuery(branchId));
  // The years and rooms of the forms: read only by those who change classes.
  const years = useQuery({ ...yearsQuery(branchId), enabled: branchId !== null && canEdit });
  const rooms = useQuery({ ...roomsQuery(branchId), enabled: branchId !== null && canEdit });
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const openYears = (years.data?.years ?? []).filter((year) => year.status !== 'closed');
  const noYear = years.data !== undefined && openYears.length === 0;

  const create = useMutation({
    mutationFn: (record: ClassCreate) => createClass(record),
    onSuccess: () => invalidateClasses(queryClient),
  });

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/classes', search: next, replace: how === 'replace' });
  };

  const tutorCell = useCallback(
    (row: SchoolClass) =>
      row.tutor === null ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap" data-no-tutor="">
          <WarningIcon aria-hidden className="size-4" />
          {t('classes.noTutor')}
        </span>
      ) : (
        tutorName(t, row.tutor)
      ),
    [t],
  );

  const columns = useMemo(
    (): Column<SchoolClass>[] => [
      {
        key: 'name',
        header: t('classes.name'),
        cell: (row) => classDisplayName(row.grade, row.name),
        sortValue: (row) => `${String(row.grade).padStart(2, '0')} ${classNameKey(row.name)}`,
        searchText: (row) => classDisplayName(row.grade, row.name),
        // Correction 6: the search compares the same fold as the unique name.
        searchFold: classNameKey,
        opens: true,
      },
      {
        key: 'year',
        header: t('classes.year'),
        cell: (row) => row.yearName,
        sortValue: (row) => row.yearName,
        narrow: true,
      },
      {
        key: 'language',
        header: t('classes.language'),
        cell: (row) => t(`people.staff.languages.${row.language}`),
        sortValue: (row) => row.language,
      },
      {
        key: 'tutor',
        header: t('classes.tutor'),
        cell: tutorCell,
        sortValue: (row) => (row.tutor === null ? null : tutorName(t, row.tutor)),
        searchText: (row) => (row.tutor === null ? '' : tutorName(t, row.tutor)),
      },
      {
        key: 'mainRoom',
        header: t('classes.mainRoom'),
        cell: (row) =>
          row.mainRoom === null
            ? t('classes.noRoom')
            : row.mainRoom.status === 'closed'
              ? t('classes.closedRoom', { room: row.mainRoom.name })
              : row.mainRoom.name,
        sortValue: (row) => row.mainRoom?.name ?? null,
        narrow: true,
      },
      {
        key: 'maxSize',
        header: t('classes.maxSize'),
        cell: (row) => number.format(row.maxSize),
        sortValue: (row) => row.maxSize,
        numeric: true,
      },
      {
        key: 'status',
        header: t('classes.status'),
        cell: (row) => (row.archived ? t('classes.archived') : t('classes.active')),
        sortValue: (row) => (row.archived ? 1 : 0),
      },
    ],
    [t, number, tutorCell],
  );

  const filters = useMemo((): Filter<SchoolClass>[] => {
    const yearOptions = [
      ...new Map((classes.data?.classes ?? []).map((row) => [row.academicYearId, row.yearName])),
    ].map(([value, label]) => ({ value, label }));
    return [
      {
        key: 'grade',
        label: t('classes.grade'),
        options: CLASS_GRADES.map((grade) => ({
          value: String(grade),
          label: t('classes.gradeOption', { grade: number.format(grade) }),
        })),
        matches: (row, value) => String(row.grade) === value,
      },
      {
        key: 'language',
        label: t('classes.language'),
        options: INSTRUCTION_LANGUAGES.map((language) => ({
          value: language,
          label: t(`people.staff.languages.${language}`),
        })),
        matches: (row, value) => row.language === value,
      },
      {
        key: 'year',
        label: t('classes.year'),
        options: yearOptions,
        matches: (row, value) => row.academicYearId === value,
      },
      {
        key: 'tutor',
        label: t('classes.tutor'),
        options: [
          { value: 'none', label: t('classes.noTutor') },
          { value: 'some', label: t('classes.withTutor') },
        ],
        matches: (row, value) => (value === 'none') === (row.tutor === null),
      },
      {
        key: 'status',
        label: t('classes.status'),
        options: [
          { value: 'active', label: t('classes.active') },
          { value: 'archived', label: t('classes.archived') },
        ],
        matches: (row, value) => (value === 'archived') === row.archived,
      },
    ];
  }, [t, number, classes.data]);

  const addButton = canCreate && newRecord.value === null && (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        id={newRecord.buttonId}
        disabled={years.data === undefined || noYear || rooms.data === undefined}
        onClick={() => {
          newRecord.start(true);
        }}
      >
        {t('classes.add')}
      </Button>
      {noYear && <span className="text-sm text-muted-foreground">{t('classes.needYear')}</span>}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('classes.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
        actions={addButton}
      />
      <ListPage
        listId="classes"
        caption={t('classes.caption')}
        rows={classes.data?.classes}
        error={classes.error ?? years.error ?? rooms.error ?? undefined}
        onRetry={() => {
          void classes.refetch();
          void years.refetch();
          void rooms.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => classDisplayName(row.grade, row.name)}
        columns={columns}
        filters={filters}
        onExport={canExport ? exporter.onExport : undefined}
        exportState={exporter.state}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('classes.emptyTitle'),
          text: noYear ? t('classes.emptyNoYear') : t('classes.empty'),
          // The header holds "New class" with its id; the empty page offers it once more.
          action:
            canCreate && newRecord.value === null && !noYear ? (
              <Button
                variant="secondary"
                disabled={years.data === undefined || rooms.data === undefined}
                onClick={() => {
                  newRecord.start(true);
                }}
              >
                {t('classes.add')}
              </Button>
            ) : undefined,
        }}
        view={
          wide
            ? undefined
            : ({ rows, open: openClass }) => (
                <ul className="grid gap-3">
                  {rows.map((row) => (
                    <li key={row.id} data-class-card="" className={`${PANEL} grid gap-2 p-4`}>
                      <button
                        type="button"
                        className="text-link justify-self-start"
                        onClick={() => {
                          openClass(row.id);
                        }}
                      >
                        {classDisplayName(row.grade, row.name)}
                      </button>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        {(
                          [
                            [t('classes.language'), t(`people.staff.languages.${row.language}`)],
                            [t('classes.students'), t('classes.notYet')],
                            [t('classes.tutor'), tutorCell(row)],
                            [
                              t('classes.mainRoom'),
                              row.mainRoom === null
                                ? t('classes.noRoom')
                                : row.mainRoom.status === 'closed'
                                  ? t('classes.closedRoom', { room: row.mainRoom.name })
                                  : row.mainRoom.name,
                            ],
                            [t('classes.average'), t('classes.notYet')],
                            [t('classes.attendance'), t('classes.notYet')],
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
                key: 'class',
                title: t('classes.newTitle'),
                content: ({ saved, close, open: openHolder }) => (
                  <div className="grid gap-4">
                    <ClassForm
                      schoolClass={null}
                      years={years.data?.years ?? []}
                      rooms={rooms.data?.rooms ?? []}
                      label={t('classes.newTitle')}
                      onSave={async (record) => {
                        if (!('version' in record)) {
                          saved((await create.mutateAsync(record)).id);
                        }
                      }}
                      onOpenTaken={openHolder}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('classes.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) => (
          <ClassPanel
            key={row.id}
            row={row}
            columns={columns}
            years={years.data?.years ?? []}
            rooms={rooms.data?.rooms ?? []}
            canEdit={canEdit}
            canArchive={canArchive}
          />
        )}
      />
    </>
  );
}
