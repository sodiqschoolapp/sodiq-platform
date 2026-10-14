import type {
  AcademicYear,
  ClassCreate,
  ClassEdit,
  ClassTutorEnd,
  ClassTutorGive,
  Room,
  SchoolClass,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import type { Column } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { ClassForm } from './class-form';
import { ClassTutors, tutorName } from './class-tutors';
import {
  archiveClass,
  classQuery,
  editClass,
  endTutor,
  giveTutor,
  invalidateClasses,
} from './classes-api';

interface ClassPanelProps {
  row: SchoolClass;
  /** The columns of the list: the read view shows each of them. */
  columns: readonly Column<SchoolClass>[];
  years: readonly AcademicYear[];
  rooms: readonly Room[];
  canEdit: boolean;
  canArchive: boolean;
}

/**
 * A class in the side panel (task 3.1a): its record read first, its Tutors
 * with their dates, and the actions at the bottom (Edit; Archive or Restore).
 * In a closed year a class is history (decision 18): nothing is offered.
 */
export function ClassPanel({ row, columns, years, rooms, canEdit, canArchive }: ClassPanelProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const detail = useQuery(classQuery(branchId, row.id));
  const refresh = () => invalidateClasses(queryClient);

  const edit = useMutation({
    mutationFn: (record: ClassEdit) => editClass(row.id, record),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: (restore: boolean) => archiveClass(row.id, restore),
    onSuccess: refresh,
  });
  const give = useMutation({
    mutationFn: (record: ClassTutorGive) => giveTutor(row.id, record),
    onSuccess: refresh,
  });
  const end = useMutation({
    mutationFn: ({ tutorId, record }: { tutorId: string; record: ClassTutorEnd }) =>
      endTutor(row.id, tutorId, record),
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
  const schoolClass = detail.data;
  const open = !schoolClass.archived && schoolClass.yearStatus !== 'closed';
  const editable = canEdit && open;
  const name = `${String(schoolClass.grade)} ${schoolClass.name}`;

  const askArchive = async () => {
    const active = !schoolClass.archived;
    const tutors = schoolClass.tutors
      .filter((one) => one.state !== 'ended')
      .map((one) =>
        t('classes.kindOf', { kind: t(`classes.kinds.${one.kind}`), name: tutorName(t, one) }),
      );
    if (
      await confirm({
        title: active ? t('classes.archiveTitle') : t('classes.restoreTitle'),
        text: active ? t('classes.archiveText') : t('classes.restoreText'),
        names: active ? [name, ...tutors] : [name],
        action: active ? t('classes.archiveClass') : t('classes.restoreClass'),
        destructive: active,
      })
    ) {
      archive.mutate(!active);
    }
  };

  return (
    <div className="grid gap-6">
      {editable && panel.editing === 'record' ? (
        <ClassForm
          schoolClass={schoolClass}
          years={years}
          rooms={rooms}
          label={name}
          onSave={async (record: ClassCreate | ClassEdit) => {
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
        <dl className="grid gap-3">
          {columns.map((column) => (
            <div key={column.key} className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{column.header}</dt>
              <dd>{column.cell(schoolClass)}</dd>
            </div>
          ))}
          {schoolClass.acting !== null && (
            <div className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{t('classes.acting')}</dt>
              <dd>{tutorName(t, schoolClass.acting)}</dd>
            </div>
          )}
          {(
            [
              ['students', t('classes.students')],
              ['average', t('classes.average')],
              ['attendance', t('classes.attendance')],
            ] as const
          ).map(([key, term]) => (
            // Decision 13: these come with memberships (3.1b) and the journal.
            <div key={key} className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{term}</dt>
              <dd>{t('classes.notYet')}</dd>
            </div>
          ))}
        </dl>
      )}

      {panel.editing !== 'record' && (
        <ClassTutors
          schoolClass={schoolClass}
          canEdit={editable}
          panel={panel}
          onGive={async (record) => {
            await give.mutateAsync(record);
          }}
          onEnd={async (tutorId, record) => {
            await end.mutateAsync({ tutorId, record });
          }}
        />
      )}

      {(editable || (canArchive && schoolClass.yearStatus !== 'closed')) &&
        panel.editing === null && (
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
              schoolClass.archived && (
                <Button
                  variant="secondary"
                  disabled={archive.isPending}
                  onClick={() => {
                    void askArchive();
                  }}
                >
                  {t('classes.restoreClass')}
                </Button>
              )
            }
            danger={
              canArchive &&
              !schoolClass.archived && (
                <Button
                  variant="destructive"
                  disabled={archive.isPending}
                  onClick={() => {
                    void askArchive();
                  }}
                >
                  {t('classes.archiveClass')}
                </Button>
              )
            }
            error={archive.error}
            saved={panel.saved}
          />
        )}
    </div>
  );
}
