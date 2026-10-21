import { timeText, type Absence, type AbsenceLesson } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import { JournalSubstituteDialog } from './journal-substitute-dialog';
import { ruleText } from './rule-text';
import { SubstituteDialog, WithdrawSubstitutionDialog } from './substitute-dialog';
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
 * lessons inside it ("the list of own affected lessons", `06`). Task
 * 5.7b-2: each lesson with its substitute, "Substitute" and "Withdraw the
 * substitution" for a lesson that has not started, and per journal
 * "Substitute for the whole absence"; after a shortening or a withdraw, the
 * lessons kept with their substitute because their return clashes.
 */
export function AbsencePanel({ absence, columns, canEdit }: AbsencePanelProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'ru' || i18n.language === 'en' ? i18n.language : 'uz';
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const lessons = useQuery(absenceLessonsQuery(branchId, absence.id));
  const [kept, setKept] = useState<NonNullable<Absence['returns']>['kept']>([]);
  const [substituting, setSubstituting] = useState<AbsenceLesson | null>(null);
  const [withdrawing, setWithdrawing] = useState<AbsenceLesson | null>(null);
  const [journal, setJournal] = useState<AbsenceLesson | null>(null);
  const edit = useMutation({
    mutationFn: (body: Parameters<typeof editAbsence>[1]) => editAbsence(absence.id, body),
    onSuccess: async (answer) => {
      setKept(answer.returns?.kept ?? []);
      await invalidateTimetable(queryClient);
    },
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawAbsence(absence.id),
    onSuccess: async (answer) => {
      setKept(answer.returns?.kept ?? []);
      await invalidateTimetable(queryClient);
    },
  });
  const done = async () => {
    setSubstituting(null);
    setWithdrawing(null);
    setJournal(null);
    await invalidateTimetable(queryClient);
  };
  const canChange = (lesson: AbsenceLesson) =>
    canEdit && (lesson.state === 'needs_teacher' || lesson.state === 'upcoming');
  // The first lesson of each journal not started, where its action is offered.
  const journalFirsts = new Set([
    ...new Map(
      (lessons.data?.lessons ?? [])
        .filter((one) => one.journalId !== null && canChange(one))
        .reverse()
        .map((one) => [one.journalId, one.id]),
    ).values(),
  ]);
  const subjectOf = (lesson: AbsenceLesson) => `${lesson.unit} ${lesson.subject[language]}`;

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
      {kept.length > 0 && (
        <div className="grid gap-1 text-sm" data-absence-kept="true">
          <p className="font-medium">{t('timetable.absences.kept')}</p>
          <ul className="grid gap-1">
            {kept.map((one) => (
              <li key={one.lessonId} data-kept-lesson={one.lessonId}>
                {t('timetable.journalSubstitute.dateLine', {
                  date: schoolDateText(one.date, i18n.language, false),
                  text: one.rules.map((rule) => ruleText(t, rule)).join('; '),
                })}
              </li>
            ))}
          </ul>
        </div>
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
                <TableHead>{t('timetable.absences.room')}</TableHead>
                <TableHead>{t('timetable.absences.lessonState')}</TableHead>
                <TableHead>{t('timetable.absences.substitute')}</TableHead>
                {canEdit && <TableHead>{t('timetable.absences.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.data.lessons.map((lesson) => (
                <TableRow key={lesson.id} data-lesson={lesson.id} data-date={lesson.date}>
                  <TableCell>{schoolDateText(lesson.date, i18n.language, false)}</TableCell>
                  <TableCell>
                    {timeText(lesson.start)}–{timeText(lesson.end)}
                  </TableCell>
                  <TableCell>{lesson.unit}</TableCell>
                  <TableCell>{lesson.subject[language]}</TableCell>
                  <TableCell>{lesson.room ?? t('timetable.absences.noRoom')}</TableCell>
                  <TableCell>{t(`timetable.absences.state_${lesson.state}`)}</TableCell>
                  <TableCell data-substitute={lesson.substitute?.id ?? ''}>
                    {lesson.substitute?.name ?? t('timetable.absences.noSubstitute')}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      {canChange(lesson) && (
                        <div className="flex flex-wrap gap-2">
                          {lesson.substitute === null ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setSubstituting(lesson);
                              }}
                            >
                              {t('timetable.day.substitute')}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setWithdrawing(lesson);
                              }}
                            >
                              {t('timetable.day.withdrawSubstitution')}
                            </Button>
                          )}
                          {journalFirsts.has(lesson.id) && (
                            <Button
                              variant="secondary"
                              size="sm"
                              data-journal-action={lesson.journalId ?? ''}
                              onClick={() => {
                                setJournal(lesson);
                              }}
                            >
                              {t('timetable.absences.substituteJournal')}
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      {substituting !== null && (
        <SubstituteDialog
          lesson={substituting}
          branchId={branchId}
          subject={subjectOf(substituting)}
          onClose={() => {
            setSubstituting(null);
          }}
          onSubstituted={done}
        />
      )}
      {withdrawing !== null && (
        <WithdrawSubstitutionDialog
          lesson={withdrawing}
          subject={subjectOf(withdrawing)}
          onClose={() => {
            setWithdrawing(null);
          }}
          onWithdrawn={done}
        />
      )}
      {journal !== null && journal.journalId !== null && (
        <JournalSubstituteDialog
          title={t('timetable.absences.substituteJournalTitle', {
            subject: subjectOf(journal),
            name: absence.staff.name,
          })}
          target={{ kind: 'absence', absenceId: absence.id }}
          journalId={journal.journalId}
          branchId={branchId}
          onClose={() => {
            setJournal(null);
          }}
          onDone={done}
        />
      )}
    </div>
  );
}
