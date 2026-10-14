import {
  classDisplayName,
  type AcademicYear,
  type GroupCreate,
  type GroupEdit,
  type SchoolClass,
  type SchoolGroup,
  type Subject,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import type { Column } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { GroupForm, sharedLanguage } from './group-form';
import { SharedSlots } from './group-slots';
import { archiveGroup, editGroup, groupQuery, invalidateGroups, restoreGroup } from './groups-api';

interface GroupPanelProps {
  row: SchoolGroup;
  /** The columns of the list: the read view shows each of them. */
  columns: readonly Column<SchoolGroup>[];
  years: readonly AcademicYear[];
  classes: readonly SchoolClass[];
  subjects: readonly Subject[];
  canEdit: boolean;
  canArchive: boolean;
}

/**
 * A group in the side panel (task 3.2a): its record read first, the shared
 * slots of its two grades, and the actions at the bottom (Edit; Archive or
 * Restore). In a closed year a group is history: nothing is offered.
 */
export function GroupPanel({
  row,
  columns,
  years,
  classes,
  subjects,
  canEdit,
  canArchive,
}: GroupPanelProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const detail = useQuery(groupQuery(branchId, row.id));
  const refresh = () => invalidateGroups(queryClient);

  // "Group changed, reload": the form closes, the group is read again and the
  // refusal stays at the bottom of the panel (.claude/rules/web.md).
  const [changed, setChanged] = useState<unknown>(null);
  const edit = useMutation({
    mutationFn: (record: GroupEdit) => editGroup(row.id, record),
    onSuccess: async () => {
      setChanged(null);
      await refresh();
    },
    onError: async (error) => {
      if (error instanceof ApiFailure && error.code === 'group_changed') {
        setChanged(error);
        panel.stop({ focus: 'record' });
        await refresh();
      }
    },
  });
  const archive = useMutation({
    mutationFn: (change: { restore: boolean; confirmMixedLanguage: boolean }) =>
      change.restore ? restoreGroup(row.id, change.confirmMixedLanguage) : archiveGroup(row.id),
    onSuccess: refresh,
  });

  if (detail.isError) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (detail.data === undefined) {
    return <LoadingOutline lines={5} />;
  }
  const group = detail.data;
  const open = !group.archived && group.yearStatus !== 'closed';
  const editable = canEdit && open;

  const askArchive = async () => {
    const active = !group.archived;
    // Code round 1 of the review, finding 1: classes that changed language
    // while the group was archived bring it back mixed; a subject under the
    // language rule asks the warning of the form, naming the classes.
    if (!active && group.subject.languageRule && sharedLanguage(group.classes) === null) {
      if (
        await confirm({
          title: t('groups.mixedTitle'),
          text: t('groups.mixedText'),
          names: group.classes.map((one) => classDisplayName(one.grade, one.name)),
          action: t('groups.restoreGroup'),
        })
      ) {
        archive.mutate({ restore: true, confirmMixedLanguage: true });
      }
      return;
    }
    if (
      await confirm({
        title: active ? t('groups.archiveTitle') : t('groups.restoreTitle'),
        text: active ? t('groups.archiveText') : t('groups.restoreText'),
        names: [group.name],
        action: active ? t('groups.archiveGroup') : t('groups.restoreGroup'),
        destructive: active,
      })
    ) {
      archive.mutate({ restore: !active, confirmMixedLanguage: false });
    }
  };

  return (
    <div className="grid gap-6">
      {editable && panel.editing === 'record' ? (
        <GroupForm
          group={group}
          years={years}
          classes={classes}
          subjects={subjects}
          label={group.name}
          onSave={async (record: GroupCreate | GroupEdit) => {
            if ('version' in record) {
              await edit.mutateAsync(record);
            }
            panel.stop({ saved: true, key: 'record' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        <>
          <dl className="grid gap-3">
            {columns.map((column) => (
              <div key={column.key} className="grid gap-0.5">
                <dt className="text-sm text-muted-foreground">{column.header}</dt>
                <dd>{column.cell(group)}</dd>
              </div>
            ))}
            <div className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{t('groups.kind')}</dt>
              <dd>{t(`groups.kinds.${group.kind}`)}</dd>
            </div>
            {(
              [
                // Decision 15 of 3.2a: the teacher comes with the teaching load
                // (3.4), the students with membership (3.2b), the figures with
                // the journal.
                ['teacher', t('groups.teacher')],
                ['students', t('groups.students')],
                ['average', t('groups.average')],
                ['attendance', t('groups.attendance')],
              ] as const
            ).map(([key, term]) => (
              <div key={key} className="grid gap-0.5">
                <dt className="text-sm text-muted-foreground">{term}</dt>
                <dd>{t('groups.notYet')}</dd>
              </div>
            ))}
          </dl>
          <SharedSlots slots={group.slots} />
        </>
      )}

      {(editable || (canArchive && group.yearStatus !== 'closed')) && panel.editing === null && (
        <PanelActions
          primary={
            editable && (
              <Button
                {...panel.opener('record')}
                onClick={() => {
                  panel.start('record');
                }}
              >
                {t('form.edit')}
              </Button>
            )
          }
          secondary={
            canArchive &&
            group.archived && (
              <Button
                variant="secondary"
                disabled={archive.isPending}
                onClick={() => {
                  void askArchive();
                }}
              >
                {t('groups.restoreGroup')}
              </Button>
            )
          }
          danger={
            canArchive &&
            !group.archived && (
              <Button
                variant="destructive"
                disabled={archive.isPending}
                onClick={() => {
                  void askArchive();
                }}
              >
                {t('groups.archiveGroup')}
              </Button>
            )
          }
          error={archive.error ?? changed}
          saved={panel.saved}
        />
      )}
    </div>
  );
}
