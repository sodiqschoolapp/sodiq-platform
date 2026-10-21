import { FORCED_DELETE_RESTORE_DAYS, type Room, type RoomRecord } from '@sodiq/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ForcedDeleteDialog } from '@/components/forced-delete-dialog';
import { PanelActions } from '@/components/list/panel-actions';
import type { Column } from '@/components/list/list-state';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { FORCED_DELETES_KEY } from '@/features/audit/forced-deletes-api';
import { RoomForm } from './room-form';
import { SETUP_KEY, forceDeletePlace, type FloorChoice } from './setup-api';

interface RoomPanelProps {
  room: Room;
  floors: readonly FloorChoice[];
  /** The columns of the list: the read view shows each of them. */
  columns: readonly Column<Room>[];
  /** The Super Admin edits; the other roles read. */
  canEdit: boolean;
  /** The Super Admin deletes a room that nothing uses for good (task 5.8c). */
  canForce: boolean;
  onSave: (record: RoomRecord) => Promise<void>;
}

/**
 * A room in the side panel (task 2.7c-2b-1): read first, with Edit at the
 * bottom. A room has no archive: its status (in use, under repair, closed) is
 * set from the list (decision 11). The Super Admin deletes a room for good
 * when nothing uses it (task 5.8c; `03`, Building, floor, room); the server
 * refuses one in use, and the refusal says to close it instead.
 */
export function RoomPanel({ room, floors, columns, canEdit, canForce, onSave }: RoomPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const panel = usePanelEditing();
  const [forcing, setForcing] = useState(false);
  const [forced, setForced] = useState(false);
  return (
    <div className="grid gap-6">
      {canEdit && panel.editing === 'record' ? (
        <RoomForm
          room={room}
          floors={floors}
          label={room.name}
          onSave={async (record) => {
            await onSave(record);
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
              <dd>{column.cell(room)}</dd>
            </div>
          ))}
        </dl>
      )}
      {forced && (
        <p role="status" className="text-sm">
          {t('forcedDeletes.placeDone', { name: room.name })}
        </p>
      )}
      {canEdit && panel.editing === null && !forced && (
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
          danger={
            canForce && (
              <Button
                variant="destructive"
                onClick={() => {
                  setForcing(true);
                }}
              >
                {t('forcedDeletes.deletePlace')}
              </Button>
            )
          }
          saved={panel.saved}
        />
      )}
      {forcing && (
        <ForcedDeleteDialog
          title={t('forcedDeletes.placeTitle_room', { name: room.name })}
          text={t('forcedDeletes.placeKept', { count: FORCED_DELETE_RESTORE_DAYS })}
          send={(body, key) => forceDeletePlace('room', room.id, body, key)}
          onClose={() => {
            setForcing(false);
          }}
          onDeleted={async () => {
            setForcing(false);
            setForced(true);
            await queryClient.invalidateQueries({ queryKey: SETUP_KEY });
            await queryClient.invalidateQueries({ queryKey: FORCED_DELETES_KEY });
          }}
        />
      )}
    </div>
  );
}
