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
import { SaveCancelled } from '@/components/form/save-cancelled';
import { ClassForm } from './class-form';
import { groupsQuery, invalidateGroups } from './groups-api';
import { ClassMembers } from './class-members';
import { ClassTutors, tutorName } from './class-tutors';
import {
  archiveClass,
  classQuery,
  classMembersQuery,
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
  // The names of the groups a language change would make mix languages (task 3.2a).
  const groups = useQuery({ ...groupsQuery(branchId), enabled: branchId !== null && canEdit });
  const refresh = () =>
    Promise.all([invalidateClasses(queryClient), invalidateGroups(queryClient)]);

  // "Class changed, reload": the form closes, the class is read again and the
  // refusal stays at the bottom of the panel (.claude/rules/web.md).
  const [changed, setChanged] = useState<unknown>(null);
  const edit = useMutation({
    mutationFn: (record: ClassEdit) => editClass(row.id, record),
    onSuccess: async () => {
      setChanged(null);
      await refresh();
    },
    onError: async (error) => {
      if (error instanceof ApiFailure && error.code === 'class_changed') {
        setChanged(error);
        panel.stop({ focus: 'record' });
        await refresh();
      }
    },
  });
  // H23 of issue #105: the students in force or planned, the rows the archive
  // guard of the database counts, say up front why Archive is off. While the
  // answer is missing the button works and the server's refusal stays.
  const members = useQuery({
    ...classMembersQuery(branchId, row.id),
    enabled: branchId !== null && canArchive,
  });
  const holding =
    members.data === undefined
      ? 0
      : new Set(members.data.members.map((member) => member.studentId)).size;
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
              try {
                await edit.mutateAsync(record);
              } catch (error) {
                // Task 3.2a, decision 8: a language change that makes a group of
                // the class mix languages is confirmed, naming the groups.
                if (
                  !(error instanceof ApiFailure) ||
                  error.code !== 'class_language_mixes_groups'
                ) {
                  throw error;
                }
                const names = (error.details ?? [])
                  .filter((one) => one.path.startsWith('group.'))
                  .map(
                    (one) =>
                      groups.data?.groups.find((group) => `group.${group.id}` === one.path)?.name ??
                      t('classes.mixedGroupsUnnamed'),
                  );
                const confirmed = await confirm({
                  title: t('classes.mixedGroupsTitle'),
                  text: t('classes.mixedGroupsText'),
                  names,
                  action: t('classes.mixedGroupsConfirm'),
                });
                if (!confirmed) {
                  throw new SaveCancelled();
                }
                await edit.mutateAsync({ ...record, confirmMixedGroups: true });
              }
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
              ['average', t('classes.average')],
              ['attendance', t('classes.attendance')],
            ] as const
          ).map(([key, term]) => (
            // Decision 13 of 3.1a: these come with the journal.
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

      {panel.editing !== 'record' && (
        <ClassMembers schoolClass={schoolClass} years={years} canEdit={editable} panel={panel} />
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
                  disabled={archive.isPending || holding > 0}
                  onClick={() => {
                    void askArchive();
                  }}
                >
                  {t('classes.archiveClass')}
                </Button>
              )
            }
            note={
              canArchive &&
              !schoolClass.archived &&
              holding > 0 &&
              t('classes.archiveHasStudents', { count: holding })
            }
            error={archive.error ?? changed}
            saved={panel.saved}
          />
        )}
    </div>
  );
}
