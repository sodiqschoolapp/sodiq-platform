import { timeText, type RoomClosure } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import type { Column } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import { RoomClosureDatesForm, RoomClosureMoveForm, type RoomChoice } from './room-closure-form';
import {
  editRoomClosure,
  invalidateTimetable,
  moveRoomClosure,
  roomClosureLessonsQuery,
  withdrawRoomClosure,
} from './timetable-api';

interface RoomClosurePanelProps {
  closure: RoomClosure;
  columns: readonly Column<RoomClosure>[];
  /** The role enters and changes closures (`timetable` `edit`). */
  canEdit: boolean;
  /** The rooms "move all" may go to: in use, the closed room left out. */
  rooms: readonly RoomChoice[];
}

/**
 * A room closure in the side panel (task 5.7a-2b): its fields, "Change the
 * dates", "Move all to another room" (decision 6) and "Withdraw" (before it
 * starts, asked first), and the lessons of the room inside it, each marked
 * when it still needs a room.
 */
export function RoomClosurePanel({ closure, columns, canEdit, rooms }: RoomClosurePanelProps) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const lessons = useQuery(roomClosureLessonsQuery(branchId, closure.id));
  const edit = useMutation({
    mutationFn: (body: Parameters<typeof editRoomClosure>[1]) => editRoomClosure(closure.id, body),
    onSuccess: () => invalidateTimetable(queryClient),
  });
  const move = useMutation({
    mutationFn: (body: Parameters<typeof moveRoomClosure>[1]) => moveRoomClosure(closure.id, body),
    onSuccess: () => invalidateTimetable(queryClient),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawRoomClosure(closure.id),
    onSuccess: () => invalidateTimetable(queryClient),
  });
  const language = i18n.language === 'ru' || i18n.language === 'en' ? i18n.language : 'uz';
  const waiting = (lessons.data?.lessons ?? []).filter((one) => one.needsRoom).length;

  const askWithdraw = async () => {
    if (
      await confirm({
        title: t('timetable.roomClosures.withdrawTitle'),
        text: t('timetable.roomClosures.withdrawText'),
        names: [closure.room.name],
        action: t('timetable.roomClosures.withdraw'),
        destructive: true,
      })
    ) {
      withdraw.mutate();
    }
  };

  return (
    <div className="grid gap-6">
      {canEdit && closure.canEdit && panel.editing === 'dates' ? (
        <RoomClosureDatesForm
          closure={closure}
          label={t('timetable.roomClosures.changeDates')}
          onSave={async (body) => {
            await edit.mutateAsync(body);
            panel.stop({ saved: true, key: 'dates' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : canEdit && closure.canEdit && panel.editing === 'move' ? (
        <RoomClosureMoveForm
          closure={closure}
          rooms={rooms}
          label={t('timetable.roomClosures.moveAll')}
          onSave={async (body) => {
            await move.mutateAsync(body);
            panel.stop({ saved: true, key: 'move' });
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
              <dd>{column.cell(closure)}</dd>
            </div>
          ))}
        </dl>
      )}
      {canEdit && (closure.canEdit || closure.canWithdraw) && panel.editing === null && (
        <PanelActions
          primary={
            closure.canEdit && (
              <Button
                {...panel.opener('dates')}
                onClick={() => {
                  panel.start('dates');
                }}
              >
                {t('timetable.roomClosures.changeDates')}
              </Button>
            )
          }
          secondary={
            closure.canEdit &&
            waiting > 0 && (
              <Button
                variant="secondary"
                {...panel.opener('move')}
                onClick={() => {
                  panel.start('move');
                }}
              >
                {t('timetable.roomClosures.moveAll')}
              </Button>
            )
          }
          danger={
            closure.canWithdraw && (
              <Button
                variant="destructive"
                disabled={withdraw.isPending}
                onClick={() => {
                  void askWithdraw();
                }}
              >
                {t('timetable.roomClosures.withdraw')}
              </Button>
            )
          }
          error={withdraw.error}
          saved={panel.saved}
        />
      )}
      <section className="grid gap-3" aria-label={t('timetable.roomClosures.lessons')}>
        <h3 className={SECTION_TITLE}>{t('timetable.roomClosures.lessons')}</h3>
        {lessons.isError ? (
          <ErrorState
            error={lessons.error}
            onRetry={() => {
              void lessons.refetch();
            }}
          />
        ) : lessons.data === undefined ? (
          <LoadingOutline lines={3} />
        ) : lessons.data.lessons.length === 0 ? (
          <EmptyState
            title={t('timetable.roomClosures.lessons')}
            text={t('timetable.roomClosures.lessonsEmpty')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('timetable.roomClosures.date')}</TableHead>
                <TableHead>{t('timetable.roomClosures.time')}</TableHead>
                <TableHead>{t('timetable.roomClosures.unit')}</TableHead>
                <TableHead>{t('timetable.roomClosures.subject')}</TableHead>
                <TableHead>{t('timetable.roomClosures.teacher')}</TableHead>
                <TableHead>{t('timetable.roomClosures.lessonState')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.data.lessons.map((lesson) => (
                <TableRow key={lesson.id} data-lesson={lesson.id}>
                  <TableCell>{schoolDateText(lesson.date, i18n.language, false)}</TableCell>
                  <TableCell>
                    {timeText(lesson.start)}–{timeText(lesson.end)}
                  </TableCell>
                  <TableCell>{lesson.unit}</TableCell>
                  <TableCell>{lesson.subject[language]}</TableCell>
                  <TableCell>{lesson.teacher ?? t('timetable.roomClosures.noTeacher')}</TableCell>
                  <TableCell>
                    {lesson.needsRoom
                      ? t('timetable.roomClosures.needsRoom')
                      : t(`timetable.absences.state_${lesson.state}`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
