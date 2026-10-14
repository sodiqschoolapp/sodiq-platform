import {
  classDisplayName,
  listName,
  PERMISSIONS,
  permits,
  type UnplacedStudent,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField, SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage, type BulkAction } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { invalidateStudents, studentsQuery } from '@/features/people/people-api';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { refusedNames } from './class-members';
import {
  groupsQuery,
  invalidateGroups,
  placeAutomatically,
  placeInGroup,
  placementBoardQuery,
} from './groups-api';

/** What a placement of the screen did: how many students went in, or the failure. */
type Outcome = { kind: 'placed' | 'automatic'; count: number } | { kind: 'failed'; error: unknown };

/**
 * The bulk placement screen (`05`: "A bulk screen places students ... into
 * groups for one subject and one grade, or one pair of grades, at a time";
 * task 3.2b, decision 14 with corrections 1 and 2 of the review of #92): the
 * groups of the subject that draw only from classes of the grades chosen,
 * with their members and free seats, beside the list of students not yet
 * placed on the date; ticked students go into a chosen group, or every
 * student into the smallest suitable group with "Place automatically".
 */
export function GroupPlacementPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/groups/placement' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const canEdit = role !== null && permits(PERMISSIONS, role, 'groups', 'edit');
  const groups = useQuery(groupsQuery(branchId));
  // Today in the branch, as the student list reads it: the date's default.
  const students = useQuery(studentsQuery(branchId));
  const [subjectId, setSubjectId] = useState('');
  const [gradesText, setGradesText] = useState('');
  const [typedOn, setTypedOn] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const on = typedOn ?? students.data?.today ?? '';

  // The subjects of the active groups, and for the subject chosen the grades
  // and pairs of grades its groups are of: what the screen can show.
  const active = (groups.data?.groups ?? []).filter(
    (one) => !one.archived && one.yearStatus !== 'closed',
  );
  const subjects = [...new Map(active.map((one) => [one.subject.id, one.subject.names]))].map(
    ([value, names]) => ({ value, label: nameOf(names, language) }),
  );
  // The first subject and its first grades are chosen until the person chooses.
  const shownSubject = subjects.some((one) => one.value === subjectId)
    ? subjectId
    : (subjects[0]?.value ?? '');
  const gradeOptions = [
    ...new Set(
      active
        .filter((one) => one.subject.id === shownSubject)
        .flatMap((one) => [...one.grades.map(String), one.grades.join(',')]),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const shownGrades = gradeOptions.includes(gradesText) ? gradesText : (gradeOptions[0] ?? '');

  const grades = shownGrades === '' ? [] : shownGrades.split(',').map(Number);
  const board = useQuery(placementBoardQuery(branchId, shownSubject, grades, on));
  const refresh = () =>
    Promise.all([invalidateGroups(queryClient), invalidateStudents(queryClient)]);
  const nameOfStudent = (id: string) => {
    const found = board.data?.unplaced.find((one) => one.id === id);
    return found === undefined ? undefined : listName(found);
  };

  const place = useMutation({
    mutationFn: (input: { groupId: string; rows: UnplacedStudent[] }) =>
      placeInGroup(input.groupId, {
        students: input.rows.map((row) => ({ id: row.id })),
        from: on,
      }),
    onSuccess: (_answer, input) => {
      setOutcome({ kind: 'placed', count: input.rows.length });
    },
    onError: (error) => {
      setOutcome({ kind: 'failed', error });
    },
    onSettled: refresh,
  });
  const automatic = useMutation({
    mutationFn: async () => {
      const count = board.data?.unplaced.length ?? 0;
      const go = await confirm({
        title: t('groups.placement.automaticTitle'),
        text: t('groups.placement.automaticText', { count, n: number.format(count) }),
        names: (board.data?.unplaced ?? []).map((one) => listName(one)),
        action: t('groups.placement.automatic'),
      });
      return go ? placeAutomatically({ subjectId: shownSubject, grades, from: on }) : null;
    },
    onSuccess: (answer) => {
      if (answer !== null) {
        setOutcome({ kind: 'automatic', count: answer.placed.length });
      }
    },
    onError: (error) => {
      setOutcome({ kind: 'failed', error });
    },
    onSettled: refresh,
  });

  const columns = useMemo(
    (): Column<UnplacedStudent>[] => [
      {
        key: 'uid',
        header: t('people.students.uid'),
        cell: (row) => row.uid,
        sortValue: (row) => row.uid,
        searchText: (row) => row.uid,
      },
      {
        key: 'name',
        header: t('groups.placement.student'),
        cell: (row) => listName(row),
        sortValue: (row) => `${row.lastName} ${row.firstName}`,
        searchText: (row) => listName(row),
        opens: true,
      },
      {
        key: 'class',
        header: t('groups.placement.class'),
        cell: (row) => classDisplayName(row.class.grade, row.class.name),
        sortValue: (row) => `${String(row.class.grade).padStart(2, '0')} ${row.class.name}`,
        searchText: (row) => classDisplayName(row.class.grade, row.class.name),
      },
    ],
    [t],
  );

  const bulkActions = useMemo(
    (): BulkAction<UnplacedStudent>[] =>
      canEdit
        ? (board.data?.groups ?? []).map((group) => ({
            key: `place:${group.id}`,
            label: t('groups.placement.putInto', { group: group.name }),
            run: (rows: UnplacedStudent[]) => {
              setOutcome(null);
              place.mutate({ groupId: group.id, rows });
            },
          }))
        : [],
    [board.data, canEdit, place, t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/groups/placement', search: next, replace: how === 'replace' });
  };

  const header = (
    <PageHeader
      title={t('groups.placement.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('classes.title'), to: '/classes' },
        { label: t('groups.title'), to: '/groups' },
      ]}
      actions={
        <Link to="/groups" className="text-link">
          {t('groups.title')}
        </Link>
      }
    />
  );

  if (groups.isError || students.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={groups.error ?? students.error}
          onRetry={() => {
            void groups.refetch();
            void students.refetch();
          }}
        />
      </>
    );
  }
  if (groups.data === undefined || students.data === undefined) {
    return (
      <>
        {header}
        <LoadingOutline lines={4} />
      </>
    );
  }

  const failedNames = outcome?.kind === 'failed' ? refusedNames(outcome.error, nameOfStudent) : [];

  return (
    <>
      {header}
      <div className={`${PANEL} mb-4 grid gap-4 p-4 sm:grid-cols-3`}>
        <SelectField
          label={t('groups.placement.subject')}
          value={shownSubject}
          onChange={(event) => {
            setSubjectId(event.target.value);
            setGradesText('');
            setOutcome(null);
          }}
          options={subjects}
        />
        <SelectField
          label={t('groups.placement.grades')}
          value={shownGrades}
          disabled={shownSubject === ''}
          onChange={(event) => {
            setGradesText(event.target.value);
            setOutcome(null);
          }}
          options={[
            ...gradeOptions.map((value) => {
              const [a, b] = value.split(',').map(Number);
              return {
                value,
                label:
                  b === undefined
                    ? t('groups.placement.gradeOne', { grade: number.format(a ?? 0) })
                    : t('groups.placement.gradePair', {
                        a: number.format(a ?? 0),
                        b: number.format(b),
                      }),
              };
            }),
          ]}
        />
        <DateField
          label={t('groups.placement.on')}
          value={on}
          onChange={(event) => {
            setTypedOn(event.target.value);
            setOutcome(null);
          }}
        />
      </div>
      {outcome !== null && outcome.kind !== 'failed' && (
        <p role="status" className="mb-3 text-sm">
          {outcome.kind === 'placed'
            ? t('groups.placed', { count: outcome.count, n: number.format(outcome.count) })
            : t('groups.placement.placedAutomatically', {
                count: outcome.count,
                n: number.format(outcome.count),
              })}
        </p>
      )}
      {outcome?.kind === 'failed' && (
        <div className="mb-3 grid gap-2">
          <FailureAlert error={outcome.error} />
          {failedNames.length > 0 && (
            <p className="text-sm">{t('groups.refusedNames', { names: failedNames.join(', ') })}</p>
          )}
        </div>
      )}
      {shownSubject === '' || shownGrades === '' ? (
        <EmptyState title={t('groups.emptyTitle')} text={t('groups.empty')} />
      ) : board.isError ? (
        <ErrorState
          error={board.error}
          onRetry={() => {
            void board.refetch();
          }}
        />
      ) : board.data === undefined ? (
        <LoadingOutline lines={4} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="grid gap-3">
            {canEdit && board.data.unplaced.length > 0 && board.data.groups.length > 0 && (
              <div>
                <Button
                  disabled={automatic.isPending}
                  onClick={() => {
                    setOutcome(null);
                    automatic.mutate();
                  }}
                >
                  {t('groups.placement.automatic')}
                </Button>
              </div>
            )}
            <ListPage
              listId="group-placement"
              caption={t('groups.placement.caption')}
              rows={board.data.unplaced}
              rowId={(row) => row.id}
              rowName={(row) => listName(row)}
              columns={columns}
              search={search}
              onSearchChange={open}
              bulkActions={bulkActions}
              empty={{
                title: t('groups.placement.emptyTitle'),
                text: t('groups.placement.empty'),
              }}
              panel={(row) => (
                <dl className="grid gap-3">
                  {(
                    [
                      [t('people.students.uid'), row.uid],
                      [
                        t('groups.placement.class'),
                        classDisplayName(row.class.grade, row.class.name),
                      ],
                      [t('groups.from'), schoolDateText(row.classFrom, language)],
                    ] as const
                  ).map(([term, value]) => (
                    <div key={term} className="grid gap-0.5">
                      <dt className="text-sm text-muted-foreground">{term}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            />
          </div>
          <section className={`${PANEL} grid content-start gap-3 p-4`}>
            <h2 className={SECTION_TITLE}>{t('groups.placement.groups')}</h2>
            {board.data.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('groups.placement.noGroups')}</p>
            ) : (
              <ul className="grid gap-2">
                {board.data.groups.map((group) => (
                  <li key={group.id} className="grid gap-0.5 text-sm">
                    <span className="font-semibold">{group.name}</span>
                    <span className="text-muted-foreground">
                      {group.classes.map((one) => classDisplayName(one.grade, one.name)).join(', ')}
                    </span>
                    <span className="text-muted-foreground">
                      {t('groups.placement.groupLine', {
                        members: number.format(group.members),
                        max: number.format(group.maxSize),
                        free: number.format(group.free),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
