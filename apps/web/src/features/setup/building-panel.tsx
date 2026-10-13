import {
  buildingRecordSchema,
  floorRecordSchema,
  type Building,
  type BuildingRecord,
  type Floor,
  type FloorRecord,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { SETUP_KEY } from './setup-api';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';

interface BuildingFormProps {
  /** The record as saved; `null` for a new building. */
  building: Building | null;
  label: string;
  onSave: (record: BuildingRecord) => Promise<void>;
  /** Closes the form (opened by Edit in the side panel). */
  onCancel?: () => void;
}

/** The record of a building: its name (`03`, Building, floor, room). */
export function BuildingForm({ building, label, onSave, onCancel }: BuildingFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: buildingRecordSchema,
    initial: { name: building?.name ?? '' },
    save: onSave,
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <Field label={t('setup.buildings.name')} autoComplete="off" {...form.bind('name')} />
    </RecordForm>
  );
}

interface FloorFormProps {
  floor: Floor | null;
  label: string;
  onSave: (record: FloorRecord) => Promise<void>;
  onCancel: () => void;
}

/** The record of a floor: "a name or number". */
function FloorForm({ floor, label, onSave, onCancel }: FloorFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: floorRecordSchema,
    initial: { name: floor?.name ?? '' },
    save: onSave,
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <Field label={t('setup.buildings.floorName')} autoComplete="off" {...form.bind('name')} />
    </RecordForm>
  );
}

interface BuildingPanelProps {
  building: Building;
  /** The Super Admin edits, archives and restores; the other roles read. */
  canEdit: boolean;
  branchId: string | null;
}

/**
 * A building in the side panel of the list: its name, and its floors, which
 * are added, renamed, archived and restored here ("Rooms are added floor by
 * floor"). A building or a floor is archived only once every room on it is
 * closed (decided by the owner, pull request #37); the refusal is shown as
 * its text.
 */
export function BuildingPanel({ building, canEdit, branchId }: BuildingPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  // One form open at a time: the name, a floor's name or a new floor (task 2.7c-2b-1).
  const panel = usePanelEditing();
  const number = new Intl.NumberFormat(i18n.language);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'buildings', branchId] });

  const rename = useMutation({
    mutationFn: (record: BuildingRecord) =>
      answerOf(
        api.PUT('/api/setup/buildings/{id}', {
          params: { header: branchHeader(), path: { id: building.id } },
          body: record,
        }),
      ),
    onSuccess: refresh,
  });

  const archiveBuilding = useMutation({
    mutationFn: (restore: boolean) =>
      answerOf(
        api.POST(
          restore ? '/api/setup/buildings/{id}/restore' : '/api/setup/buildings/{id}/archive',
          {
            params: { header: branchHeader(), path: { id: building.id } },
          },
        ),
      ),
    onSuccess: refresh,
  });

  const addFloor = useMutation({
    mutationFn: (record: FloorRecord) =>
      answerOf(
        api.POST('/api/setup/buildings/{id}/floors', {
          params: { header: branchHeader(), path: { id: building.id } },
          body: record,
        }),
      ),
    onSuccess: refresh,
  });

  const renameFloor = useMutation({
    mutationFn: ({ id, record }: { id: string; record: FloorRecord }) =>
      answerOf(
        api.PUT('/api/setup/floors/{id}', {
          params: { header: branchHeader(), path: { id } },
          body: record,
        }),
      ),
    onSuccess: refresh,
  });

  const archiveFloor = useMutation({
    mutationFn: ({ id, restore }: { id: string; restore: boolean }) =>
      answerOf(
        api.POST(restore ? '/api/setup/floors/{id}/restore' : '/api/setup/floors/{id}/archive', {
          params: { header: branchHeader(), path: { id } },
        }),
      ),
    onSuccess: refresh,
  });

  const askBuilding = async () => {
    const archived = building.archivedAt !== null;
    if (
      await confirm({
        title: archived
          ? t('setup.buildings.restoreTitle', { count: 1, n: number.format(1) })
          : t('setup.buildings.archiveTitle', { count: 1, n: number.format(1) }),
        text: archived ? t('setup.buildings.restoreText') : t('setup.buildings.archiveText'),
        names: [building.name],
        action: archived ? t('setup.buildings.restore') : t('setup.buildings.archive'),
        destructive: !archived,
      })
    ) {
      archiveBuilding.mutate(archived);
    }
  };

  const askFloor = async (floor: Floor) => {
    const archived = floor.archivedAt !== null;
    if (
      await confirm({
        title: archived
          ? t('setup.buildings.restoreFloorTitle', { name: floor.name })
          : t('setup.buildings.archiveFloorTitle', { name: floor.name }),
        text: archived
          ? t('setup.buildings.restoreFloorText')
          : t('setup.buildings.archiveFloorText'),
        action: archived ? t('setup.buildings.restore') : t('setup.buildings.archive'),
        destructive: !archived,
      })
    ) {
      archiveFloor.mutate({ id: floor.id, restore: archived });
    }
  };

  const status = (archivedAt: string | null) =>
    archivedAt === null ? t('setup.buildings.active') : t('setup.buildings.archived');
  const archived = building.archivedAt !== null;

  return (
    <div ref={panel.root} className="grid gap-6">
      {panel.editing === 'record' ? (
        // The form takes the read view's place and its Save and Cancel are last.
        <BuildingForm
          building={building}
          label={building.name}
          onSave={async (record) => {
            await rename.mutateAsync(record);
            panel.stop({ saved: true });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('setup.buildings.status')}: {status(building.archivedAt)}
          </p>

          <section className="grid gap-3">
            <h3 className={SECTION_TITLE}>{t('setup.buildings.floorsTitle')}</h3>
            {building.floors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('setup.buildings.noFloors')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('setup.buildings.floor')}</TableHead>
                    <TableHead className="text-right">{t('setup.buildings.rooms')}</TableHead>
                    <TableHead>{t('setup.buildings.status')}</TableHead>
                    {canEdit && (
                      <TableHead>
                        <span className="sr-only">{t('setup.buildings.floorActions')}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {building.floors.map((floor) => (
                    <TableRow key={floor.id}>
                      <TableCell>
                        {canEdit && panel.editing === `floor:${floor.id}` ? (
                          <FloorForm
                            floor={floor}
                            label={floor.name}
                            onSave={async (record) => {
                              await renameFloor.mutateAsync({ id: floor.id, record });
                              panel.stop({ saved: true });
                            }}
                            onCancel={() => {
                              panel.stop();
                            }}
                          />
                        ) : (
                          floor.name
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number.format(floor.roomCount)}
                      </TableCell>
                      <TableCell>{status(floor.archivedAt)}</TableCell>
                      {canEdit && (
                        <TableCell className="space-x-2 whitespace-nowrap">
                          {panel.editing !== `floor:${floor.id}` && floor.archivedAt === null && (
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={t('setup.buildings.renameNamed', { name: floor.name })}
                              {...panel.opener(`floor:${floor.id}`)}
                              onClick={() => {
                                panel.start(`floor:${floor.id}`);
                              }}
                            >
                              {t('setup.buildings.rename')}
                            </Button>
                          )}
                          {!archived && (
                            <Button
                              variant={floor.archivedAt === null ? 'destructive' : 'secondary'}
                              size="sm"
                              disabled={archiveFloor.isPending}
                              aria-label={
                                floor.archivedAt === null
                                  ? t('setup.buildings.archiveNamed', { name: floor.name })
                                  : t('setup.buildings.restoreNamed', { name: floor.name })
                              }
                              onClick={() => {
                                void askFloor(floor);
                              }}
                            >
                              {floor.archivedAt === null
                                ? t('setup.buildings.archive')
                                : t('setup.buildings.restore')}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <FailureAlert error={archiveFloor.error} />
            {canEdit &&
              !archived &&
              (panel.editing === 'floor-new' ? (
                <div className="grid gap-2 rounded-lg border p-3">
                  <h4 className={SUBSECTION_TITLE}>{t('setup.buildings.addFloor')}</h4>
                  <FloorForm
                    floor={null}
                    label={t('setup.buildings.newFloor')}
                    onSave={async (record) => {
                      await addFloor.mutateAsync(record);
                      panel.stop({ saved: true });
                    }}
                    onCancel={() => {
                      panel.stop();
                    }}
                  />
                </div>
              ) : (
                <div>
                  <Button
                    variant="secondary"
                    {...panel.opener('floor-new')}
                    onClick={() => {
                      panel.start('floor-new');
                    }}
                  >
                    {t('setup.buildings.addFloor')}
                  </Button>
                </div>
              ))}
          </section>
        </>
      )}

      {canEdit && panel.editing === null && (
        <PanelActions
          primary={
            !archived && (
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
            archived && (
              <Button
                variant="secondary"
                disabled={archiveBuilding.isPending}
                onClick={() => {
                  void askBuilding();
                }}
              >
                {t('setup.buildings.restoreBuilding')}
              </Button>
            )
          }
          danger={
            !archived && (
              <Button
                variant="destructive"
                disabled={archiveBuilding.isPending}
                onClick={() => {
                  void askBuilding();
                }}
              >
                {t('setup.buildings.archiveBuilding')}
              </Button>
            )
          }
          error={archiveBuilding.error}
          saved={panel.saved}
        />
      )}
    </div>
  );
}

/** Whether a refusal is one the lists name beside the rows that went through, instead of stopping. */
export const isNamedRefusal = (error: unknown): boolean =>
  error instanceof ApiFailure &&
  (error.code === 'archive_refused' || error.code === 'floor_archived');
