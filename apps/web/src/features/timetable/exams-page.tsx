import {
  examCancelBodySchema,
  PERMISSIONS,
  permits,
  timeText,
  type Exam,
  type ExamCancelBody,
  type ExamSaveAnswer,
} from '@sodiq/shared';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import { type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
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
import { useView } from '@/features/access/use-view';
import { groupsQuery } from '@/features/classes/groups-api';
import { BlockedRules } from './blocked-rules';
import { ExamForm } from './exam-form';
import { cancelExam, dayQuery, examsQuery, timetableKey, versionsQuery } from './timetable-api';

type Language = 'uz' | 'ru' | 'en';

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/** The classes and groups of an exam, room by room. */
const seatsOf = (exam: Exam) =>
  exam.rooms
    .map((one) =>
      [one.room.name, [...one.classes, ...one.groups].map((unit) => unit.name).join(', ')].join(
        ': ',
      ),
    )
    .join('; ');

const invigilatorsOf = (exam: Exam) =>
  exam.rooms.flatMap((one) => one.invigilators.map((person) => person.name)).join(', ');

/**
 * The exams of a date (task 5.6c-2, pull request #182; `06`, Changes after
 * publishing, Exam: "The Academic Vice Principal creates, changes and cancels
 * exams, from today on and only in slots that have not started; a past exam
 * is kept as history"): a list of the date's exams, standing and cancelled,
 * with the exam opened in the side panel. A role with `timetable` `edit`
 * makes, changes and cancels them; a started one (by the server's moment,
 * never the device's clock) is history.
 */
export function ExamsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/timetable/exams' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const language = languageOf(i18n.language);
  const edits = role !== null && permits(PERMISSIONS, role, 'timetable', 'edit');
  const versions = useQuery(versionsQuery(branchId));
  const date = search.date ?? versions.data?.today ?? null;
  const exams = useQuery(examsQuery(branchId, date));
  const [editing, setEditing] = useState<{ exam: Exam | null } | null>(null);
  const [cancelling, setCancelling] = useState<Exam | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: timetableKey(branchId) });
  const go = (next: ListSearch & { date?: string }, how: 'push' | 'replace' = 'push') => {
    void navigate({
      to: '/timetable/exams',
      search: { ...next, ...(next.date === undefined ? {} : { date: next.date }) },
      replace: how === 'replace',
    });
  };

  const stateOf = (exam: Exam) =>
    exam.cancelled
      ? t('timetable.exams.cancelled')
      : exam.started
        ? t('timetable.exams.started')
        : t('timetable.exams.standing');

  const columns: Column<Exam>[] = [
    {
      key: 'time',
      header: t('timetable.exams.time'),
      cell: (row) => `${timeText(row.start)}–${timeText(row.end)}`,
      sortValue: (row) => row.start,
      opens: true,
    },
    {
      key: 'title',
      header: t('timetable.exams.examTitle'),
      cell: (row) => row.title,
      sortValue: (row) => row.title,
      searchText: (row) => row.title,
    },
    {
      key: 'subject',
      header: t('timetable.exams.subject'),
      cell: (row) => row.subject?.names[language] ?? '',
    },
    {
      key: 'rooms',
      header: t('timetable.exams.rooms'),
      cell: seatsOf,
      searchText: seatsOf,
    },
    {
      key: 'invigilators',
      header: t('timetable.exams.invigilators'),
      cell: invigilatorsOf,
      searchText: invigilatorsOf,
    },
    {
      key: 'state',
      header: t('timetable.exams.state'),
      cell: (row) => stateOf(row),
    },
  ];

  const newButton = edits && date !== null && (
    <Button
      onClick={() => {
        setMessage(null);
        setEditing({ exam: null });
      }}
    >
      {t('timetable.exams.new')}
    </Button>
  );

  const header = (
    <PageHeader
      title={t('timetable.exams.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('timetable.title'), to: '/timetable' },
      ]}
      actions={newButton === false ? undefined : newButton}
    />
  );
  if (versions.isError) {
    return (
      <>
        {header}
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      </>
    );
  }
  if (date === null) {
    return (
      <>
        {header}
        <LoadingOutline />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-6">
        <div className={`${PANEL} grid max-w-3xl gap-4 sm:grid-cols-2`}>
          <DateField
            label={t('timetable.exams.date')}
            value={date}
            onChange={(event) => {
              if (event.target.value !== '') {
                setMessage(null);
                go({ date: event.target.value });
              }
            }}
          />
          <p className="self-end text-sm">
            <Link to="/timetable/day" search={{ date }} className="text-link">
              {t('timetable.exams.toDay')}
            </Link>
          </p>
        </div>
        {message !== null && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        <ListPage
          listId="exams"
          caption={t('timetable.exams.caption')}
          rows={exams.data?.exams}
          error={exams.error ?? undefined}
          onRetry={() => {
            void exams.refetch();
          }}
          rowId={(row) => row.id}
          rowName={(row) => row.title}
          columns={columns}
          search={search}
          onSearchChange={(next, how) => {
            go({ ...next, date }, how);
          }}
          empty={{
            title: t('timetable.exams.emptyTitle'),
            text: t('timetable.exams.empty'),
            action: newButton === false ? undefined : newButton,
          }}
          panel={(row) => (
            <div className="grid gap-3 text-sm" data-exam-panel={row.id}>
              <p>
                {timeText(row.start)}–{timeText(row.end)} · {stateOf(row)}
              </p>
              {row.subject !== null && <p>{row.subject.names[language]}</p>}
              <ul className="grid gap-1">
                {row.rooms.map((one) => (
                  <li key={one.room.id}>
                    {t('timetable.exams.roomLine', {
                      room: one.room.name,
                      units: [...one.classes, ...one.groups].map((unit) => unit.name).join(', '),
                      invigilators: one.invigilators.map((person) => person.name).join(', '),
                    })}
                  </li>
                ))}
              </ul>
              {edits && !row.cancelled && !row.started && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setMessage(null);
                      setEditing({ exam: row });
                    }}
                  >
                    {t('timetable.exams.change')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setMessage(null);
                      setCancelling(row);
                    }}
                  >
                    {t('timetable.exams.cancel')}
                  </Button>
                </div>
              )}
            </div>
          )}
        />
      </div>
      {editing !== null && (
        <ExamForm
          key={editing.exam?.id ?? 'new'}
          exam={editing.exam}
          date={date}
          branchId={branchId}
          language={language}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={async (answer: ExamSaveAnswer) => {
            setEditing(null);
            setMessage(
              t(editing.exam === null ? 'timetable.exams.created' : 'timetable.exams.changed'),
            );
            if (answer.exam.date !== date) go({ date: answer.exam.date });
            await refresh();
          }}
        />
      )}
      {cancelling !== null && (
        <CancelExamDialog
          key={cancelling.id}
          exam={cancelling}
          branchId={branchId}
          language={language}
          onClose={() => {
            setCancelling(null);
          }}
          onCancelled={async () => {
            setCancelling(null);
            setMessage(t('timetable.exams.cancelledDone'));
            await refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * The cancel of an exam (task 5.6c-2; `06`, Exam: "cancelling the exam
 * restores only the lessons it cancelled, by the rule for a restored
 * lesson"): asked once; when a lesson can no longer come back
 * (`exam_restore_blocked`), the lessons are listed with the rooms free at
 * their time, and the cancel is sent again keeping them cancelled with a
 * typed reason (decision 3 of 5.6c-1, decision 5 of the plan). A lesson so
 * kept is a one-day cancel: the day page restores it into a free room.
 */
function CancelExamDialog({
  exam,
  branchId,
  language,
  onClose,
  onCancelled,
}: {
  exam: Exam;
  branchId: string | null;
  language: Language;
  onClose: () => void;
  onCancelled: () => Promise<void>;
}) {
  const { t } = useTranslation();
  // The lessons the exam keeps cancelled, named from the day of each class
  // that sits (spec review of the code, must-fix 3); a group's lesson is on
  // the day of a class that feeds it.
  const groups = useQuery(groupsQuery(branchId));
  const groupIds = new Set(exam.rooms.flatMap((one) => one.groups.map((unit) => unit.id)));
  const classIds = [
    ...new Set([
      ...exam.rooms.flatMap((one) => one.classes.map((unit) => unit.id)),
      ...(groups.data?.groups ?? [])
        .filter((one) => groupIds.has(one.id))
        .flatMap((one) => one.classes.map((unit) => unit.id)),
    ]),
  ];
  const days = useQueries({
    queries: classIds.map((classId) => dayQuery(branchId, exam.date, classId)),
  });
  const lessonsById = new Map(
    days.flatMap((one) => one.data?.lessons ?? []).map((one) => [one.id, one]),
  );
  const done = useRef(false);
  // A key per body: the second send keeps lessons the first did not.
  const keys = useRef(new Map<string, string>());
  const [blocked, setBlocked] = useState<readonly string[]>([]);
  const form = useRecordForm<'keepReason', ExamCancelBody>({
    schema: examCancelBodySchema,
    initial: { keepReason: '' },
    read: (typed) =>
      blocked.length === 0 ? {} : { keepCancelled: [...blocked], keepReason: typed.keepReason },
    save: async (body) => {
      const sent = JSON.stringify(body.keepCancelled ?? []);
      const key = keys.current.get(sent) ?? crypto.randomUUID();
      keys.current.set(sent, key);
      try {
        await cancelExam(exam.id, body, key);
        done.current = true;
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'exam_restore_blocked') {
          // A rule names the lessons on both sides of the clash: only the
          // exam's own lessons are kept cancelled.
          const own = new Set(exam.lessonIds);
          setBlocked((before) => [
            ...new Set([
              // The lessons kept on an earlier send stay kept (spec review of
              // the code, should-fix 8).
              ...before,
              ...(error.details ?? [])
                .flatMap((one) => one.rule?.lessonIds ?? [])
                .filter((id) => own.has(id)),
            ]),
          ]);
        }
        throw error;
      }
    },
    message: (field) =>
      field === 'keepReason' ? t('timetable.exams.keepReasonNeeded') : undefined,
  });
  const element = useRef<HTMLFormElement>(null);
  const title = t('timetable.exams.cancelTitle', { title: exam.title });
  const failure = form.failure;
  const details =
    failure instanceof ApiFailure && failure.code === 'exam_restore_blocked'
      ? (failure.details ?? [])
      : [];

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const sent = await form.submit();
    if (!sent) {
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
          <p className="text-sm">{t('timetable.exams.cancelText')}</p>
          <FailureAlert error={failure} />
          {details.length > 0 && (
            <div className="grid gap-2" data-exam-restore-blocked="true">
              <BlockedRules
                details={details}
                intoText={(name) => t('timetable.day.useRoom', { room: name })}
              />
            </div>
          )}
          {blocked.length > 0 && (
            <ul className="grid gap-1 text-sm" data-exam-kept-lessons="true">
              {blocked.map((id) => {
                const lesson = lessonsById.get(id);
                return (
                  <li key={id}>
                    {lesson === undefined
                      ? t('timetable.exams.keptLesson')
                      : t('timetable.exams.lesson', {
                          start: timeText(lesson.start),
                          end: timeText(lesson.end),
                          unit: lesson.unit.name,
                          subject: lesson.subject.names[language],
                          teacher: lesson.teacher?.name ?? t('timetable.day.needsTeacher'),
                        })}
                  </li>
                );
              })}
            </ul>
          )}
          {blocked.length > 0 && (
            <TextAreaField
              label={t('timetable.exams.keepReason')}
              rows={3}
              {...form.bind('keepReason')}
            />
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              {t('timetable.exams.keepExam')}
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={form.status === 'saving'}>
              {t(
                blocked.length > 0 ? 'timetable.exams.cancelKeeping' : 'timetable.exams.cancelSend',
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
