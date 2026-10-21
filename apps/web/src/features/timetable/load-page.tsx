import {
  classDisplayName,
  PERMISSIONS,
  permits,
  type LoadRow,
  type LoadRowEdit,
  type LoadRowRecord,
  type TimetableVersion,
  type TimetableVersionCreate,
  type TimetableVersionEdit,
  type WithdrawBody,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { useNewRecord } from '@/components/list/use-new-record';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { ApiFailure } from '@/api/failure';
import { useView } from '@/features/access/use-view';
import { classesQuery } from '@/features/classes/classes-api';
import { groupsQuery } from '@/features/classes/groups-api';
import { nameOf, roomsQuery, yearsQuery } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { schoolDateText } from '@/lib/dates';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { LoadRowForm } from './load-row-form';
import { ruleText } from './rule-text';
import { LoadRowPanel } from './load-row-panel';
import { LoadTotalsSection } from './load-totals';
import { EditLockBanner, useEditLock } from './edit-lock';
import {
  createLoadRow,
  createVersion,
  editVersion,
  invalidateTimetable,
  loadQuery,
  versionsQuery,
  withdrawVersion,
} from './timetable-api';
import { comingQuarterStarts, NewDraftForm, StartForm } from './version-form';
import { WithdrawDialog } from './withdraw-dialog';

/** The refusals of a withdraw's sorting (task 5.6a-5b-2), named as the publish names them. */
const DAY_REFUSALS = [
  'day_change_undecided',
  'day_decision_unknown',
  'day_changes_changed',
  'day_choice_not_offered',
] as const;

const isDayRefusal = (code: string): code is (typeof DAY_REFUSALS)[number] =>
  (DAY_REFUSALS as readonly string[]).includes(code);

/** The class or group of a row as a person reads it: "7 Oxford", or the group's name. */
const unitText = (row: LoadRow): string =>
  row.unit.kind === 'class'
    ? classDisplayName(row.unit.grades[0] ?? 0, row.unit.name)
    : row.unit.name;

/**
 * The teaching load of a timetable version (`05`, Teaching load; `06`,
 * Building a timetable, steps 1 and 2; `edge/timetable`, Versions and drafts;
 * task 3.4a). The version picker, "New draft" (empty or a copy of a version of
 * the same year), the rows a copy left with their reasons (decision 10), and
 * the rows as a list with the problems each has today (decision 3). Only a
 * draft of an open year is changed; the Principal reads (decision 4). Task
 * 3.4b: the block of each group row, students not placed, and the weekly
 * totals below the rows.
 */
export function LoadPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/timetable/load' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const newRecord = useNewRecord();
  const [drafting, setDrafting] = useState(false);
  const [changingStart, setChangingStart] = useState(false);
  const language = i18n.language;
  const wide = useMinWidth(SM);
  const can = (action: 'create' | 'edit' | 'archive') =>
    role !== null && permits(PERMISSIONS, role, 'timetable', action);
  const versions = useQuery(versionsQuery(branchId));
  const list = versions.data?.versions ?? [];
  const chosen: TimetableVersion | undefined =
    list.find((one) => one.id === search.version) ??
    list.find((one) => one.status === 'draft') ??
    list[0];
  const load = useQuery(loadQuery(branchId, chosen?.id ?? null));
  const writable = chosen?.status === 'draft' && chosen.yearStatus !== 'closed';
  // Task 5.4c-1: every write of the draft takes its edit lock; while another person edits, the load is read.
  const editLock = useEditLock(
    writable ? chosen : undefined,
    writable && (can('edit') || can('create') || can('archive')),
  );
  const free = writable && !editLock.othersEditing;
  const canEdit = free && can('edit');
  const canCreate = free && can('create');
  const canDelete = free && can('archive');
  // The forms' lists: read only by those who change the load.
  const editor = can('create') || can('edit');
  const years = useQuery({ ...yearsQuery(branchId), enabled: branchId !== null && editor });
  const classes = useQuery({ ...classesQuery(branchId), enabled: branchId !== null && editor });
  const groups = useQuery({ ...groupsQuery(branchId), enabled: branchId !== null && editor });
  const subjects = useQuery({ ...subjectsQuery(branchId), enabled: branchId !== null && editor });
  const rooms = useQuery({ ...roomsQuery(branchId), enabled: branchId !== null && editor });
  const openYears = (years.data?.years ?? []).filter((year) => year.status !== 'closed');
  const formsError =
    years.error ?? classes.error ?? groups.error ?? subjects.error ?? rooms.error ?? null;
  const formsLoading =
    editor &&
    (years.data === undefined ||
      classes.data === undefined ||
      groups.data === undefined ||
      subjects.data === undefined ||
      rooms.data === undefined);

  const refresh = () => invalidateTimetable(queryClient);
  const draft = useMutation({
    mutationFn: (record: TimetableVersionCreate) => createVersion(record),
    onSuccess: async (created) => {
      await refresh();
      setDrafting(false);
      void navigate({ to: '/timetable/load', search: { version: created.id } });
    },
  });
  const start = useMutation({
    mutationFn: (edit: TimetableVersionEdit) => editVersion(chosen?.id ?? '', edit),
    onSuccess: async () => {
      await refresh();
      setChangingStart(false);
    },
  });
  const dismiss = useMutation({
    mutationFn: () => editVersion(chosen?.id ?? '', { dismissLeftRows: true }),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: (record: LoadRowRecord) => createLoadRow(chosen?.id ?? '', record),
    onSuccess: refresh,
  });
  // Task 5.5c-2a: one key per withdraw asked, so a repeat of the same click is harmless.
  const withdrawKey = useRef<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<TimetableVersion | null>(null);
  const withdraw = useMutation({
    mutationFn: ({ versionId, body }: { versionId: string; body: WithdrawBody }) => {
      withdrawKey.current ??= crypto.randomUUID();
      return withdrawVersion(versionId, withdrawKey.current, body);
    },
    onSuccess: async () => {
      withdrawKey.current = null;
      await refresh();
    },
    onError: async () => {
      withdrawKey.current = null;
      await refresh();
    },
  });

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({
      to: '/timetable/load',
      search: { ...next, ...(chosen === undefined ? {} : { version: chosen.id }) },
      replace: how === 'replace',
    });
  };

  // Task 3.4b: students not placed are named with their count (decision 4).
  const problemsText = (row: LoadRow): string =>
    row.problems.length === 0
      ? t('timetable.load.none')
      : row.problems
          .map((code) =>
            // Issue #105, H9: the number of students said once, not after the general text.
            code === 'load_group_gaps' && row.unplaced > 0
              ? t('timetable.load.unplacedStudents', {
                  count: row.unplaced,
                  n: new Intl.NumberFormat(language).format(row.unplaced),
                })
              : t(`timetable.load.problems.${code}`),
          )
          .join(', ');

  const columns = useMemo(
    (): Column<LoadRow>[] => [
      {
        key: 'unit',
        header: t('timetable.load.columns.unit'),
        cell: (row) => unitText(row),
        sortValue: (row) => `${String(row.unit.grades[0] ?? 0).padStart(2, '0')} ${row.unit.name}`,
        searchText: (row) => unitText(row),
        opens: true,
      },
      {
        // Task 3.4b: the parts of a group row's block, by group name.
        key: 'block',
        header: t('timetable.load.blockColumn'),
        cell: (row) =>
          row.block.length === 0
            ? t('timetable.load.blockNone')
            : row.block.map((part) => part.name).join(', '),
        sortValue: (row) => row.block.map((part) => part.name).join(', '),
      },
      {
        key: 'subject',
        header: t('timetable.load.columns.subject'),
        cell: (row) => nameOf(row.subject.names, language),
        sortValue: (row) => nameOf(row.subject.names, language),
        searchText: (row) => nameOf(row.subject.names, language),
      },
      {
        key: 'teacher',
        header: t('timetable.load.columns.teacher'),
        cell: (row) => {
          const name = row.teacher.name ?? t('timetable.load.gone');
          return row.teacher.kind === 'vacancy'
            ? t('timetable.load.vacancyOption', { name })
            : name;
        },
        sortValue: (row) => row.teacher.name ?? '',
        searchText: (row) => row.teacher.name ?? '',
      },
      {
        key: 'lessons',
        header: t('timetable.load.columns.lessons'),
        cell: (row) => new Intl.NumberFormat(language).format(row.lessonsPerWeek),
        sortValue: (row) => row.lessonsPerWeek,
        numeric: true,
      },
      {
        key: 'room',
        header: t('timetable.load.columns.room'),
        cell: (row) =>
          row.room !== null
            ? row.room.name
            : row.roomType !== null
              ? t('timetable.load.roomTypeOption', {
                  type: t(`setup.rooms.types.${row.roomType}`),
                })
              : t('timetable.load.noRoom'),
        sortValue: (row) => row.room?.name ?? row.roomType ?? '',
      },
      {
        key: 'double',
        header: t('timetable.load.columns.double'),
        cell: (row) => (row.doubleLessons ? t('timetable.load.yes') : t('timetable.load.no')),
        sortValue: (row) => (row.doubleLessons ? 1 : 0),
      },
      {
        key: 'problems',
        header: t('timetable.load.columns.problems'),
        cell: (row) =>
          row.problems.length === 0 ? (
            problemsText(row)
          ) : (
            <span className="font-semibold text-destructive">{problemsText(row)}</span>
          ),
        sortValue: (row) => row.problems.length,
      },
    ],
    // `problemsText` reads only `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, language],
  );

  const filters = useMemo((): Filter<LoadRow>[] => {
    const rows = load.data?.rows ?? [];
    const options = (pairs: [string, string][]) =>
      [...new Map(pairs)].map(([value, label]) => ({ value, label }));
    return [
      {
        key: 'unit',
        label: t('timetable.load.unit'),
        options: options(rows.map((row) => [row.unit.id, unitText(row)])),
        matches: (row, value) => row.unit.id === value,
      },
      {
        key: 'subject',
        label: t('timetable.load.subject'),
        options: options(rows.map((row) => [row.subject.id, nameOf(row.subject.names, language)])),
        matches: (row, value) => row.subject.id === value,
      },
      {
        key: 'teacher',
        label: t('timetable.load.teacher'),
        options: options(
          rows.map((row) => [row.teacher.id, row.teacher.name ?? t('timetable.load.gone')]),
        ),
        matches: (row, value) => row.teacher.id === value,
      },
      {
        key: 'problems',
        label: t('timetable.load.withProblems'),
        options: [
          { value: 'with', label: t('timetable.load.hasProblems') },
          { value: 'without', label: t('timetable.load.noProblems') },
        ],
        matches: (row, value) => (value === 'with') === row.problems.length > 0,
      },
    ];
  }, [t, language, load.data]);

  const versionLabel = (one: TimetableVersion) =>
    t('timetable.load.versionOption', {
      number: one.number,
      year: one.yearName,
      // Task 5.5a-1, decision 4: a draft that a publish marked says so.
      status: one.outOfDate
        ? t('timetable.load.statuses.outOfDate')
        : t(`timetable.load.statuses.${one.status}`),
    });

  const header = (
    <PageHeader
      title={t('timetable.load.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('timetable.title'), to: '/timetable' },
      ]}
      actions={
        can('create') &&
        !drafting && (
          <div className="flex flex-wrap items-center gap-3">
            {canCreate && newRecord.value === null && (
              <Button
                id={newRecord.buttonId}
                disabled={formsLoading}
                onClick={() => {
                  newRecord.start(true);
                }}
              >
                {t('timetable.load.add')}
              </Button>
            )}
            <Button
              variant={canCreate ? 'secondary' : 'default'}
              disabled={formsLoading || openYears.length === 0}
              onClick={() => {
                setDrafting(true);
              }}
            >
              {t('timetable.load.newDraft')}
            </Button>
            {years.data !== undefined && openYears.length === 0 && (
              <span className="text-sm text-muted-foreground">{t('timetable.load.noYear')}</span>
            )}
          </div>
        )
      }
    />
  );

  const draftForm = drafting && versions.data !== undefined && (
    <section className={`${PANEL} grid max-w-xl gap-4 p-6`}>
      <h2 className={SECTION_TITLE}>{t('timetable.load.newDraftTitle')}</h2>
      <NewDraftForm
        years={openYears}
        versions={list}
        today={versions.data.today}
        onSave={async (record) => {
          await draft.mutateAsync(record);
        }}
        onCancel={() => {
          setDrafting(false);
        }}
      />
    </section>
  );

  if (versions.isError || formsError !== null) {
    return (
      <>
        {header}
        <ErrorState
          error={versions.error ?? formsError}
          onRetry={() => {
            void versions.refetch();
            void years.refetch();
            void classes.refetch();
            void groups.refetch();
            void subjects.refetch();
            void rooms.refetch();
          }}
        />
      </>
    );
  }
  if (versions.data === undefined) {
    return (
      <>
        {header}
        <LoadingOutline lines={6} />
      </>
    );
  }
  if (chosen === undefined) {
    return (
      <>
        {header}
        {draftForm || (
          <EmptyState
            title={t('timetable.load.noVersionTitle')}
            text={can('create') ? t('timetable.load.noVersion') : t('timetable.load.noVersionRead')}
          />
        )}
      </>
    );
  }

  // Task 5.5c-2a: a published version not started, in a year not closed;
  // the server decides (`withdraw_started`), this only offers the button.
  const withdrawable =
    can('edit') &&
    chosen.status === 'published' &&
    chosen.yearStatus !== 'closed' &&
    chosen.startsOn > versions.data.today;
  // Decision 3: the published version with the latest start before it, a tie to the higher number.
  const earlierOf = (one: TimetableVersion) =>
    list
      .filter(
        (other) =>
          other.status === 'published' &&
          other.academicYearId === one.academicYearId &&
          other.startsOn < one.startsOn,
      )
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn) || b.number - a.number)[0];
  // Task 5.5c-2a: asks first, naming the version and the one that runs again;
  // task 5.6a-5b-2: with the one-day changes of its dates and their choices.
  const withdrawDialog =
    withdrawing === null
      ? null
      : (() => {
          const earlier = earlierOf(withdrawing);
          const date = schoolDateText(withdrawing.startsOn, language);
          return (
            <WithdrawDialog
              branchId={branchId}
              versionId={withdrawing.id}
              title={t('timetable.load.withdrawTitle', { number: withdrawing.number })}
              text={
                earlier === undefined
                  ? t('timetable.load.withdrawTextNone', { date })
                  : t('timetable.load.withdrawText', { date, earlier: earlier.number })
              }
              name={versionLabel(withdrawing)}
              action={t('timetable.load.withdraw')}
              onClose={() => {
                setWithdrawing(null);
              }}
              onWithdraw={(body) => {
                setWithdrawing(null);
                withdraw.mutate({ versionId: withdrawing.id, body });
              }}
            />
          );
        })();
  const rowName = (row: LoadRow) => `${unitText(row)}, ${nameOf(row.subject.names, language)}`;
  const leftRows = load.data?.leftRows ?? [];
  // Task 5.8a: the lessons a copy did not keep go with the rows it left.
  const leftBlocks = load.data?.version.leftBlocks ?? 0;
  const leftNames = [
    ...leftRows.map((row) => rowName(row)),
    ...(leftBlocks === 0 ? [] : [t('timetable.load.leftLessons', { count: leftBlocks })]),
  ];

  return (
    <>
      {header}
      {withdrawDialog}
      {editLock.othersEditing && (
        <div className="mb-6">
          <EditLockBanner version={chosen} take={editLock.take} />
        </div>
      )}
      {draftForm}
      <section className={`${PANEL} grid gap-4 p-6`}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-64">
            <SelectField
              label={t('timetable.load.version')}
              name="version"
              value={chosen.id}
              options={list.map((one) => ({ value: one.id, label: versionLabel(one) }))}
              onChange={(event) => {
                void navigate({ to: '/timetable/load', search: { version: event.target.value } });
              }}
            />
          </div>
          <p className="flex flex-wrap gap-x-4 text-sm">
            <span>
              {t('timetable.load.startsOnText', {
                date: schoolDateText(chosen.startsOn, language),
              })}
            </span>
            {chosen.fromVersion !== null && (
              <span>{t('timetable.load.fromVersion', { number: chosen.fromVersion.number })}</span>
            )}
            {!writable && <span>{t('timetable.load.readOnly')}</span>}
          </p>
          {canEdit && !changingStart && (
            <Button
              variant="secondary"
              onClick={() => {
                setChangingStart(true);
              }}
            >
              {t('timetable.load.changeStart')}
            </Button>
          )}
          {withdrawable && (
            <Button
              variant="destructive"
              disabled={withdraw.isPending}
              onClick={() => {
                setWithdrawing(chosen);
              }}
            >
              {t('timetable.load.withdraw')}
            </Button>
          )}
        </div>
        {withdraw.error !== null && (
          <div className="grid gap-2" data-withdraw-failure="true">
            <FailureAlert error={withdraw.error} />
            {withdraw.error instanceof ApiFailure && withdraw.error.code === 'withdraw_blocked' && (
              <ul className="grid gap-1 text-sm">
                {(withdraw.error.details ?? []).map((detail, index) => (
                  <li key={`${detail.path}-${String(index)}`}>
                    {isDayRefusal(detail.code)
                      ? // Task 5.6a-5b-2: a reason of the sorting, as the publish names it.
                        t(`timetable.publish.refusals.${detail.code}`)
                      : t('timetable.load.withdrawBlocked', {
                          date:
                            detail.day === undefined
                              ? t('timetable.load.everyWeek')
                              : schoolDateText(detail.day, language),
                          rule: ruleText(t, detail.path.split('.').at(-1) ?? ''),
                        })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {changingStart && (
          <div className="max-w-xl">
            <StartForm
              key={chosen.id}
              version={chosen}
              quarterStarts={comingQuarterStarts(
                years.data?.years.find((year) => year.id === chosen.academicYearId),
                versions.data.today,
              )}
              onSave={async (edit) => {
                await start.mutateAsync(edit);
              }}
              onCancel={() => {
                setChangingStart(false);
              }}
            />
          </div>
        )}
      </section>
      {(leftRows.length > 0 || leftBlocks > 0) && (
        <section aria-labelledby="left-rows" className={`${PANEL} grid gap-3 p-6`}>
          <h2 id="left-rows" className={SECTION_TITLE}>
            {t('timetable.load.leftTitle')}
          </h2>
          <ul className="grid gap-2">
            {leftRows.map((row) => (
              <li key={row.id} data-left-row="">
                <span className="font-semibold">{rowName(row)}</span>
                {' · '}
                {columns.find((column) => column.key === 'teacher')?.cell(row)}
                {' · '}
                <span className="text-destructive">{problemsText(row)}</span>
              </li>
            ))}
          </ul>
          {leftBlocks > 0 && (
            <p className="text-sm" data-left-lessons="">
              {t('timetable.load.leftLessons', { count: leftBlocks })}
            </p>
          )}
          {canEdit && (
            <div>
              <Button
                variant="secondary"
                disabled={dismiss.isPending}
                onClick={() => {
                  void (async () => {
                    if (
                      await confirm({
                        title: t('timetable.load.dismissTitle'),
                        text: t('timetable.load.dismissText'),
                        names: leftNames,
                        action: t('timetable.load.dismiss'),
                      })
                    ) {
                      dismiss.mutate();
                    }
                  })();
                }}
              >
                {t('timetable.load.dismiss')}
              </Button>
            </div>
          )}
          {dismiss.error !== null && <FailureAlert error={dismiss.error} />}
        </section>
      )}
      <ListPage
        listId="teaching-load"
        caption={t('timetable.load.caption')}
        rows={load.data?.rows}
        error={load.error ?? undefined}
        onRetry={() => {
          void load.refetch();
        }}
        rowId={(row) => row.id}
        rowName={rowName}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        // Issue #105, H21: below 640 px one card per row (as the classes),
        // never a table wider than the phone.
        view={
          wide
            ? undefined
            : ({ rows, open: openRow }) => (
                <ul className="grid gap-3">
                  {rows.map((row) => {
                    const cell = (key: string) =>
                      columns.find((column) => column.key === key)?.cell(row);
                    return (
                      <li key={row.id} data-load-card="" className={`${PANEL} grid gap-2 p-4`}>
                        <button
                          type="button"
                          className="text-link justify-self-start"
                          onClick={() => {
                            openRow(row.id);
                          }}
                        >
                          {unitText(row)}
                        </button>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          {(
                            [
                              ['subject', t('timetable.load.columns.subject')],
                              ['teacher', t('timetable.load.columns.teacher')],
                              ['lessons', t('timetable.load.columns.lessons')],
                              ['problems', t('timetable.load.columns.problems')],
                              ['block', t('timetable.load.blockColumn')],
                              ['room', t('timetable.load.columns.room')],
                              ['double', t('timetable.load.columns.double')],
                            ] as const
                          ).map(([key, term]) => (
                            <div key={key} className="grid gap-0.5">
                              <dt className="text-muted-foreground">{term}</dt>
                              <dd>{cell(key)}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              )
        }
        empty={{
          title: t('timetable.load.emptyTitle'),
          text: t('timetable.load.empty'),
          action:
            canCreate && newRecord.value === null ? (
              <Button
                // Issue #105, H19: the empty page's first action is primary.
                disabled={formsLoading}
                onClick={() => {
                  newRecord.start(true);
                }}
              >
                {t('timetable.load.add')}
              </Button>
            ) : undefined,
        }}
        creating={
          newRecord.value === null
            ? undefined
            : {
                key: `row-${chosen.id}`,
                title: t('timetable.load.newRow'),
                content: ({ saved, close }) => (
                  <div className="grid gap-4">
                    <LoadRowForm
                      version={chosen}
                      row={null}
                      classes={classes.data?.classes ?? []}
                      groups={groups.data?.groups ?? []}
                      subjects={subjects.data?.subjects ?? []}
                      rooms={rooms.data?.rooms ?? []}
                      label={t('timetable.load.newRow')}
                      onSave={async (record: LoadRowRecord | LoadRowEdit) => {
                        if ('subjectId' in record) {
                          saved((await create.mutateAsync(record)).id);
                        }
                      }}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('timetable.load.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) => (
          <LoadRowPanel
            key={row.id}
            version={chosen}
            row={row}
            columns={columns}
            classes={classes.data?.classes ?? []}
            groups={groups.data?.groups ?? []}
            subjects={subjects.data?.subjects ?? []}
            rooms={rooms.data?.rooms ?? []}
            canEdit={canEdit}
            canDelete={canDelete}
            name={rowName(row)}
            onDeleted={() => {
              open({ ...search, open: undefined }, 'replace');
            }}
          />
        )}
      />
      <LoadTotalsSection versionId={chosen.id} />
    </>
  );
}
