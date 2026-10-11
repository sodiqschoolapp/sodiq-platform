import {
  CALENDAR_ENTRY_KINDS,
  nextDay,
  PERMISSIONS,
  permits,
  type CalendarEntry,
  type CalendarEntryRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { DateField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { calendarDayQuery, calendarEntriesQuery, invalidateCalendar, isPast } from './calendar-api';
import { CalendarEntryForm } from './calendar-entry-form';
import { CalendarEntryPanel } from './calendar-entry-panel';
import { datesText, dayText, gradesText, useCalendarPreview } from './calendar-preview';
import { dayTemplatesQuery } from './templates-api';

/**
 * "Check a date" (decision 15 of pull request #47): what every grade has on
 * one date, the day off, the special day or the regular template, as the
 * rule engine resolves it (`03`: "Each date resolves to 'no lessons' or to one
 * day template").
 */
function CheckDate({ branchId, initial }: { branchId: string | null; initial: string }) {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(initial);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const day = useQuery(calendarDayQuery(branchId, valid ? date : null));
  return (
    <section aria-label={t('setup.calendar.checkTitle')} className="mt-8 grid max-w-3xl gap-3">
      <h2 className="text-lg font-semibold">{t('setup.calendar.checkTitle')}</h2>
      <div className="max-w-xs">
        <DateField
          label={t('setup.calendar.checkDate')}
          name="checkDate"
          value={date}
          error={valid ? undefined : t('setup.calendar.checkDateMissing')}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      {valid &&
        (day.isError ? (
          <ErrorState
            error={day.error}
            onRetry={() => {
              void day.refetch();
            }}
          />
        ) : day.data === undefined ? (
          <LoadingOutline />
        ) : (
          <Table>
            <caption className="sr-only">{t('setup.calendar.checkTitle')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('setup.calendar.gradeColumn')}</TableHead>
                <TableHead>{t('setup.calendar.dayColumn')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {day.data.grades.map((one) => (
                <TableRow key={one.grade}>
                  <TableCell>{one.grade}</TableCell>
                  <TableCell>{dayText(t, i18n.language, day.data.date, one.day)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
    </section>
  );
}

/**
 * The academic calendar of the branch (docs/spec/03-school-setup.md, Academic
 * calendar, owner: Academic Vice Principal; task 1.4): days off and special
 * days, each opened in the side panel. The Super Admin and the Academic Vice
 * Principal add, change and archive; the Principal reads (owner's answer 18).
 */
export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/calendar' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const preview = useCalendarPreview();
  const [adding, setAdding] = useState(false);
  const can = (action: 'create' | 'edit' | 'archive') =>
    role !== null && permits(PERMISSIONS, role, 'calendar', action);
  const entries = useQuery(calendarEntriesQuery(branchId));
  const templates = useQuery(dayTemplatesQuery(branchId));
  const today = entries.data?.today;
  const language = i18n.language;
  const active = useMemo(
    () =>
      (templates.data?.dayTemplates ?? [])
        .filter((template) => template.archivedAt === null)
        .map((template) => ({ id: template.id, name: template.name })),
    [templates.data],
  );

  const create = useMutation({
    mutationFn: async (record: CalendarEntryRecord) => {
      await preview.confirm({ action: 'create', record });
      return answerOf(
        api.POST('/api/setup/calendar-entries', {
          params: { header: branchHeader() },
          body: record,
        }),
      );
    },
    onSuccess: async () => {
      setAdding(false);
      await invalidateCalendar(queryClient);
    },
  });

  const columns = useMemo(
    (): Column<CalendarEntry>[] => [
      {
        key: 'name',
        header: t('setup.calendar.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'dates',
        header: t('setup.calendar.dates'),
        cell: (row) => datesText(row.firstDate, row.lastDate, language),
        sortValue: (row) => row.firstDate,
      },
      {
        key: 'kind',
        header: t('setup.calendar.kind'),
        cell: (row) => t(`setup.calendar.kinds.${row.kind}`),
        sortValue: (row) => CALENDAR_ENTRY_KINDS.indexOf(row.kind),
      },
      {
        key: 'scope',
        header: t('setup.calendar.scope'),
        cell: (row) => gradesText(t, row.gradeFrom, row.gradeTo),
        sortValue: (row) => row.gradeFrom ?? 0,
      },
      {
        key: 'template',
        header: t('setup.calendar.template'),
        cell: (row) => row.dayTemplateName ?? '',
      },
      {
        key: 'state',
        header: t('setup.calendar.state'),
        cell: (row) =>
          row.archivedAt === null ? t('setup.calendar.active') : t('setup.calendar.archived'),
        sortValue: (row) => (row.archivedAt === null ? 0 : 1),
      },
    ],
    [t, language],
  );

  const filters = useMemo(
    (): Filter<CalendarEntry>[] => [
      {
        key: 'when',
        label: t('setup.calendar.when'),
        options: [
          { value: 'coming', label: t('setup.calendar.coming') },
          { value: 'past', label: t('setup.calendar.past') },
        ],
        matches: (row, value) => today === undefined || (value === 'past') === isPast(row, today),
      },
      {
        key: 'kind',
        label: t('setup.calendar.kind'),
        options: CALENDAR_ENTRY_KINDS.map((kind) => ({
          value: kind,
          label: t(`setup.calendar.kinds.${kind}`),
        })),
        matches: (row, value) => row.kind === value,
      },
      {
        key: 'state',
        label: t('setup.calendar.state'),
        options: [
          { value: 'active', label: t('setup.calendar.active') },
          { value: 'archived', label: t('setup.calendar.archived') },
        ],
        matches: (row, value) => (value === 'active') === (row.archivedAt === null),
      },
    ],
    [t, today],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/calendar', search: next, replace: how === 'replace' });
  };

  const addButton = can('create') && !adding && (
    <Button
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('setup.calendar.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('setup.calendar.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {adding && (
        <section
          aria-label={t('setup.calendar.newTitle')}
          className="mb-6 grid max-w-xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.calendar.newTitle')}</h2>
          {today === undefined || templates.isPending ? (
            <LoadingOutline />
          ) : templates.isError ? (
            <ErrorState
              error={templates.error}
              onRetry={() => {
                void templates.refetch();
              }}
            />
          ) : (
            <CalendarEntryForm
              firstDate={nextDay(today)}
              templates={active}
              label={t('setup.calendar.newTitle')}
              onSave={async (record) => {
                await create.mutateAsync(record);
              }}
            />
          )}
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                void leave.leave().then((leaves) => {
                  if (leaves) {
                    setAdding(false);
                  }
                });
              }}
            >
              {t('setup.calendar.cancel')}
            </Button>
          </div>
        </section>
      )}
      <ListPage
        listId="calendar"
        caption={t('setup.calendar.caption')}
        rows={entries.data?.entries}
        error={entries.error ?? undefined}
        onRetry={() => {
          void entries.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          text: t('setup.calendar.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        panel={(row) =>
          today === undefined ? null : templates.isError ? (
            <ErrorState
              error={templates.error}
              onRetry={() => {
                void templates.refetch();
              }}
            />
          ) : (
            <CalendarEntryPanel
              key={row.id}
              entry={row}
              today={today}
              templates={active}
              canEdit={can('edit')}
              canArchive={can('archive')}
            />
          )
        }
      />
      {today !== undefined && <CheckDate branchId={branchId} initial={nextDay(today)} />}
      {preview.dialog}
    </>
  );
}
