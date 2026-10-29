import {
  CLOSING_BLOCKING,
  type ClosingChecklist,
  type ClosingDecision,
  type ClosingFlagged,
  type ClosingItem,
  type ClosingJournalDecision,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { PreparedStamp } from '@/components/prepared-stamp';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { momentText, schoolDateText } from '@/lib/dates';
import { CloseQuarterDialog } from './close-quarter-dialog';
import {
  ChangesList,
  RecalculationSection,
  ReopenDialog,
  ReopenedJournalPanel,
  ReopeningLine,
} from './reopening';
import {
  closeQuarter,
  closingQuery,
  decideJournal,
  decideResult,
  endPlanPeriods,
  invalidateClosing,
  remindTeachers,
} from './closing-api';

export type ClosingSearch = ListSearch & { quarter?: string };

export function closingSearch(search: Record<string, unknown>): ClosingSearch {
  const result: ClosingSearch = listSearch(search);
  if (typeof search.quarter === 'string' && search.quarter !== '') result.quarter = search.quarter;
  return result;
}

type Row = ClosingItem & { rowId: string };

const isBlocking = (item: ClosingItem): boolean => CLOSING_BLOCKING.includes(item.kind);

/** The separators of the parts of a line (not words of a language). */
const SEPARATOR = ' · ';
const COLON = ': ';

const studentName = (student: { firstName: string; lastName: string; uid: string }) =>
  [`${student.lastName} ${student.firstName}`, student.uid].join(SEPARATOR);

/**
 * The closing checklist of a quarter (task 9.2a, pull request #229; `07`,
 * Closing a quarter: "It lists everything unfinished, grouped by teacher and
 * class, with a link to each item and a 'remind' button"). The server lists
 * the items, decides what may be decided and works out every result.
 */
export function ClosingPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const search: ClosingSearch = useSearch({ from: '/app/results/closing' });
  const { branchId } = useView();
  const list = useQuery(closingQuery(branchId, search.quarter ?? null));
  const language = i18n.language;
  const data = list.data;
  const [remindKey, setRemindKey] = useState(() => crypto.randomUUID());
  const remind = useMutation({
    mutationFn: async (quarterId: string) => remindTeachers(quarterId, remindKey),
    onSuccess: () => {
      setRemindKey(crypto.randomUUID());
    },
  });
  // Task 9.2b: the close, one key per dialog opened.
  const [closing, setClosing] = useState<string | null>(null);
  const close = useMutation({
    mutationFn: async (input: Parameters<typeof closeQuarter>[1]) => {
      if (data?.quarterId === null || data === undefined || closing === null) return null;
      const answer = await closeQuarter(data.quarterId, input, closing);
      await invalidateClosing(queryClient);
      return answer;
    },
    onSuccess: (answer) => {
      if (answer !== null) setClosing(null);
    },
  });
  // Task 9.2c: the reopening dialog.
  const [reopening, setReopening] = useState<string | null>(null);
  const periods = data?.items.filter((item) => item.kind === 'plan_periods') ?? [];
  const endPeriods = useMutation({
    mutationFn: async (quarterId: string) => {
      const requests = periods.reduce(
        (sum, item) => sum + (item.kind === 'plan_periods' ? item.requests : 0),
        0,
      );
      const yes = await confirm({
        title: t('results.closing.endPeriodsTitle', { count: requests }),
        names: periods.map((item) => journalName(item, language)),
        action: t('results.closing.endPeriods'),
      });
      if (!yes) return null;
      const answer = await endPlanPeriods(quarterId);
      await invalidateClosing(queryClient);
      return answer;
    },
  });
  const rows = useMemo(
    (): Row[] | undefined =>
      // A closed quarter lists the warnings acknowledged at its close (`07`).
      (data?.state === 'closed' ? (data.closing?.warnings ?? []) : data?.items)?.map(
        (item, index) => ({
          ...item,
          rowId: `${item.kind}:${item.journal?.id ?? ''}:${item.teacher?.id ?? ''}:${String(index)}`,
        }),
      ),
    [data],
  );
  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'item',
        header: t('results.closing.item'),
        cell: (row) => t(`results.closing.kinds.${row.kind}`),
        sortValue: (row) => t(`results.closing.kinds.${row.kind}`),
        searchText: (row) => t(`results.closing.kinds.${row.kind}`),
        opens: true,
        fixed: true,
      },
      {
        key: 'severity',
        header: t('results.closing.severity'),
        cell: (row) =>
          isBlocking(row) ? (
            <span className="font-semibold text-destructive">{t('results.closing.blocking')}</span>
          ) : (
            t('results.closing.warning')
          ),
        sortValue: (row) => (isBlocking(row) ? 0 : 1),
      },
      {
        key: 'teacher',
        header: t('results.closing.teacher'),
        cell: (row) => row.teacher?.name ?? '—',
        sortValue: (row) => row.teacher?.name ?? null,
        searchText: (row) => row.teacher?.name ?? '',
      },
      {
        key: 'unit',
        header: t('results.closing.unit'),
        cell: (row) => row.journal?.unit.name ?? '—',
        sortValue: (row) => row.journal?.unit.name ?? null,
        searchText: (row) => row.journal?.unit.name ?? '',
      },
      {
        key: 'subject',
        header: t('results.closing.subject'),
        cell: (row) => (row.journal === null ? '—' : nameOf(row.journal.subject.names, language)),
        sortValue: (row) =>
          row.journal === null ? null : nameOf(row.journal.subject.names, language),
        searchText: (row) =>
          row.journal === null ? '' : nameOf(row.journal.subject.names, language),
      },
      {
        key: 'count',
        header: t('results.closing.count'),
        cell: (row) => countOf(row),
        sortValue: (row) => countOf(row),
        numeric: true,
      },
    ],
    [t, language],
  );

  const quarterLine =
    data === undefined
      ? null
      : data.quarterId === null
        ? t('results.closing.noQuarter')
        : data.state === 'closed' && data.closing !== null
          ? t('results.closing.closedLine', {
              date: momentText(language, data.closing.closedAt),
              name: data.closing.closedBy,
              version: data.closing.version,
            })
          : data.state === 'not_open'
            ? t('results.closing.opensOn', {
                date: schoolDateText(data.opensOn ?? '', language),
              })
            : data.earlierOpen
              ? t('results.closing.earlierOpen')
              : data.closable
                ? t('results.closing.closable')
                : t('results.closing.counts', {
                    blocking: data.blocking,
                    warnings: data.warnings,
                  });

  return (
    <>
      <PageHeader
        title={t('results.closing.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('journal.page.title'), to: '/journal' },
        ]}
        actions={
          data?.canEdit === true && data.quarterId !== null && data.state === 'open' ? (
            <span className="flex flex-wrap gap-2">
              {periods.length > 0 && (
                <Button
                  variant="secondary"
                  disabled={endPeriods.isPending}
                  onClick={() => {
                    if (data.quarterId !== null) endPeriods.mutate(data.quarterId);
                  }}
                >
                  {t('results.closing.endPeriods')}
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={remind.isPending || data.items.length === 0}
                onClick={() => {
                  if (data.quarterId !== null) remind.mutate(data.quarterId);
                }}
              >
                {t('results.closing.remind')}
              </Button>
              <Button
                disabled={!data.closable || close.isPending}
                onClick={() => {
                  close.reset();
                  setClosing(crypto.randomUUID());
                }}
              >
                {t('results.closing.closeQuarter')}
              </Button>
            </span>
          ) : data?.canEdit === true && data.quarterId !== null && data.state === 'closed' ? (
            <Button variant="secondary" onClick={() => setReopening(crypto.randomUUID())}>
              {t('results.reopening.action')}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4">
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : data === undefined ? (
          <LoadingOutline />
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            {data.quarters.length > 0 && (
              <div className="w-56">
                <SelectField
                  label={t('results.closing.quarter')}
                  value={data.quarterId ?? ''}
                  options={data.quarters.map((one) => ({
                    value: one.id,
                    label: t('results.quarterNumber', { number: one.number }),
                  }))}
                  onChange={(event) => {
                    void navigate({
                      to: '/results/closing',
                      search: { quarter: event.target.value },
                    });
                  }}
                />
              </div>
            )}
            {quarterLine !== null && (
              <p className="text-sm" data-closing-state={data.state}>
                {quarterLine}
              </p>
            )}
            <PreparedStamp
              stamp={data.prepared}
              refreshing={list.isFetching}
              onRefresh={() => {
                void list.refetch();
              }}
            />
          </div>
        )}
        <FailureAlert error={remind.error ?? endPeriods.error} />
        {data?.state === 'closed' && data.closing !== null && (
          <div className="grid gap-1 text-sm" data-closing-record="true">
            {close.data !== undefined && close.data !== null && (
              <p role="status">{t('results.closing.closed', { count: close.data.stored })}</p>
            )}
            {data.closing.lockNow && <p>{t('results.closing.closedLockNow')}</p>}
            {data.closing.startQuarter !== null && (
              <p>{t(`results.closing.closedStart_${data.closing.startQuarter}`)}</p>
            )}
            <p className="text-muted-foreground">
              {data.closing.warnings.length > 0
                ? t('results.closing.closedWarnings')
                : t('results.closing.closedNone')}
            </p>
          </div>
        )}
        {data?.reopening !== null && data?.reopening !== undefined && (
          <div className="grid gap-2 text-sm" data-reopened="branch">
            <ul>
              <ReopeningLine reopening={data.reopening} />
            </ul>
            <h2 className={SECTION_TITLE}>{t('results.reopening.changes')}</h2>
            <ChangesList changes={data.changes} />
          </div>
        )}
        {data?.state === 'closed' &&
          data.quarterId !== null &&
          data.reopenedJournals.map((journal) => (
            <ReopenedJournalPanel
              key={journal.reopening.id}
              quarterId={data.quarterId ?? ''}
              journal={journal}
              canEdit={data.canEdit}
            />
          ))}
        {data !== undefined && data.check !== null && (
          <p className="text-sm text-muted-foreground" data-check="true">
            {t('results.check.line', {
              date: momentText(language, data.check.checkedAt),
              count: data.check.journals.reduce((sum, one) => sum + one.differences, 0),
            })}
          </p>
        )}
        {data !== undefined && data.reopenings.length > 0 && (
          <details className="text-sm">
            <summary>{t('results.reopening.history', { count: data.reopenings.length })}</summary>
            <ul className="mt-2 grid gap-2">
              {data.reopenings.map((one) => (
                <ReopeningLine key={one.id} reopening={one} />
              ))}
            </ul>
          </details>
        )}
        {data?.state === 'closed' && data.quarterId !== null && (
          <RecalculationSection
            key={data.quarterId}
            quarterId={data.quarterId}
            canApply={data.canApply}
          />
        )}
        {reopening !== null && data !== undefined && (
          <ReopenDialog
            key={reopening}
            checklist={data}
            onDone={() => setReopening(null)}
            onCancel={() => setReopening(null)}
          />
        )}
        {closing !== null && data !== undefined && (
          <CloseQuarterDialog
            key={`${closing}:${JSON.stringify(data.items.map((item) => [item.kind, item.journal?.id ?? null]))}`}
            checklist={data}
            pending={close.isPending}
            error={close.error}
            onClose={(input) => close.mutate(input)}
            onCancel={() => setClosing(null)}
          />
        )}
        {remind.data !== undefined && (
          <p className="text-sm" role="status">
            {t('results.closing.reminded', { count: remind.data.sent })}
          </p>
        )}
        {data !== undefined && (
          <ListPage
            listId="results-closing"
            caption={t('results.closing.title')}
            rows={rows}
            rowId={(row) => row.rowId}
            rowName={(row) =>
              [t(`results.closing.kinds.${row.kind}`), journalName(row, language)]
                .filter((one) => one !== '')
                .join(' · ')
            }
            columns={columns}
            search={search}
            onSearchChange={(next, how) => {
              void navigate({
                to: '/results/closing',
                search: {
                  ...next,
                  ...(search.quarter === undefined ? {} : { quarter: search.quarter }),
                },
                replace: how === 'replace',
              });
            }}
            panel={(row) => <ItemPanel key={row.rowId} row={row} checklist={data} />}
            empty={{
              title: t('results.closing.title'),
              text:
                data.state === 'not_open'
                  ? t('results.closing.notOpenYet')
                  : t('results.closing.nothingLeft'),
            }}
          />
        )}
      </div>
    </>
  );
}

function journalName(item: ClosingItem, language: string): string {
  return item.journal === null
    ? ''
    : `${item.journal.unit.name} · ${nameOf(item.journal.subject.names, language)}`;
}

function countOf(item: ClosingItem): number {
  switch (item.kind) {
    case 'rating_missing':
    case 'undecided':
    case 'decision_outdated':
    case 'no_result':
      return item.students.length;
    case 'unlocked':
      return item.lessons.length + (item.rating ? 1 : 0);
    case 'edit_period':
      return item.lessons;
    case 'plan_periods':
      return item.requests;
    case 'no_attendance':
    case 'numbers_missing':
      return item.lessons.length;
    case 'plan_incomplete':
      return item.empty + item.notCovered;
    case 'plan_not_covered':
      return item.notCovered;
    case 'part_without_data':
      return item.parts.length;
    case 'no_teacher':
      return item.days.length;
    case 'check_difference':
      return item.differences;
    default:
      return 1;
  }
}

/** The details of an item, with the decisions of a flagged result. */
function ItemPanel({ row, checklist }: { row: Row; checklist: ClosingChecklist }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const quarterId = checklist.quarterId;
  return (
    <div className="grid gap-4 text-sm">
      <p>
        <span className="font-semibold">
          {isBlocking(row) ? t('results.closing.blocking') : t('results.closing.warning')}
        </span>
        {row.teacher !== null && <span className="text-muted-foreground"> {row.teacher.name}</span>}
      </p>
      {row.journal !== null && quarterId !== null && (
        <Link
          to="/journal/$journalId"
          params={{ journalId: row.journal.id }}
          search={{ quarter: quarterId }}
          className="text-link"
        >
          {t('results.closing.openJournal', { journal: journalName(row, language) })}
        </Link>
      )}
      <ItemDetails row={row} />
      {(row.kind === 'undecided' || row.kind === 'decision_outdated') &&
        row.journal !== null &&
        quarterId !== null && (
          <Decisions
            row={row}
            students={row.students}
            quarterId={quarterId}
            journalId={row.journal.id}
            subjectId={row.journal.subject.id}
            canEdit={checklist.canEdit}
          />
        )}
    </div>
  );
}

function ItemDetails({ row }: { row: Row }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const dates = (lessons: readonly { id: string; date: string }[]) => (
    <ul className="grid gap-1">
      {lessons.map((lesson) => (
        <li key={lesson.id}>{schoolDateText(lesson.date, language)}</li>
      ))}
    </ul>
  );
  switch (row.kind) {
    case 'rating_missing':
      return (
        <ul className="grid gap-1">
          {row.students.map((one) => (
            <li key={one.student.id}>
              {[
                studentName(one.student),
                ...(one.pending ? [t('results.closing.pending')] : []),
              ].join(SEPARATOR)}
            </li>
          ))}
        </ul>
      );
    case 'no_result':
      return (
        <ul className="grid gap-1">
          {row.students.map((one) => (
            <li key={one.id}>{studentName(one)}</li>
          ))}
        </ul>
      );
    case 'unlocked':
      return (
        <>
          {dates(row.lessons)}
          {row.rating && <p>{t('results.closing.ratingUnlocked')}</p>}
        </>
      );
    case 'no_attendance':
    case 'numbers_missing':
      return dates(row.lessons);
    case 'extension_open':
      return (
        <p>
          {t('results.closing.extension', {
            from: schoolDateText(row.fromDate, language),
            to: schoolDateText(row.toDate, language),
            until: momentText(language, row.openUntil),
          })}
        </p>
      );
    case 'edit_period':
      return (
        <p>{t('results.closing.editPeriod', { count: row.lessons, incomplete: row.incomplete })}</p>
      );
    case 'plan_periods':
      return <p>{t('results.closing.planPeriods', { count: row.requests })}</p>;
    case 'check_difference':
      return (
        <p>
          {t('results.check.difference', {
            count: row.differences,
            date: momentText(language, row.checkedAt),
          })}
        </p>
      );
    case 'plan_incomplete':
      return (
        <ul className="grid gap-1">
          <li>{t(`results.closing.planStates.${row.state}`)}</li>
          {row.empty > 0 && <li>{t('results.closing.noTopic', { count: row.empty })}</li>}
          {row.notCovered > 0 && (
            <li>{t('results.closing.notCovered', { count: row.notCovered })}</li>
          )}
          {row.belowMinimum && <li>{t('results.closing.belowMinimum')}</li>}
        </ul>
      );
    // Task 9.2d: no carry is possible: merge or drop each one.
    case 'plan_not_covered':
      return <p>{t('results.closing.notCovered', { count: row.notCovered })}</p>;
    case 'part_without_data':
      return <p>{row.parts.map((part) => t(`journal.grid.parts.${part}`)).join(', ')}</p>;
    case 'no_teacher':
      return (
        <ul className="grid gap-1">
          {row.days.map((day) => (
            <li key={day.from}>
              {t('results.closing.days', {
                from: schoolDateText(day.from, language),
                until: schoolDateText(day.until, language),
              })}
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

/** The decisions on flagged results, one by one or for the whole journal (`edge/calculation`). */
function Decisions({
  row,
  students,
  quarterId,
  journalId,
  subjectId,
  canEdit,
}: {
  row: Row;
  students: readonly ClosingFlagged[];
  quarterId: string;
  journalId: string;
  subjectId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refused, setRefused] = useState<ClosingJournalDecision['refused']>([]);
  const one = useMutation({
    mutationFn: async (input: { student: ClosingFlagged; decision: ClosingDecision | null }) => {
      await decideResult(quarterId, {
        subjectId,
        studentId: input.student.student.id,
        decision: input.decision,
        version: input.student.version,
      });
      await invalidateClosing(queryClient);
    },
  });
  const whole = useMutation({
    mutationFn: async (decision: ClosingDecision | null) => {
      const answer = await decideJournal(quarterId, journalId, {
        decision,
        students: students.map((student) => student.student.id),
      });
      setRefused(answer.refused);
      await invalidateClosing(queryClient);
      return answer;
    },
  });
  const outdated = row.kind === 'decision_outdated';
  const choices: readonly ClosingDecision[] = ['keep', 'exempt', 'not_assessed'];
  const names = new Map(students.map((student) => [student.student.id, student.student]));
  return (
    <div className="grid gap-3">
      <ul className="grid gap-3">
        {students.map((student) => (
          <li key={student.student.id} className="grid gap-1" data-student={student.student.id}>
            <span className="font-semibold">{studentName(student.student)}</span>
            <span className="text-muted-foreground">
              {[
                ...student.flags.map((flag) => t(`results.closing.flags.${flag}`)),
                t('results.closing.basedOn', {
                  expected: student.basedOn.expected,
                  held: student.basedOn.held,
                }),
                ...(student.decision === null
                  ? []
                  : [
                      t('results.closing.stored', {
                        decision: t(`results.closing.decisions.${student.decision}`),
                      }),
                    ]),
              ].join(' · ')}
            </span>
            {canEdit && (
              <span className="flex flex-wrap gap-2">
                {!outdated &&
                  choices
                    .filter((choice) => student.allowed.includes(choice))
                    .map((choice) => (
                      <Button
                        key={choice}
                        size="sm"
                        variant="secondary"
                        disabled={one.isPending}
                        onClick={() => {
                          one.mutate({ student, decision: choice });
                        }}
                      >
                        {t(`results.closing.decisions.${choice}`)}
                      </Button>
                    ))}
                {student.decision !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={one.isPending}
                    onClick={() => {
                      one.mutate({ student, decision: null });
                    }}
                  >
                    {t('results.closing.clear')}
                  </Button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <FailureAlert error={one.error ?? whole.error} />
      {canEdit && (
        <div className="grid gap-2">
          <p className="font-semibold">{t('results.closing.wholeJournal')}</p>
          <span className="flex flex-wrap gap-2">
            {outdated ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={whole.isPending}
                onClick={() => {
                  whole.mutate(null);
                }}
              >
                {t('results.closing.clear')}
              </Button>
            ) : (
              choices.map((choice) => (
                <Button
                  key={choice}
                  size="sm"
                  variant="secondary"
                  disabled={whole.isPending}
                  onClick={() => {
                    whole.mutate(choice);
                  }}
                >
                  {t(`results.closing.decisions.${choice}`)}
                </Button>
              ))
            )}
          </span>
          {refused.length > 0 && (
            <ul className="grid gap-1" role="status">
              {refused.map((one) => {
                const student = names.get(one.studentId);
                return (
                  <li key={one.studentId}>
                    {student === undefined
                      ? t(`results.closing.refused.${one.code}`)
                      : [studentName(student), t(`results.closing.refused.${one.code}`)].join(
                          COLON,
                        )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
