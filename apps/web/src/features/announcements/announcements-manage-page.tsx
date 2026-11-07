import {
  announcementEditOf,
  announcementRecordOf,
  type Announcement,
  type AnnouncementForm as FormValues,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { useNewRecord } from '@/components/list/use-new-record';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { momentDateText } from '@/lib/dates';
import { AnnouncementItem } from './announcement-month';
import { AnnouncementForm } from './announcement-form';
import {
  announcementsQuery,
  archiveAnnouncement,
  createAnnouncement,
  editAnnouncement,
  invalidateAnnouncements,
} from './announcements-api';

/** The audience of a row in words. */
function useAudience() {
  const { t } = useTranslation();
  return (row: Announcement): string => {
    const where =
      row.audience.kind === 'grades'
        ? t('announcements.audience.gradesOf', {
            grades: row.audience.grades.join(', '),
          })
        : row.audience.kind === 'classes'
          ? t('announcements.audience.classesOf', {
              classes: row.audience.classes.map((one) => one.name).join(', '),
            })
          : t(`announcements.audience.${row.audience.kind}`);
    const who =
      row.forStaff && row.forParents
        ? t('announcements.readers.both')
        : row.forStaff
          ? t('announcements.readers.staff')
          : t('announcements.readers.parents');
    return t('announcements.audience.line', { where, who });
  };
}

/**
 * The authors' list of announcements and events of the branch of the switcher and of the
 * whole school (task 11.7; build plan 11.7: the Super Admin for any audience, the Academic and
 * the Spiritual Vice Principals for the branch). "Add" writes one; the side panel edits its text
 * and dates, archives and restores it. A whole-school one is the Super Admin's alone: the server
 * answers `canChange`.
 */
export function AnnouncementsManagePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/announcements/manage' });
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const newRecord = useNewRecord();
  const list = useQuery(announcementsQuery(branchId));
  const audienceOf = useAudience();
  const key = useRef(crypto.randomUUID());
  const date = useMemo(
    () => ({
      format: (iso: string) =>
        momentDateText(i18n.language, iso, { timeZone: 'Asia/Tashkent' }),
    }),
    [i18n.language],
  );
  const rows = list.data?.announcements;
  const mayWriteSchool = list.data?.mayWriteSchool ?? false;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      createAnnouncement(announcementRecordOf(values), key.current),
    onSuccess: async () => {
      key.current = crypto.randomUUID();
      await invalidateAnnouncements(queryClient);
    },
  });

  const columns = useMemo(
    (): Column<Announcement>[] => [
      {
        key: 'title',
        header: t('announcements.manage.titleColumn'),
        cell: (row) => row.title,
        sortValue: (row) => row.title,
        searchText: (row) => `${row.title} ${row.body}`,
        opens: true,
      },
      {
        key: 'kind',
        header: t('announcements.form.kind'),
        cell: (row) => t(`announcements.kind.${row.kind}`),
        sortValue: (row) => row.kind,
      },
      {
        key: 'audience',
        header: t('announcements.form.audience'),
        cell: audienceOf,
        sortValue: audienceOf,
      },
      {
        key: 'published',
        header: t('announcements.manage.published'),
        cell: (row) => date.format(row.publishedAt),
        sortValue: (row) => row.publishedAt,
      },
      {
        key: 'messages',
        header: t('announcements.manage.messages'),
        cell: (row) =>
          row.forParents
            ? t('announcements.manage.messageCounts', {
                delivered: row.deliveries.delivered,
                due: row.deliveries.due,
                failed: row.deliveries.notDelivered,
              })
            : t('announcements.manage.noMessages'),
      },
      {
        key: 'status',
        header: t('announcements.manage.status'),
        cell: (row) =>
          row.archived ? t('announcements.manage.archived') : t('announcements.manage.active'),
        sortValue: (row) => (row.archived ? 1 : 0),
      },
    ],
    [t, date, audienceOf],
  );

  const filters = useMemo(
    (): Filter<Announcement>[] => [
      {
        key: 'status',
        label: t('announcements.manage.status'),
        options: [
          { value: 'active', label: t('announcements.manage.active') },
          { value: 'archived', label: t('announcements.manage.archived') },
        ],
        matches: (row, value) => (row.archived ? 'archived' : 'active') === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/announcements/manage', search: next, replace: how === 'replace' });
  };

  const addButton = newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      onClick={() => {
        newRecord.start(true);
      }}
    >
      {t('announcements.manage.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('announcements.manage.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('announcements.title'), to: '/announcements' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      <ListPage
        listId="announcements"
        caption={t('announcements.manage.caption')}
        rows={rows}
        error={list.error ?? undefined}
        onRetry={() => {
          void list.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.title}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('announcements.manage.emptyTitle'),
          text: t('announcements.manage.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        creating={
          newRecord.value === null
            ? undefined
            : {
                key: 'announcement',
                title: t('announcements.manage.newTitle'),
                content: ({ saved, close }) => (
                  <AnnouncementForm
                    row={null}
                    mayWriteSchool={mayWriteSchool}
                    onSave={async (values) => {
                      saved((await create.mutateAsync(values)).id);
                    }}
                    onCancel={close}
                  />
                ),
                ...newRecord.handlers,
              }
        }
        panel={(row) => <AnnouncementPanel key={row.id} row={row} audience={audienceOf(row)} />}
      />
    </>
  );
}

/** One announcement: read, then Edit (text and dates), Archive or Restore. */
function AnnouncementPanel({ row, audience }: { row: Announcement; audience: string }) {
  const { t } = useTranslation();
  const panel = usePanelEditing();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const edit = useMutation({
    mutationFn: (values: FormValues) =>
      editAnnouncement(row.id, announcementEditOf(values, row.version)),
    onSuccess: () => invalidateAnnouncements(queryClient),
  });
  const archive = useMutation({
    mutationFn: async () => {
      const went = await confirm(
        row.archived
          ? {
              title: t('announcements.manage.restoreTitle'),
              text: t('announcements.manage.restoreText'),
              names: [row.title],
              action: t('announcements.manage.restore'),
            }
          : {
              title: t('announcements.manage.archiveTitle'),
              text: t('announcements.manage.archiveText'),
              names: [row.title],
              action: t('announcements.manage.archive'),
              destructive: true,
            },
      );
      if (!went) return null;
      return archiveAnnouncement(row.id, row.version, row.archived);
    },
    onSuccess: () => invalidateAnnouncements(queryClient),
  });
  const changes = row.canChange;
  return (
    <div className="grid gap-6">
      {panel.editing === 'record' ? (
        <AnnouncementForm
          row={row}
          mayWriteSchool={false}
          onSave={async (values) => {
            await edit.mutateAsync(values);
            panel.stop({ saved: true, key: 'record' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        <>
          <AnnouncementItem item={row} />
          <p className="text-sm">{audience}</p>
        </>
      )}
      {panel.editing === null && (
        <PanelActions
          primary={
            changes && !row.archived ? (
              <Button
                {...panel.opener('record')}
                onClick={() => {
                  panel.start('record');
                }}
              >
                {t('form.edit')}
              </Button>
            ) : undefined
          }
          secondary={
            changes && row.archived ? (
              <Button
                variant="secondary"
                onClick={() => {
                  archive.mutate();
                }}
              >
                {t('announcements.manage.restore')}
              </Button>
            ) : undefined
          }
          danger={
            changes && !row.archived ? (
              <Button
                variant="ghost"
                onClick={() => {
                  archive.mutate();
                }}
              >
                {t('announcements.manage.archive')}
              </Button>
            ) : undefined
          }
          note={changes ? undefined : t('announcements.manage.schoolOnly')}
          error={archive.error ?? undefined}
          saved={panel.saved}
        />
      )}
    </div>
  );
}
