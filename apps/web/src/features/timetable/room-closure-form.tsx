import {
  roomClosureEditSchema,
  roomClosureMoveSchema,
  roomClosureRecordSchema,
  type RoomClosure,
  type RoomClosureEdit,
  type RoomClosureMove,
  type RoomClosureRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { DateField, Field, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ApiFailure } from '@/api/failure';
import { schoolDateText } from '@/lib/dates';

/** A room of the branch as the pickers offer it. */
export interface RoomChoice {
  readonly id: string;
  readonly name: string;
}

interface NewRoomClosureFormProps {
  /** The rooms that may be closed: not closed by their status. */
  rooms: readonly RoomChoice[];
  /** The first day offered: today in branch time. */
  today: string;
  label: string;
  onSave: (record: RoomClosureRecord) => Promise<void>;
}

/**
 * A new room closure (task 5.7a-2b): the room, the first and the last day,
 * both required (decision 3), and the reason, checked with the schema the
 * server checks.
 */
export function NewRoomClosureForm({ rooms, today, label, onSave }: NewRoomClosureFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: roomClosureRecordSchema,
    initial: { roomId: '', startsOn: today, endsOn: today, reason: '' },
    read: (typed) => ({
      roomId: typed.roomId,
      startsOn: typed.startsOn,
      endsOn: typed.endsOn,
      reason: typed.reason,
    }),
    message: (field) => (field === 'roomId' ? t('timetable.roomClosures.roomChoose') : undefined),
    save: onSave,
  });
  return (
    <RecordForm form={form} label={label}>
      <SelectField
        label={t('timetable.roomClosures.room')}
        options={[
          { value: '', label: t('timetable.roomClosures.roomChoose') },
          ...rooms.map((one) => ({ value: one.id, label: one.name })),
        ]}
        {...form.bind('roomId')}
      />
      <DateField label={t('timetable.roomClosures.firstDay')} {...form.bind('startsOn')} />
      <DateField label={t('timetable.roomClosures.lastDay')} {...form.bind('endsOn')} />
      <Field
        label={t('timetable.roomClosures.reason')}
        autoComplete="off"
        {...form.bind('reason')}
      />
    </RecordForm>
  );
}

interface RoomClosureDatesFormProps {
  closure: RoomClosure;
  label: string;
  onSave: (edit: RoomClosureEdit) => Promise<void>;
  onCancel: () => void;
}

/**
 * A change of the days of a closure (task 5.7a-2b, decision 4): the first
 * day only while the closure has not started (the server refuses it
 * afterwards), and the last day.
 */
export function RoomClosureDatesForm({
  closure,
  label,
  onSave,
  onCancel,
}: RoomClosureDatesFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm({
    schema: roomClosureEditSchema,
    initial: { startsOn: closure.startsOn, endsOn: closure.endsOn },
    read: (typed) => ({ startsOn: typed.startsOn, endsOn: typed.endsOn }),
    save: onSave,
  });
  const started = closure.state !== 'planned';
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <DateField
        label={t('timetable.roomClosures.firstDay')}
        disabled={started}
        {...form.bind('startsOn')}
      />
      <DateField label={t('timetable.roomClosures.lastDay')} {...form.bind('endsOn')} />
    </RecordForm>
  );
}

interface RoomClosureMoveFormProps {
  closure: RoomClosure;
  /** The rooms in use of the branch, the closed room left out. */
  rooms: readonly RoomChoice[];
  label: string;
  onSave: (move: RoomClosureMove) => Promise<void>;
  onCancel: () => void;
}

/**
 * "Move all to room R for the period" (task 5.7a-2b, decision 6): the room
 * and the reason of the one-day changes, prefilled with the closure's.
 */
export function RoomClosureMoveForm({
  closure,
  rooms,
  label,
  onSave,
  onCancel,
}: RoomClosureMoveFormProps) {
  const { t, i18n } = useTranslation();
  const form = useRecordForm({
    schema: roomClosureMoveSchema,
    initial: { roomId: '', reason: closure.reason },
    read: (typed) => ({ roomId: typed.roomId, reason: typed.reason }),
    message: (field) => (field === 'roomId' ? t('timetable.roomClosures.roomChoose') : undefined),
    save: onSave,
  });
  // Decision 6: the dates of the lessons that cannot go to the room, once each.
  const failure = form.failure;
  const blockedDates =
    failure instanceof ApiFailure && failure.code === 'room_move_blocked'
      ? [
          ...new Set(
            (failure.details ?? []).flatMap((one) => (one.day === undefined ? [] : [one.day])),
          ),
        ]
          .sort()
          .map((day) => schoolDateText(day, i18n.language, false))
      : [];
  return (
    <RecordForm
      form={form}
      label={label}
      onCancel={onCancel}
      failureText={
        blockedDates.length === 0
          ? undefined
          : t('timetable.roomClosures.moveBlocked', { dates: blockedDates.join(', ') })
      }
    >
      <SelectField
        label={t('timetable.roomClosures.moveRoom')}
        options={[
          { value: '', label: t('timetable.roomClosures.roomChoose') },
          ...rooms.map((one) => ({ value: one.id, label: one.name })),
        ]}
        {...form.bind('roomId')}
      />
      <Field
        label={t('timetable.roomClosures.moveReason')}
        autoComplete="off"
        {...form.bind('reason')}
      />
    </RecordForm>
  );
}
