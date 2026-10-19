import {
  lessonCorrectionBodySchema,
  timeText,
  type DayLesson,
  type LessonCorrectionBody,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { CHECKED, CheckboxField, SelectField, TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { roomsQuery } from '@/features/setup/setup-api';
import { BlockedRules } from './blocked-rules';
import { ruleText } from './rule-text';
import { correctLesson, correctionTeachersQuery } from './timetable-api';

type Kind = LessonCorrectionBody['kind'];

type Field = 'kind' | 'teacherId' | 'roomId' | 'reason' | 'confirm';

/**
 * The corrections a started lesson takes (task 5.6a-4): a restore for a
 * cancel with a reason; a cancel, the person who taught it or its room for a
 * lesson not cancelled; none for one cancelled by another cause (an exam).
 */
export function correctionKinds(lesson: DayLesson): Kind[] {
  if (!lesson.canCorrect) return [];
  if (lesson.cancelCause === 'reason') return ['restore'];
  if (lesson.cancelCause !== null) return [];
  return ['cancel', 'teacher', 'room'];
}

/**
 * The correction of a past lesson, one at a time, with a reason (task 5.6a-4,
 * pull request #163; `06`, How surprises are prevented: "A past lesson can
 * only be corrected one at a time by the Academic Vice Principal, with a
 * reason"): a dialog that sends once (`.claude/rules/web.md`), checked with
 * the shared schema, its key made when it opens. A refusal with warnings
 * (`correction_needs_confirm`) lists them with a tick, and the correction is
 * sent again with it (decisions 2 and 13).
 */
export function CorrectionDialog({
  lesson,
  branchId,
  subject,
  onClose,
  onCorrected,
}: {
  lesson: DayLesson;
  branchId: string | null;
  subject: string;
  onClose: () => void;
  onCorrected: (warnings: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const kinds = correctionKinds(lesson);
  const done = useRef<string[] | null>(null);
  const key = useRef(crypto.randomUUID());
  const form = useRecordForm<Field, LessonCorrectionBody>({
    schema: lessonCorrectionBodySchema,
    initial: { kind: kinds[0] ?? 'cancel', teacherId: '', roomId: '', reason: '', confirm: '' },
    read: (typed) => {
      const confirm = typed.confirm === CHECKED ? { confirm: true } : {};
      if (typed.kind === 'teacher') {
        return { kind: 'teacher', teacherId: typed.teacherId, reason: typed.reason, ...confirm };
      }
      if (typed.kind === 'room') {
        return { kind: 'room', roomId: typed.roomId, reason: typed.reason, ...confirm };
      }
      if (typed.kind === 'restore') {
        return {
          kind: 'restore',
          ...(typed.roomId === '' ? {} : { roomId: typed.roomId }),
          reason: typed.reason,
          ...confirm,
        };
      }
      return { kind: typed.kind, reason: typed.reason };
    },
    save: async (body) => {
      const answer = await correctLesson(lesson.id, body, key.current);
      done.current = answer.warnings.map((one) => one.rule);
    },
    message: (field) =>
      field === 'reason'
        ? t('timetable.day.reasonNeededChange')
        : field === 'teacherId'
          ? t('timetable.day.teacherNeeded')
          : field === 'roomId'
            ? t('timetable.day.roomNeeded')
            : undefined,
  });
  const kind = form.bind('kind').value;
  // A tick is for the warnings shown: another kind, person or room takes it
  // away, so its own warnings come back first (spec review of the code,
  // must-fix 2; decision 13).
  const untick = (field: 'kind' | 'teacherId' | 'roomId') => {
    const bound = form.bind(field);
    return {
      ...bound,
      onChange: (event: { target: { value: string } }) => {
        form.bind('confirm').onChange({ target: { value: '' } });
        bound.onChange(event);
      },
    };
  };
  const teachers = useQuery(correctionTeachersQuery(branchId, lesson.id, kind === 'teacher'));
  const rooms = useQuery({
    ...roomsQuery(branchId),
    enabled: kind === 'room' || kind === 'restore',
  });
  const element = useRef<HTMLFormElement>(null);
  const title = t('timetable.day.correctTitle', { subject, time: timeText(lesson.start) });
  const failure = form.failure;
  const code = failure instanceof ApiFailure ? failure.code : null;
  const details =
    failure instanceof ApiFailure &&
    (code === 'correction_blocked' || code === 'correction_needs_confirm')
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
      await onCorrected(done.current);
    }
  };

  const roomOptions = (rooms.data?.rooms ?? [])
    .filter((one) => one.status === 'in_use' && one.id !== lesson.room?.id)
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
          <SelectField
            label={t('timetable.day.correctKind')}
            options={kinds.map((one) => ({ value: one, label: t(`timetable.day.kind_${one}`) }))}
            {...untick('kind')}
          />
          {kind === 'teacher' &&
            (teachers.isError ? (
              <ErrorState error={teachers.error} onRetry={() => void teachers.refetch()} />
            ) : teachers.data === undefined ? (
              <LoadingOutline />
            ) : (
              <SelectField
                label={t('timetable.day.whoTaught')}
                options={[
                  { value: '', label: t('timetable.day.teacherChoose') },
                  ...teachers.data.teachers
                    .filter((one) => one.id !== lesson.teacher?.id)
                    .map((one) => ({ value: one.id, label: one.name })),
                ]}
                {...untick('teacherId')}
              />
            ))}
          {(kind === 'room' || kind === 'restore') &&
            (rooms.isError ? (
              <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
            ) : rooms.data === undefined ? (
              <LoadingOutline />
            ) : (
              <SelectField
                label={t('timetable.day.heldIn')}
                options={[
                  {
                    value: '',
                    label: t(
                      kind === 'restore'
                        ? 'timetable.day.restoreRoomKeep'
                        : 'timetable.day.roomChoose',
                    ),
                  },
                  ...roomOptions,
                ]}
                {...untick('roomId')}
              />
            ))}
          <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={failure} />
          {code === 'correction_blocked' && details.length > 0 && (
            <BlockedRules
              details={details}
              intoRoom={
                kind === 'room' || kind === 'restore'
                  ? (room) => {
                      untick('roomId').onChange({ target: { value: room.id } });
                    }
                  : undefined
              }
              intoText={(name) => t('timetable.day.useRoom', { room: name })}
            />
          )}
          {code === 'correction_needs_confirm' && details.length > 0 && (
            <div className="grid gap-2" data-correction-ticks="true">
              <p className="text-sm font-medium">{t('timetable.day.ticks')}</p>
              <ul className="grid gap-1 text-sm">
                {details.map((detail, index) => (
                  <li key={`${detail.path}-${String(index)}`}>{ruleText(t, detail.code)}</li>
                ))}
              </ul>
              <CheckboxField label={t('timetable.day.confirm')} {...form.bind('confirm')} />
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t('timetable.day.correctSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
