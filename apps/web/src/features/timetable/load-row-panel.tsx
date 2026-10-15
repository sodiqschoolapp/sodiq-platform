import type {
  LoadRow,
  LoadRowEdit,
  LoadRowRecord,
  Room,
  SchoolClass,
  SchoolGroup,
  Subject,
  TimetableVersion,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import type { Column } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { LoadRowForm } from './load-row-form';
import { deleteLoadRow, editLoadRow, invalidateTimetable } from './timetable-api';

interface LoadRowPanelProps {
  version: TimetableVersion;
  row: LoadRow;
  /** The columns of the list: the read view shows each of them. */
  columns: readonly Column<LoadRow>[];
  classes: readonly SchoolClass[];
  groups: readonly SchoolGroup[];
  subjects: readonly Subject[];
  rooms: readonly Room[];
  /** The version is a draft of an open year and the role edits the load. */
  canEdit: boolean;
  /** The version is a draft of an open year and the role deletes rows (`archive`, decision 6). */
  canDelete: boolean;
  /** The text the list shows for the row: its unit and subject. */
  name: string;
  onDeleted: () => void;
}

/**
 * A load row in the side panel (task 3.4a): its fields and problems read
 * first, then Edit (teacher, lessons, room, double lessons; decision 7) and
 * Delete, which asks first (decision 6).
 */
export function LoadRowPanel({
  version,
  row,
  columns,
  classes,
  groups,
  subjects,
  rooms,
  canEdit,
  canDelete,
  name,
  onDeleted,
}: LoadRowPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const edit = useMutation({
    mutationFn: (record: LoadRowEdit) => editLoadRow(version.id, row.id, record),
    onSuccess: () => invalidateTimetable(queryClient),
  });
  const remove = useMutation({
    mutationFn: () => deleteLoadRow(version.id, row.id),
    onSuccess: async () => {
      onDeleted();
      await invalidateTimetable(queryClient);
    },
  });

  const askDelete = async () => {
    if (
      await confirm({
        title: t('timetable.load.deleteTitle'),
        text: t('timetable.load.deleteText'),
        names: [name],
        action: t('timetable.load.deleteRow'),
        destructive: true,
      })
    ) {
      remove.mutate();
    }
  };

  return (
    <div className="grid gap-6">
      {canEdit && panel.editing === 'record' ? (
        <LoadRowForm
          version={version}
          row={row}
          classes={classes}
          groups={groups}
          subjects={subjects}
          rooms={rooms}
          label={name}
          onSave={async (record: LoadRowRecord | LoadRowEdit) => {
            if (!('subjectId' in record)) {
              await edit.mutateAsync(record);
            }
            panel.stop({ saved: true, key: 'record' });
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
              <dd>{column.cell(row)}</dd>
            </div>
          ))}
        </dl>
      )}
      {(canEdit || canDelete) && panel.editing === null && (
        <PanelActions
          primary={
            canEdit && (
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
          danger={
            canDelete && (
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => {
                  void askDelete();
                }}
              >
                {t('timetable.load.deleteRow')}
              </Button>
            )
          }
          error={remove.error}
          saved={panel.saved}
        />
      )}
    </div>
  );
}
