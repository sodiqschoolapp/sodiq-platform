import type { Room, RoomRecord } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { PanelActions } from '@/components/list/panel-actions';
import type { Column } from '@/components/list/list-state';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { RoomForm } from './room-form';
import type { FloorChoice } from './setup-api';

interface RoomPanelProps {
  room: Room;
  floors: readonly FloorChoice[];
  /** The columns of the list: the read view shows each of them. */
  columns: readonly Column<Room>[];
  /** The Super Admin edits; the other roles read. */
  canEdit: boolean;
  onSave: (record: RoomRecord) => Promise<void>;
}

/**
 * A room in the side panel (task 2.7c-2b-1): read first, with Edit at the
 * bottom. A room has no archive: its status (in use, under repair, closed) is
 * set from the list (decision 11).
 */
export function RoomPanel({ room, floors, columns, canEdit, onSave }: RoomPanelProps) {
  const { t } = useTranslation();
  const panel = usePanelEditing();
  return (
    <div className="grid gap-6">
      {canEdit && panel.editing === 'record' ? (
        <RoomForm
          room={room}
          floors={floors}
          label={room.name}
          onSave={async (record) => {
            await onSave(record);
            panel.stop({ saved: true });
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
              <dd>{column.cell(room)}</dd>
            </div>
          ))}
        </dl>
      )}
      {canEdit && panel.editing === null && (
        <PanelActions
          primary={
            <Button
              {...panel.opener('record')}
              onClick={() => {
                panel.start('record');
              }}
            >
              {t('form.edit')}
            </Button>
          }
          saved={panel.saved}
        />
      )}
    </div>
  );
}
