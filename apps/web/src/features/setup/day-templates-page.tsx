import {
  PERMISSIONS,
  permits,
  type DayTemplateRecord,
  type DayTemplateSummary,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { ListPage } from '@/components/list/list-page';
import { useNewRecord } from '@/components/list/use-new-record';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { NewTemplateForm } from './day-template-form';
import { DayTemplatePanel } from './day-template-panel';
import { dayTemplatesQuery, invalidateTemplates, rangeText, slotTypesQuery } from './templates-api';

/**
 * The day templates of the branch in use (`03`, Slot types and day templates:
 * "A day template is a start time and an ordered list of slots"; task 1.5),
 * each with its day as it stands today, opened in the side panel. The Super
 * Admin and the Academic Vice Principal add, change from a date and archive;
 * the Principal reads (owner's answer 14).
 */
export function DayTemplatesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/day-templates' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const newRecord = useNewRecord();
  const can = (action: 'create' | 'edit' | 'archive') =>
    role !== null && permits(PERMISSIONS, role, 'day_templates', action);
  const templates = useQuery(dayTemplatesQuery(branchId));
  const slotTypes = useQuery(slotTypesQuery(branchId));
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const today = templates.data?.today;
  const allSlotTypes = slotTypes.data?.slotTypes;
  const hasLessonType =
    allSlotTypes?.some((slotType) => slotType.kind === 'lesson' && slotType.archivedAt === null) ??
    false;
  // A template is drawn with its slot types (names, times) and added from
  // them: the list waits on both queries and fails with either, and its
  // failure is the reason "Add day template" is off.
  const listFailure = templates.isError
    ? { error: templates.error, retry: () => void templates.refetch() }
    : slotTypes.isError
      ? { error: slotTypes.error, retry: () => void slotTypes.refetch() }
      : null;

  const create = useMutation({
    mutationFn: (record: DayTemplateRecord) =>
      answerOf(
        api.POST('/api/setup/day-templates', { params: { header: branchHeader() }, body: record }),
      ),
    onSuccess: async () => {
      await invalidateTemplates(queryClient);
    },
  });

  const columns = useMemo(
    (): Column<DayTemplateSummary>[] => [
      {
        key: 'name',
        header: t('setup.dayTemplates.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'day',
        header: t('setup.dayTemplates.day'),
        cell: (row) =>
          row.start === null || row.end === null ? '' : rangeText(t, row.start, row.end),
        sortValue: (row) => row.start,
      },
      {
        key: 'lessons',
        header: t('setup.dayTemplates.lessonSlots'),
        cell: (row) => number.format(row.lessonSlots),
        sortValue: (row) => row.lessonSlots,
        numeric: true,
      },
      {
        key: 'use',
        header: t('setup.dayTemplates.use'),
        cell: (row) =>
          row.inUse ? t('setup.dayTemplates.inUse') : t('setup.dayTemplates.notInUse'),
        sortValue: (row) => (row.inUse ? 0 : 1),
      },
      {
        key: 'state',
        header: t('setup.dayTemplates.state'),
        cell: (row) =>
          row.archivedAt === null
            ? t('setup.dayTemplates.active')
            : t('setup.dayTemplates.archived'),
        sortValue: (row) => (row.archivedAt === null ? 0 : 1),
      },
    ],
    [t, number],
  );

  const filters = useMemo(
    (): Filter<DayTemplateSummary>[] => [
      {
        key: 'state',
        label: t('setup.dayTemplates.state'),
        options: [
          { value: 'active', label: t('setup.dayTemplates.active') },
          { value: 'archived', label: t('setup.dayTemplates.archived') },
        ],
        matches: (row, value) => (value === 'active') === (row.archivedAt === null),
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/day-templates', search: next, replace: how === 'replace' });
  };

  const addButton = can('create') && newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      // The new form needs the day of tomorrow and the slot types: off until both are there.
      disabled={!hasLessonType || today === undefined || allSlotTypes === undefined}
      onClick={() => {
        newRecord.start(true);
      }}
    >
      {t('setup.dayTemplates.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('setup.dayTemplates.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {can('create') && allSlotTypes !== undefined && !hasLessonType && (
        <p className="mb-4 text-sm text-muted-foreground">
          {t('setup.dayTemplates.needLessonType')}
        </p>
      )}
      <ListPage
        listId="day-templates"
        caption={t('setup.dayTemplates.caption')}
        rows={allSlotTypes === undefined ? undefined : templates.data?.dayTemplates}
        error={listFailure?.error}
        onRetry={() => {
          listFailure?.retry();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('setup.dayTemplates.emptyTitle'),
          text: t('setup.dayTemplates.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        creating={
          newRecord.value === null || today === undefined || allSlotTypes === undefined
            ? undefined
            : {
                key: 'day-template',
                title: t('setup.dayTemplates.newTitle'),
                content: ({ saved, close }) => (
                  <div className="grid gap-4">
                    <NewTemplateForm
                      slotTypes={allSlotTypes}
                      today={today}
                      onSave={async (record) => {
                        saved((await create.mutateAsync(record)).id);
                      }}
                    />
                    <div>
                      <Button variant="ghost" onClick={close}>
                        {t('setup.dayTemplates.cancel')}
                      </Button>
                    </div>
                  </div>
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) =>
          today === undefined ? null : (
            <DayTemplatePanel
              key={row.id}
              summary={row}
              today={today}
              // The list has no rows before the slot types arrive.
              slotTypes={allSlotTypes ?? []}
              canEdit={can('edit')}
              canArchive={can('archive')}
            />
          )
        }
      />
    </>
  );
}
