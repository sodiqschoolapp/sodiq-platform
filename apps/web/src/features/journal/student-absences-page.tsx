import {
  ABSENCE_CATEGORIES,
  absenceReasonRecordSchema,
  listName,
  timeText,
  type AbsenceReasonRecord,
  type StudentAbsenceDay,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField, SelectField, TextAreaField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import {
  listSearch,
  type Column,
  type Filter,
  type ListSearch,
} from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { accountText } from '@/features/people/cell-lines';
import { schoolDateText } from '@/lib/dates';
import { invalidateJournal, setAbsenceReason, studentAbsencesQuery } from './journal-api';

/** The address of the page: the class and the days, as the server reads them, and the list's own. */
export type StudentAbsencesSearch = ListSearch & { class?: string; from?: string; to?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** `validateSearch` of the page. */
export function studentAbsencesSearch(search: Record<string, unknown>): StudentAbsencesSearch {
  const result: StudentAbsencesSearch = listSearch(search);
  for (const key of ['from', 'to'] as const) {
    const value = search[key];
    if (typeof value === 'string' && DATE.test(value)) result[key] = value;
  }
  if (typeof search.class === 'string' && UUID.test(search.class)) result.class = search.class;
  return result;
}

const rowIdOf = (row: StudentAbsenceDay) => `${row.student.id}/${row.date}`;

const studentName = (row: StudentAbsenceDay) =>
  listName({ firstName: row.student.firstName, lastName: row.student.lastName });

/**
 * Student absences (task 6.3, pull request #211; `edge/journal`, "A Tutor
 * records why a student was absent": "The reason is its own record per
 * student and date: a category ..., a text"; decisions 6 to 9 and 13): the
 * days of a class with a 0 or 3, or a reason, over at most 31 days, and in
 * the side panel the reason, set or cleared by the class Tutor, the
 * Academic Vice Principal and the Super Admin. The server decides what each
 * row may change (`canEdit`).
 */
export function StudentAbsencesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search: StudentAbsencesSearch = useSearch({ from: '/app/journal/student-absences' });
  const { branchId } = useView();
  const query = {
    ...(search.class === undefined ? {} : { classId: search.class }),
    ...(search.from === undefined || search.to === undefined
      ? {}
      : { from: search.from, to: search.to }),
  };
  const list = useQuery(studentAbsencesQuery(branchId, query));
  const data = list.data;

  const go = (next: StudentAbsencesSearch, how: 'push' | 'replace' = 'replace') => {
    void navigate({ to: '/journal/student-absences', search: next, replace: how === 'replace' });
  };
  const keep = {
    ...(search.class === undefined ? {} : { class: search.class }),
    ...(search.from === undefined ? {} : { from: search.from }),
    ...(search.to === undefined ? {} : { to: search.to }),
  };

  const columns = useMemo((): Column<StudentAbsenceDay>[] => {
    const subject = (names: { uz: string; ru: string; en: string }) =>
      language === 'ru' ? names.ru : language === 'en' ? names.en : names.uz;
    return [
      {
        key: 'date',
        header: t('journal.absences.date'),
        cell: (row) => schoolDateText(row.date, language),
        sortValue: (row) => row.date,
      },
      {
        key: 'student',
        header: t('journal.absences.student'),
        cell: studentName,
        sortValue: studentName,
        searchText: (row) => `${studentName(row)} ${row.student.uid}`,
        opens: true,
        fixed: true,
      },
      {
        key: 'lessons',
        header: t('journal.absences.lessons'),
        cell: (row) =>
          row.lessons
            .map((one) => `${timeText(one.start)} ${subject(one.subject)} (${String(one.mark)})`)
            .join(', '),
      },
      {
        key: 'earlier',
        header: t('journal.absences.atSchoolEarlier'),
        cell: (row) => (row.presentEarlier ? t('journal.absences.atSchoolEarlier') : ''),
        sortValue: (row) => (row.presentEarlier ? 0 : 1),
      },
      {
        key: 'category',
        header: t('journal.absences.category'),
        cell: (row) =>
          row.reason?.category == null
            ? t('journal.absences.none')
            : t(`journal.absences.categories.${row.reason.category}`),
        sortValue: (row) => row.reason?.category ?? '',
      },
      {
        key: 'note',
        header: t('journal.absences.note'),
        cell: (row) => row.reason?.note ?? '',
        searchText: (row) => row.reason?.note ?? '',
      },
    ];
  }, [t, language]);

  const filters = useMemo(
    (): Filter<StudentAbsenceDay>[] => [
      {
        key: 'category',
        label: t('journal.absences.category'),
        options: [
          { value: 'none', label: t('journal.absences.none') },
          ...ABSENCE_CATEGORIES.map((category) => ({
            value: category,
            label: t(`journal.absences.categories.${category}`),
          })),
        ],
        matches: (row, value) => (row.reason?.category ?? 'none') === value,
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('journal.absences.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('journal.page.title'), to: '/journal' },
        ]}
      />
      <div className="grid gap-4">
        {data !== undefined && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-48">
              <SelectField
                label={t('journal.absences.class')}
                value={data.classId ?? ''}
                options={data.classes.map((one) => ({ value: one.id, label: one.name }))}
                onChange={(event) => {
                  go({ ...keep, class: event.target.value }, 'push');
                }}
              />
            </div>
            <div className="w-44">
              <DateField
                label={t('journal.absences.from')}
                value={data.from}
                onChange={(event) => {
                  if (DATE.test(event.target.value)) {
                    go({ ...keep, from: event.target.value, to: search.to ?? data.to });
                  }
                }}
              />
            </div>
            <div className="w-44">
              <DateField
                label={t('journal.absences.to')}
                value={data.to}
                onChange={(event) => {
                  if (DATE.test(event.target.value)) {
                    go({ ...keep, from: search.from ?? data.from, to: event.target.value });
                  }
                }}
              />
            </div>
          </div>
        )}
        <ListPage
          listId="student-absences"
          caption={t('journal.absences.caption')}
          rows={data?.days}
          error={list.error ?? undefined}
          onRetry={() => {
            void list.refetch();
          }}
          rowId={rowIdOf}
          rowName={(row) => `${studentName(row)} · ${schoolDateText(row.date, language)}`}
          columns={columns}
          filters={filters}
          search={search}
          onSearchChange={(next, how) => {
            go({ ...keep, ...next }, how);
          }}
          empty={
            data?.classId === null
              ? { title: t('journal.absences.noClass'), text: t('journal.absences.empty') }
              : { title: t('journal.absences.emptyTitle'), text: t('journal.absences.empty') }
          }
          panel={(row) => <ReasonPanel key={rowIdOf(row)} day={row} columns={columns} />}
        />
      </div>
    </>
  );
}

/** A student's day in the side panel: its lines, and the reason set or cleared (decision 8). */
function ReasonPanel({
  day,
  columns,
}: {
  day: StudentAbsenceDay;
  columns: readonly Column<StudentAbsenceDay>[];
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const save = useMutation({
    mutationFn: (record: AbsenceReasonRecord) => setAbsenceReason(day.student.id, day.date, record),
    onSuccess: () => invalidateJournal(queryClient),
  });
  const reason = day.reason;
  const set = reason !== null && reason.category !== null;

  const askClear = async () => {
    if (
      await confirm({
        title: t('journal.absences.clearTitle'),
        text: t('journal.absences.clearText'),
        names: [studentName(day)],
        action: t('journal.absences.clear'),
        destructive: true,
      })
    ) {
      save.mutate({ category: null, note: '' });
    }
  };

  return (
    <div className="grid gap-6">
      {day.canEdit && panel.editing === 'reason' ? (
        <ReasonForm
          day={day}
          onSave={async (record) => {
            await save.mutateAsync(record);
            panel.stop({ saved: true, key: 'reason' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        <dl className="grid gap-3">
          {columns.map((column) => (
            <div key={column.key} className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{column.header}</dt>
              <dd>{column.cell(day)}</dd>
            </div>
          ))}
        </dl>
      )}
      {set && panel.editing === null && (
        <p className="text-sm text-muted-foreground" data-reason-changed="true">
          {t('journal.absences.changedBy', {
            name: accountText(reason.changedBy, '—'),
            date: schoolDateText(reason.changedAt.slice(0, 10), i18n.language),
          })}
        </p>
      )}
      {day.canEdit && panel.editing === null && (
        <PanelActions
          primary={
            <Button
              {...panel.opener('reason')}
              onClick={() => {
                panel.start('reason');
              }}
            >
              {t('journal.absences.setReason')}
            </Button>
          }
          danger={
            set && (
              <Button
                variant="destructive"
                disabled={save.isPending}
                onClick={() => {
                  void askClear();
                }}
              >
                {t('journal.absences.clear')}
              </Button>
            )
          }
          error={save.error}
          saved={panel.saved}
        />
      )}
    </div>
  );
}

function ReasonForm({
  day,
  onSave,
  onCancel,
}: {
  day: StudentAbsenceDay;
  onSave: (record: AbsenceReasonRecord) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const form = useRecordForm({
    // A reason is set here with a category; clearing is its own action.
    schema: absenceReasonRecordSchema.refine((record) => record.category !== null, {
      path: ['category'],
    }),
    initial: { category: day.reason?.category ?? '', note: day.reason?.note ?? '' },
    read: (typed) => ({
      category: ABSENCE_CATEGORIES.find((category) => category === typed.category) ?? null,
      note: typed.note,
    }),
    message: (field) => (field === 'category' ? t('journal.absences.noCategory') : undefined),
    save: onSave,
  });
  return (
    <RecordForm form={form} label={t('journal.absences.setReason')} onCancel={onCancel}>
      <SelectField
        label={t('journal.absences.category')}
        options={[
          { value: '', label: t('journal.absences.noCategory') },
          ...ABSENCE_CATEGORIES.map((category) => ({
            value: category,
            label: t(`journal.absences.categories.${category}`),
          })),
        ]}
        {...form.bind('category')}
      />
      <TextAreaField label={t('journal.absences.note')} rows={3} {...form.bind('note')} />
    </RecordForm>
  );
}
