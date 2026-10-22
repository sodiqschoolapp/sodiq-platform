import {
  classDisplayName,
  lessonCancelBodySchema,
  lessonMoveBodySchema,
  lessonRestoreBodySchema,
  lessonRoomBodySchema,
  PERMISSIONS,
  permits,
  timeText,
  type DayChangeAnswer,
  type DayLesson,
  type LessonCancelBody,
  type LessonMoveBody,
  type LessonRestoreBody,
  type LessonRoomBody,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { CHECKED, DateField, SelectField, TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { classesQuery } from '@/features/classes/classes-api';
import { roomsQuery } from '@/features/setup/setup-api';
import { BlockedRules } from './blocked-rules';
import { BulkCancelDialog } from './bulk-cancel-dialog';
import { HeldDataTick } from './held-data';
import { CorrectionDialog, correctionKinds } from './correction-dialog';
import { ForcedDeleteDialog, LessonHistoryDialog } from './lesson-forced-delete';
import { SubstituteDialog, WithdrawSubstitutionDialog } from './substitute-dialog';
import { ruleText } from './rule-text';
import {
  cancelLesson,
  changeDayRoom,
  dayQuery,
  moveDayLesson,
  restoreLesson,
  timetableKey,
  versionsQuery,
} from './timetable-api';

type Language = 'uz' | 'ru' | 'en';

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * Day changes (task 5.6a-1, pull request #160): the stored lessons of a class
 * on a date, with the one-day cancel of a lesson and its restore (`06`,
 * Changes after publishing; edge/timetable, After publishing: "The restore can
 * be refused, with another room offered"), and the correction of a past lesson
 * (task 5.6a-4), and the class's exams marked "Exam" (task 5.6c-2). Today
 * comes from the server; the
 * buttons follow the answer and the role, the server decides.
 */
export function DayPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/timetable/day' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const language = languageOf(i18n.language);
  const edits = role !== null && permits(PERMISSIONS, role, 'timetable', 'edit');
  // Task 5.8b: the forced delete is the Super Admin's; the history is for every reader of the day.
  const deletes = role !== null && permits(PERMISSIONS, role, 'forced_deletes', 'edit');
  const versions = useQuery(versionsQuery(branchId));
  const classes = useQuery(classesQuery(branchId));
  const date = search.date ?? versions.data?.today ?? null;
  const active = (classes.data?.classes ?? [])
    .filter((one) => !one.archived && one.yearStatus !== 'closed')
    .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name));
  const classId =
    search.class !== undefined && active.some((one) => one.id === search.class)
      ? search.class
      : (active[0]?.id ?? null);
  const day = useQuery(dayQuery(branchId, date, classId));
  const [cancelling, setCancelling] = useState<DayLesson | null>(null);
  // A room change, a move, or a restore into a free room (task 5.6a-2).
  const [changing, setChanging] = useState<
    | { kind: 'room' | 'move'; lesson: DayLesson }
    | { kind: 'restore'; lesson: DayLesson; room: { id: string; name: string } }
    | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  // The bulk cancel of the date (task 5.6a-3).
  const [bulk, setBulk] = useState(false);
  // The correction of a past lesson (task 5.6a-4).
  const [correcting, setCorrecting] = useState<DayLesson | null>(null);
  // The substitution of a lesson and its withdrawal (task 5.7b-1).
  const [substituting, setSubstituting] = useState<DayLesson | null>(null);
  const [withdrawing, setWithdrawing] = useState<DayLesson | null>(null);
  // The forced delete of a lesson and the history of a lesson (task 5.8b).
  const [deleting, setDeleting] = useState<DayLesson | null>(null);
  const [historyOf, setHistoryOf] = useState<DayLesson | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: timetableKey(branchId) });
  const restore = useMutation({
    mutationFn: (lesson: DayLesson) => restoreLesson(lesson.id, crypto.randomUUID()),
    onSuccess: async (answer) => {
      setMessage(
        [
          t('timetable.day.restored'),
          ...answer.warnings.map((one) =>
            t('timetable.day.warning', { rule: ruleText(t, one.rule) }),
          ),
        ].join(' '),
      );
      await refresh();
    },
  });

  const go = (next: { date?: string; class?: string }) => {
    setMessage(null);
    restore.reset();
    void navigate({
      to: '/timetable/day',
      search: {
        ...((next.date ?? date ?? undefined) ? { date: next.date ?? date ?? '' } : {}),
        ...((next.class ?? classId) === null ? {} : { class: next.class ?? classId ?? '' }),
      },
    });
  };

  const header = (
    <PageHeader
      title={t('timetable.day.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('timetable.title'), to: '/timetable' },
      ]}
      actions={
        edits && date !== null && classId !== null ? (
          <Button
            variant="secondary"
            onClick={() => {
              setMessage(null);
              restore.reset();
              setBulk(true);
            }}
          >
            {t('timetable.bulk.open')}
          </Button>
        ) : undefined
      }
    />
  );
  if (versions.isError || classes.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={versions.error ?? classes.error}
          onRetry={() => {
            void versions.refetch();
            void classes.refetch();
          }}
        />
      </>
    );
  }
  if (versions.data === undefined || classes.data === undefined || date === null) {
    return (
      <>
        {header}
        <LoadingOutline />
      </>
    );
  }
  if (active.length === 0 || classId === null) {
    return (
      <>
        {header}
        <EmptyState text={t('timetable.day.noClasses')} />
      </>
    );
  }

  const shown = active.find((one) => one.id === classId);
  const className = shown === undefined ? '' : classDisplayName(shown.grade, shown.name);

  const stateOf = (lesson: DayLesson): string => {
    if (lesson.cancelCause === 'reason') {
      return t('timetable.day.cancelledReason', { reason: lesson.cancelReason ?? '' });
    }
    if (lesson.cancelCause !== null) {
      return t(`timetable.day.cause_${lesson.cancelCause}`);
    }
    // A started lesson is held or unresolved (task 5.6a-4, `lessonStateOf`).
    if (lesson.state === 'held') return t('timetable.day.held');
    // Tasks 5.7a-1 and 5.7a-2a: a lesson of a teacher away keeps its teacher and needs one.
    if (lesson.state === 'unresolved') {
      if (lesson.away === 'absence') return t('timetable.day.unresolvedAbsent');
      return lesson.away === null
        ? t('timetable.day.unresolved')
        : t(`timetable.day.unresolved_${lesson.away}`);
    }
    if (lesson.away === 'absence') return t('timetable.day.needsTeacherAbsent');
    if (lesson.away !== null) return t(`timetable.day.needsTeacher_${lesson.away}`);
    return t('timetable.day.asPlanned');
  };

  const blocked =
    restore.error instanceof ApiFailure && restore.error.code === 'restore_blocked'
      ? (restore.error.details ?? [])
      : [];
  const restoring = restore.variables ?? null;

  return (
    <>
      {header}
      <div className="grid gap-6">
        <div className={`${PANEL} grid max-w-3xl gap-4 sm:grid-cols-2`}>
          <DateField
            label={t('timetable.day.date')}
            value={date}
            onChange={(event) => {
              if (event.target.value !== '') go({ date: event.target.value });
            }}
          />
          <SelectField
            label={t('timetable.day.class')}
            value={classId}
            options={active.map((one) => ({
              value: one.id,
              label: classDisplayName(one.grade, one.name),
            }))}
            onChange={(event) => {
              go({ class: event.target.value });
            }}
          />
        </div>
        <p className="text-sm">
          <Link to="/timetable/exams" search={{ date }} className="text-link">
            {t('timetable.day.examsLink')}
          </Link>
        </p>
        {message !== null && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {restore.error !== null && (
          <div className="grid gap-2" data-restore-failure="true">
            <FailureAlert error={restore.error} />
            <BlockedRules
              details={blocked}
              intoRoom={
                edits && restoring !== null
                  ? (room) => {
                      setMessage(null);
                      setChanging({ kind: 'restore', lesson: restoring, room });
                    }
                  : undefined
              }
              intoText={(name) => t('timetable.day.restoreInto', { room: name })}
            />
          </div>
        )}
        <div className={PANEL}>
          {day.isError ? (
            <ErrorState error={day.error} onRetry={() => void day.refetch()} />
          ) : day.data === undefined ? (
            <LoadingOutline />
          ) : day.data.lessons.length === 0 && day.data.exams.length === 0 ? (
            <EmptyState text={t('timetable.day.empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('timetable.day.time')}</TableHead>
                  <TableHead>{t('timetable.day.unit')}</TableHead>
                  <TableHead>{t('timetable.day.subject')}</TableHead>
                  <TableHead>{t('timetable.day.teacher')}</TableHead>
                  <TableHead>{t('timetable.day.room')}</TableHead>
                  <TableHead>{t('timetable.day.state')}</TableHead>
                  {edits && <TableHead>{t('timetable.day.actions')}</TableHead>}
                  {/* Task 5.8b: the history of a lesson, for every reader of the day. */}
                  <TableHead>{t('timetable.day.historyColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* The class's exams of the date among its lessons by time,
                    marked "Exam" (task 5.6c-2; `06`, Exam: "It is shown on
                    every timetable view ..., marked 'exam'"). */}
                {[
                  ...day.data.exams.map((exam) => ({ start: exam.start, exam, lesson: null })),
                  ...day.data.lessons.map((lesson) => ({
                    start: lesson.start,
                    exam: null,
                    lesson,
                  })),
                ]
                  .sort((a, b) => a.start - b.start)
                  .map(({ exam, lesson }) =>
                    exam !== null ? (
                      <TableRow key={exam.id} data-exam={exam.id}>
                        <TableCell>
                          {timeText(exam.start)}–{timeText(exam.end)}
                        </TableCell>
                        {/* The class under "Class or group", the exam's title and subject
                            under "Subject", its invigilators under "Teacher". */}
                        <TableCell>{className}</TableCell>
                        <TableCell>
                          {exam.title}
                          {exam.subject !== null && <> · {exam.subject.names[language]}</>}
                        </TableCell>
                        <TableCell>{exam.invigilators.join(', ')}</TableCell>
                        <TableCell>{exam.room.name}</TableCell>
                        <TableCell className="font-semibold">{t('timetable.day.exam')}</TableCell>
                        {edits && <TableCell />}
                        <TableCell />
                      </TableRow>
                    ) : lesson === null ? null : (
                      <TableRow key={lesson.id} data-lesson={lesson.id}>
                        <TableCell>
                          {timeText(lesson.start)}–{timeText(lesson.end)}
                        </TableCell>
                        <TableCell>{lesson.unit.name}</TableCell>
                        <TableCell>{lesson.subject.names[language]}</TableCell>
                        <TableCell>
                          {lesson.teacher?.name ?? t('timetable.day.needsTeacher')}
                          {/* Task 5.7b-1: the substitute, and the teacher replaced. */}
                          {lesson.substitution !== null && (
                            <span data-substitution="true">
                              {' · '}
                              {lesson.substitution.replaced === null
                                ? t('timetable.day.substituteMark')
                                : t('timetable.day.substituteFor', {
                                    name: lesson.substitution.replaced.name,
                                  })}
                            </span>
                          )}
                          {lesson.away === 'absence' && <> · {t('timetable.day.absent')}</>}
                          {lesson.away !== null && lesson.away !== 'absence' && (
                            <> · {t(`timetable.day.away_${lesson.away}`)}</>
                          )}
                        </TableCell>
                        <TableCell>
                          {lesson.room?.name ?? t('timetable.day.needsRoom')}
                          {/* Task 5.7a-2b (decision 2): the room is out at the lesson's start. */}
                          {lesson.roomOut !== null && (
                            <> · {t(`timetable.day.roomOut_${lesson.roomOut}`)}</>
                          )}
                        </TableCell>
                        <TableCell>
                          {stateOf(lesson)}
                          {lesson.changed && <> · {t('timetable.day.changed')}</>}
                        </TableCell>
                        {edits && (
                          <TableCell>
                            {lesson.canCancel && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setMessage(null);
                                  restore.reset();
                                  setCancelling(lesson);
                                }}
                              >
                                {t('timetable.day.cancel')}
                              </Button>
                            )}
                            {lesson.canCancel && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setMessage(null);
                                  restore.reset();
                                  setChanging({ kind: 'room', lesson });
                                }}
                              >
                                {t('timetable.day.changeRoom')}
                              </Button>
                            )}
                            {lesson.canCancel && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setMessage(null);
                                  restore.reset();
                                  setChanging({ kind: 'move', lesson });
                                }}
                              >
                                {t('timetable.day.move')}
                              </Button>
                            )}
                            {lesson.canSubstitute && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setMessage(null);
                                  restore.reset();
                                  setSubstituting(lesson);
                                }}
                              >
                                {t('timetable.day.substitute')}
                              </Button>
                            )}
                            {lesson.canSubstitute && lesson.substitution !== null && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setMessage(null);
                                  restore.reset();
                                  setWithdrawing(lesson);
                                }}
                              >
                                {t('timetable.day.withdrawSubstitution')}
                              </Button>
                            )}
                            {lesson.canRestore && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={restore.isPending}
                                onClick={() => {
                                  setMessage(null);
                                  restore.mutate(lesson);
                                }}
                              >
                                {t('timetable.day.restore')}
                              </Button>
                            )}
                            {correctionKinds(lesson).length > 0 && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setMessage(null);
                                  restore.reset();
                                  setCorrecting(lesson);
                                }}
                              >
                                {t('timetable.day.correct')}
                              </Button>
                            )}
                            {deletes && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  setMessage(null);
                                  restore.reset();
                                  setDeleting(lesson);
                                }}
                              >
                                {t('timetable.day.forcedDelete')}
                              </Button>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setHistoryOf(lesson);
                            }}
                          >
                            {t('timetable.day.history')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ),
                  )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      {cancelling !== null && (
        <CancelDialog
          lesson={cancelling}
          subject={cancelling.subject.names[language]}
          onClose={() => {
            setCancelling(null);
          }}
          onCancelled={async () => {
            setCancelling(null);
            setMessage(t('timetable.day.cancelled'));
            await refresh();
          }}
        />
      )}
      {deleting !== null && (
        <ForcedDeleteDialog
          key={deleting.id}
          lesson={deleting}
          subject={deleting.subject.names[language]}
          onClose={() => {
            setDeleting(null);
          }}
          onDeleted={async () => {
            setDeleting(null);
            setMessage(t('timetable.forcedDelete.done'));
            await refresh();
          }}
        />
      )}
      {historyOf !== null && (
        <LessonHistoryDialog
          key={historyOf.id}
          lesson={historyOf}
          branchId={branchId}
          subject={historyOf.subject.names[language]}
          onClose={() => {
            setHistoryOf(null);
          }}
        />
      )}
      {substituting !== null && (
        <SubstituteDialog
          key={substituting.id}
          lesson={substituting}
          branchId={branchId}
          subject={substituting.subject.names[language]}
          onClose={() => {
            setSubstituting(null);
          }}
          onSubstituted={async (warnings) => {
            setSubstituting(null);
            setMessage(
              [
                t('timetable.day.substituted'),
                ...warnings.map((rule) =>
                  t('timetable.day.changedWarning', { rule: ruleText(t, rule) }),
                ),
              ].join(' '),
            );
            await refresh();
          }}
        />
      )}
      {withdrawing !== null && (
        <WithdrawSubstitutionDialog
          key={withdrawing.id}
          lesson={withdrawing}
          subject={withdrawing.subject.names[language]}
          onClose={() => {
            setWithdrawing(null);
          }}
          onWithdrawn={async () => {
            setWithdrawing(null);
            setMessage(t('timetable.day.substitutionWithdrawn'));
            await refresh();
          }}
        />
      )}
      {correcting !== null && (
        <CorrectionDialog
          key={correcting.id}
          lesson={correcting}
          branchId={branchId}
          subject={correcting.subject.names[language]}
          onClose={() => {
            setCorrecting(null);
          }}
          onCorrected={async (warnings) => {
            setCorrecting(null);
            setMessage(
              [
                t('timetable.day.corrected'),
                ...warnings.map((rule) =>
                  t('timetable.day.changedWarning', { rule: ruleText(t, rule) }),
                ),
              ].join(' '),
            );
            await refresh();
          }}
        />
      )}
      {bulk && (
        <BulkCancelDialog
          date={date}
          classes={active}
          startClassId={classId}
          longestDay={day.data?.longestDay ?? 0}
          language={language}
          onClose={() => {
            setBulk(false);
          }}
          onDone={async (answer) => {
            setBulk(false);
            setMessage(t('timetable.bulk.done', { count: answer.cancelled.length }));
            await refresh();
          }}
        />
      )}
      {changing !== null && (
        <ChangeDialog
          key={`${changing.kind}-${changing.lesson.id}`}
          change={changing}
          branchId={branchId}
          classId={classId}
          subject={changing.lesson.subject.names[language]}
          onClose={() => {
            setChanging(null);
          }}
          onChanged={async (warnings) => {
            setChanging(null);
            restore.reset();
            setMessage(
              [
                t(
                  changing.kind === 'room'
                    ? 'timetable.day.roomChanged'
                    : changing.kind === 'move'
                      ? 'timetable.day.moved'
                      : 'timetable.day.restored',
                ),
                ...warnings.map((rule) =>
                  t('timetable.day.changedWarning', { rule: ruleText(t, rule) }),
                ),
              ].join(' '),
            );
            await refresh();
          }}
        />
      )}
    </>
  );
}

type Change =
  | { kind: 'room' | 'move'; lesson: DayLesson }
  | { kind: 'restore'; lesson: DayLesson; room: { id: string; name: string } };

type ChangeField = 'roomId' | 'date' | 'lessonNumber' | 'reason';

/** Sends a change of the dialog, its body read again with its own schema. */
function sendChange(change: Change, body: unknown, key: string): Promise<DayChangeAnswer> {
  if (change.kind === 'room') {
    return changeDayRoom(change.lesson.id, lessonRoomBodySchema.parse(body), key);
  }
  if (change.kind === 'move') {
    return moveDayLesson(change.lesson.id, lessonMoveBodySchema.parse(body), key);
  }
  return restoreLesson(change.lesson.id, key, lessonRestoreBodySchema.parse(body));
}

/**
 * A one-day room change, a move, or the restore into a free room, each with
 * its reason (task 5.6a-2): a dialog that sends once (`.claude/rules/web.md`),
 * checked with the shared schema, its key made when it opens. The lesson
 * slots of the chosen date come from the server; a refusal lists its rules,
 * and a free room it offers fills the room field.
 */
function ChangeDialog({
  change,
  branchId,
  classId,
  subject,
  onClose,
  onChanged,
}: {
  change: Change;
  branchId: string | null;
  classId: string;
  subject: string;
  onClose: () => void;
  onChanged: (warnings: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { lesson } = change;
  const done = useRef<string[] | null>(null);
  const key = useRef(crypto.randomUUID());
  const rooms = useQuery(roomsQuery(branchId));
  const form = useRecordForm<ChangeField, LessonRoomBody | LessonMoveBody | LessonRestoreBody>({
    schema:
      change.kind === 'room'
        ? lessonRoomBodySchema
        : change.kind === 'move'
          ? lessonMoveBodySchema
          : lessonRestoreBodySchema,
    initial: {
      roomId: change.kind === 'restore' ? change.room.id : '',
      date: lesson.date,
      lessonNumber: '',
      reason: '',
    },
    read: (typed) =>
      change.kind === 'move'
        ? {
            date: typed.date,
            lessonNumber: typed.lessonNumber === '' ? undefined : Number(typed.lessonNumber),
            ...(typed.roomId === '' ? {} : { roomId: typed.roomId }),
            reason: typed.reason,
          }
        : { roomId: typed.roomId, reason: typed.reason },
    save: async (body) => {
      const answer = await sendChange(change, body, key.current);
      done.current = answer.warnings.map((one) => one.rule);
    },
    message: (field) =>
      field === 'reason'
        ? t('timetable.day.reasonNeededChange')
        : field === 'roomId'
          ? t('timetable.day.roomNeeded')
          : field === 'lessonNumber'
            ? t('timetable.day.slotNeeded')
            : undefined,
  });
  const date = form.bind('date').value;
  const slots = useQuery({
    ...dayQuery(branchId, date, classId),
    enabled: change.kind === 'move' && date !== '',
  });
  const element = useRef<HTMLFormElement>(null);
  const title = t(
    change.kind === 'room'
      ? 'timetable.day.roomTitle'
      : change.kind === 'move'
        ? 'timetable.day.moveTitle'
        : 'timetable.day.restoreTitle',
    { subject, time: timeText(lesson.start) },
  );
  const failure = form.failure;
  const details =
    failure instanceof ApiFailure &&
    (failure.code === 'day_change_blocked' || failure.code === 'restore_blocked')
      ? (failure.details ?? [])
      : [];

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current !== null) {
      await onChanged(done.current);
    }
  };

  const roomOptions = (rooms.data?.rooms ?? [])
    .filter((one) => one.status === 'in_use')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((one) => ({ value: one.id, label: one.name }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          {change.kind === 'restore' && (
            <p className="text-sm">{t('timetable.day.restoreRoom', { room: change.room.name })}</p>
          )}
          {change.kind === 'move' && (
            <>
              <DateField label={t('timetable.day.moveDate')} {...form.bind('date')} />
              {slots.isError ? (
                <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />
              ) : slots.data === undefined ? (
                <LoadingOutline />
              ) : slots.data.slots.length === 0 ? (
                <p className="text-sm">{t('timetable.day.noSlots')}</p>
              ) : (
                <SelectField
                  label={t('timetable.day.slot')}
                  options={[
                    { value: '', label: t('timetable.day.slotChoose') },
                    ...slots.data.slots.map((slot) => ({
                      value: String(slot.lessonNumber),
                      label: t('timetable.day.slotLabel', {
                        number: slot.lessonNumber,
                        start: timeText(slot.start),
                        end: timeText(slot.end),
                      }),
                    })),
                  ]}
                  {...form.bind('lessonNumber')}
                />
              )}
            </>
          )}
          {change.kind !== 'restore' &&
            (rooms.isError ? (
              <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
            ) : rooms.data === undefined ? (
              <LoadingOutline />
            ) : (
              <SelectField
                label={t(
                  change.kind === 'move' ? 'timetable.day.moveRoom' : 'timetable.day.newRoom',
                )}
                options={[
                  {
                    value: '',
                    label: t(
                      change.kind === 'move'
                        ? 'timetable.day.keepRoom'
                        : 'timetable.day.roomChoose',
                    ),
                  },
                  ...roomOptions,
                ]}
                {...form.bind('roomId')}
              />
            ))}
          <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={failure} />
          {details.length > 0 && (
            <BlockedRules
              details={details}
              intoRoom={
                change.kind === 'restore'
                  ? undefined
                  : (room) => {
                      form.bind('roomId').onChange({ target: { value: room.id } });
                    }
              }
              intoText={(name) => t('timetable.day.useRoom', { room: name })}
            />
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t(
                change.kind === 'room'
                  ? 'timetable.day.roomSend'
                  : change.kind === 'move'
                    ? 'timetable.day.moveSend'
                    : 'timetable.day.restoreSend',
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The cancel of one lesson with its reason: a dialog that sends once
 * (`.claude/rules/web.md`), its field checked with the shared schema, its key
 * made when it opens so that a repeat of the same press is harmless.
 */
function CancelDialog({
  lesson,
  subject,
  onClose,
  onCancelled,
}: {
  lesson: DayLesson;
  subject: string;
  onClose: () => void;
  onCancelled: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const done = useRef(false);
  const key = useRef(crypto.randomUUID());
  const form = useRecordForm<'reason' | 'confirm', LessonCancelBody>({
    schema: lessonCancelBodySchema,
    initial: { reason: '', confirm: '' },
    // Task 6.1b-2 (decision 2): the tick under the list of a lesson with data.
    read: (typed) => ({
      reason: typed.reason,
      ...(typed.confirm === CHECKED ? { confirm: true } : {}),
    }),
    save: async (body) => {
      await cancelLesson(lesson.id, body, key.current);
      done.current = true;
    },
    message: (field) => (field === 'reason' ? t('timetable.day.reasonNeeded') : undefined),
  });
  const element = useRef<HTMLFormElement>(null);
  const title = t('timetable.day.cancelTitle', { subject, time: timeText(lesson.start) });

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current) {
      await onCancelled();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={form.failure} />
          {form.failure instanceof ApiFailure && form.failure.code === 'cancel_holds_data' && (
            <HeldDataTick details={form.failure.details ?? []} confirm={form.bind('confirm')} />
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.keep')}</DialogClose>
            <Button type="submit" variant="destructive" disabled={form.status === 'saving'}>
              {t('timetable.day.cancelSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
