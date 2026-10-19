import {
  classDisplayName,
  lessonCancelBodySchema,
  PERMISSIONS,
  permits,
  timeText,
  type DayLesson,
  type LessonCancelBody,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, SelectField, TextAreaField } from '@/components/field';
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
import { ruleText } from './rule-text';
import {
  cancelLesson,
  dayQuery,
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
 * be refused, with another room offered"). Today comes from the server; the
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
  const [message, setMessage] = useState<string | null>(null);

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

  const stateOf = (lesson: DayLesson): string => {
    if (lesson.cancelCause === 'reason') {
      return t('timetable.day.cancelledReason', { reason: lesson.cancelReason ?? '' });
    }
    if (lesson.cancelCause !== null) {
      return t(`timetable.day.cause_${lesson.cancelCause}`);
    }
    return t('timetable.day.asPlanned');
  };

  const blocked =
    restore.error instanceof ApiFailure && restore.error.code === 'restore_blocked'
      ? (restore.error.details ?? [])
      : [];
  const rules = blocked.filter((one) => one.path !== 'rooms');
  const rooms = blocked.flatMap((one) => (one.room === undefined ? [] : [one.room.name]));

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
        {message !== null && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {restore.error !== null && (
          <div className="grid gap-2" data-restore-failure="true">
            <FailureAlert error={restore.error} />
            {rules.length > 0 && (
              <ul className="grid gap-1 text-sm">
                {rules.map((detail, index) => (
                  <li key={`${detail.path}-${String(index)}`}>
                    {t('timetable.day.blocked', { rule: ruleText(t, detail.code) })}
                  </li>
                ))}
              </ul>
            )}
            {rules.some((one) => one.code.startsWith('room_')) && (
              <p className="text-sm">
                {rooms.length === 0
                  ? t('timetable.day.noFreeRoom')
                  : t('timetable.day.freeRooms', { rooms: rooms.join(', ') })}
              </p>
            )}
          </div>
        )}
        <div className={PANEL}>
          {day.isError ? (
            <ErrorState error={day.error} onRetry={() => void day.refetch()} />
          ) : day.data === undefined ? (
            <LoadingOutline />
          ) : day.data.lessons.length === 0 ? (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {day.data.lessons.map((lesson) => (
                  <TableRow key={lesson.id} data-lesson={lesson.id}>
                    <TableCell>
                      {timeText(lesson.start)}–{timeText(lesson.end)}
                    </TableCell>
                    <TableCell>{lesson.unit.name}</TableCell>
                    <TableCell>{lesson.subject.names[language]}</TableCell>
                    <TableCell>{lesson.teacher?.name ?? t('timetable.day.needsTeacher')}</TableCell>
                    <TableCell>{lesson.room?.name ?? t('timetable.day.needsRoom')}</TableCell>
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
                      </TableCell>
                    )}
                  </TableRow>
                ))}
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
    </>
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
  const form = useRecordForm<'reason', LessonCancelBody>({
    schema: lessonCancelBodySchema,
    initial: { reason: '' },
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
