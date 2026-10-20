import { timeText, type Absence } from '@sodiq/shared';
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
import { AbsenceDatesForm } from './absence-form';
import {
  absenceLessonsQuery,
  editAbsence,
  invalidateTimetable,
  withdrawAbsence,
} from './timetable-api';

interface AbsencePanelProps {
  absence: Absence;
  columns: readonly Column<Absence>[];
  /** The role enters and changes absences (`timetable` `edit`). */
  canEdit: boolean;
}

/**
 * An absence in the side panel (task 5.7a-1): its fields, "Change the dates"
 * and "Withdraw" (before it starts, asked first), and the branch's own
 * lessons inside it ("the list of own affected lessons", `06`).
 */
export function AbsencePanel({ absence, columns, canEdit }: AbsencePanelProps) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const lessons = useQuery(absenceLessonsQuery(branchId, absence.id));
  const edit = useMutation({
    mutationFn: (body: Parameters<typeof editAbsence>[1]) => editAbsence(absence.id, body),
    onSuccess: () => invalidateTimetable(queryClient),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawAbsence(absence.id),
    onSuccess: () => invalidateTimetable(queryClient),
  });
  const language = i18n.language === 'ru' || i18n.language === 'en' ? i18n.language : 'uz';

  const askWithdraw = async () => {
    if (
      await confirm({
        title: t('timetable.absences.withdrawTitle'),
        text: t('timetable.absences.withdrawText'),
        names: [absence.staff.name],
        action: t('timetable.absences.withdraw'),
        destructive: true,
      })
    ) {
      withdraw.mutate();
    }
  };

  return (
    <div className="grid gap-6">
      {canEdit && absence.canEdit && panel.editing === 'dates' ? (
        <AbsenceDatesForm
          absence={absence}
          label={t('timetable.absences.changeDates')}
          onSave={async (body) => {
            await edit.mutateAsync(body);
            panel.stop({ saved: true, key: 'dates' });
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
              <dd>{column.cell(absence)}</dd>
            </div>
          ))}
        </dl>
      )}
      {canEdit && (absence.canEdit || absence.canWithdraw) && panel.editing === null && (
        <PanelActions
          primary={
            absence.canEdit && (
              <Button
                {...panel.opener('dates')}
                onClick={() => {
                  panel.start('dates');
                }}
              >
                {t('timetable.absences.changeDates')}
              </Button>
            )
          }
          danger={
            absence.canWithdraw && (
              <Button
                variant="destructive"
                disabled={withdraw.isPending}
                onClick={() => {
                  void askWithdraw();
                }}
              >
                {t('timetable.absences.withdraw')}
              </Button>
            )
          }
          error={withdraw.error}
          saved={panel.saved}
        />
      )}
      <section className="grid gap-3" aria-label={t('timetable.absences.lessons')}>
        <h3 className={SECTION_TITLE}>{t('timetable.absences.lessons')}</h3>
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
            title={t('timetable.absences.lessons')}
            text={t('timetable.absences.lessonsEmpty')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('timetable.absences.date')}</TableHead>
                <TableHead>{t('timetable.absences.time')}</TableHead>
                <TableHead>{t('timetable.absences.unit')}</TableHead>
                <TableHead>{t('timetable.absences.subject')}</TableHead>
                <TableHead>{t('timetable.absences.lessonState')}</TableHead>
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
                  <TableCell>{t(`timetable.absences.state_${lesson.state}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
