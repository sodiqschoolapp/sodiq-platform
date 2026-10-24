import {
  ORPHAN_DAYS_MAX,
  ORPHAN_REASON_MAX_LENGTH,
  orphanAssignSchema,
  type OrphanAssign,
  type OrphanLessons,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField, TextAreaField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useMayView, useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { momentText, schoolDateText } from '@/lib/dates';
import { assignOrphan, invalidateJournal, orphansQuery, withdrawOrphan } from './journal-api';

type Row = OrphanLessons['lessons'][number];

export const orphansSearch = (search: Record<string, unknown>): ListSearch => listSearch(search);

/**
 * Orphan lessons (task 8.7, pull request #225; `edge/journal`, Locks: "A teacher
 * leaves the school with incomplete lessons. They go to an 'orphan lessons' list.
 * The Academic Vice Principal assigns a teacher to complete them, with a reason").
 * The server decides which lessons are listed and who may be assigned.
 */
export function OrphansPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/journal/orphans' });
  const { branchId } = useView();
  const list = useQuery(orphansQuery(branchId));
  const language = i18n.language;
  const lessonOf = useCallback(
    (row: Row) =>
      t('journal.reminders.lesson', {
        date: schoolDateText(row.lesson.date, language, false),
        unit: row.lesson.unit?.name ?? '',
        subject: nameOf(row.lesson.subject.names, language),
      }),
    [t, language],
  );
  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'lesson',
        header: t('journal.orphans.lesson'),
        cell: lessonOf,
        sortValue: (row) => row.lesson.date,
        searchText: lessonOf,
        opens: true,
        fixed: true,
      },
      {
        key: 'teacher',
        header: t('journal.orphans.teacher'),
        cell: (row) => row.teacher.name,
        sortValue: (row) => row.teacher.name,
        searchText: (row) => row.teacher.name,
      },
      {
        key: 'status',
        header: t('journal.orphans.status'),
        cell: (row) => t(`journal.lessonStatus.${row.lesson.status}`),
        sortValue: (row) => row.lesson.status,
      },
      {
        key: 'assignment',
        header: t('journal.orphans.assignment'),
        cell: (row) =>
          row.assignment === null
            ? '—'
            : t('journal.orphans.assignedTo', {
                name: row.assignment.teacher.name,
                date: momentText(language, row.assignment.openUntil),
              }),
        sortValue: (row) => row.assignment?.teacher.name ?? '',
      },
    ],
    [t, language, lessonOf],
  );
  return (
    <>
      <PageHeader
        title={t('journal.orphans.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('journal.page.title'), to: '/journal' },
        ]}
      />
      <ListPage
        listId="journal-orphans"
        caption={t('journal.orphans.title')}
        rows={list.data?.lessons}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        rowId={(row) => row.lesson.id}
        rowName={lessonOf}
        columns={columns}
        search={search}
        onSearchChange={(next, how) => {
          void navigate({ to: '/journal/orphans', search: next, replace: how === 'replace' });
        }}
        panel={(row) => (
          <OrphanPanel
            key={row.lesson.id}
            row={row}
            teachers={list.data?.teachers ?? []}
            name={lessonOf(row)}
          />
        )}
        empty={{ title: t('journal.orphans.title'), text: t('journal.orphans.empty') }}
      />
    </>
  );
}

type AssignField = 'staffId' | 'days' | 'reason';

function OrphanPanel({
  row,
  teachers,
  name,
}: {
  row: Row;
  teachers: OrphanLessons['teachers'];
  name: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const edits = useMayView('journal_orphans', 'edit');
  const withdraw = useMutation({
    mutationFn: async (assignment: NonNullable<Row['assignment']>) => {
      const yes = await confirm({
        title: t('journal.orphans.withdrawTitle'),
        text: t('journal.orphans.withdrawText', { name: assignment.teacher.name }),
        action: t('journal.orphans.withdraw'),
      });
      if (!yes) return null;
      await withdrawOrphan(assignment.id);
      return true;
    },
    onSuccess: () => invalidateJournal(queryClient),
  });
  const read = useCallback(
    (typed: Record<AssignField, string>): unknown => ({ ...typed, days: wholeNumber(typed.days) }),
    [],
  );
  const form = useRecordForm<AssignField, OrphanAssign>({
    schema: orphanAssignSchema,
    initial: { staffId: teachers[0]?.id ?? '', days: '1', reason: '' },
    read,
    message: (field, issue) =>
      field === 'reason' && issue.code === 'too_small'
        ? t('journal.locks.reasonNeeded')
        : undefined,
    save: async (input) => {
      await assignOrphan(row.lesson.id, input);
      await invalidateJournal(queryClient);
    },
  });
  return (
    <div className="grid gap-4 text-sm">
      <p>
        <span className="font-semibold">{t(`journal.lessonStatus.${row.lesson.status}`)}</span>
        {' · '}
        {row.teacher.name}
      </p>
      {row.assignment !== null && (
        <div className="grid gap-2" data-assignment={row.assignment.id}>
          <p>
            {t('journal.orphans.assignedTo', {
              name: row.assignment.teacher.name,
              date: momentText(i18n.language, row.assignment.openUntil),
            })}
          </p>
          <p>{row.assignment.reason}</p>
          {edits && (
            <div>
              <Button
                variant="secondary"
                disabled={withdraw.isPending}
                onClick={() => {
                  if (row.assignment !== null) withdraw.mutate(row.assignment);
                }}
              >
                {t('journal.orphans.withdraw')}
              </Button>
            </div>
          )}
          <FailureAlert error={withdraw.error} />
        </div>
      )}
      {edits && (
        <RecordForm form={form} label={t('journal.orphans.assignTitle', { lesson: name })}>
          <SelectField
            label={t('journal.orphans.teacherField')}
            options={teachers.map((one) => ({ value: one.id, label: one.name }))}
            {...form.bind('staffId')}
          />
          <SelectField
            label={t('journal.orphans.days')}
            options={Array.from({ length: ORPHAN_DAYS_MAX }, (_, index) => ({
              value: String(index + 1),
              label: String(index + 1),
            }))}
            {...form.bind('days')}
          />
          <TextAreaField
            label={t('journal.orphans.reason')}
            maxLength={ORPHAN_REASON_MAX_LENGTH}
            {...form.bind('reason')}
          />
        </RecordForm>
      )}
    </div>
  );
}
