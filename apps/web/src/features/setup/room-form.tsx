import {
  ROOM_CAPACITY_MAX,
  ROOM_CAPACITY_MIN,
  ROOM_STATUSES,
  ROOM_TYPES,
  roomRecordSchema,
  SHARED_ROOM_LESSONS_MAX,
  SHARED_ROOM_LESSONS_MIN,
  type Room,
  type RoomRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { CHECKED, CheckboxField, Field, NumberField, SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import type { FloorChoice } from './setup-api';

interface RoomFormProps {
  /** The record as saved; `null` for a new room. */
  room: Room | null;
  /** The floors a room can be put on: active floors of active buildings. */
  floors: readonly FloorChoice[];
  label: string;
  onSave: (record: RoomRecord) => Promise<void>;
}

/**
 * The record of a room (`03`, Building, floor, room: "name or number, floor,
 * type, capacity, status"; `edge/timetable`, Structure: the "shared" switch
 * and the number of lessons at once, asked only when the switch is on). The
 * floor is chosen in two steps, building then floor; only active floors are
 * offered, and a room on an archived floor can only be moved (decided by the
 * owner): the form says where it is and asks for an active floor.
 */
export function RoomForm({ room, floors, label, onSave }: RoomFormProps) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const onOffered = room !== null && floors.some((floor) => floor.floorId === room.floorId);
  const form = useRecordForm({
    schema: roomRecordSchema,
    initial: {
      name: room?.name ?? '',
      buildingId: onOffered ? room.buildingId : '',
      floorId: onOffered ? room.floorId : '',
      type: room?.type ?? 'classroom',
      capacity: room === null ? '' : String(room.capacity),
      status: room?.status ?? 'in_use',
      shared: room?.shared === true ? CHECKED : '',
      maxSimultaneousLessons:
        room?.maxSimultaneousLessons === undefined || room.maxSimultaneousLessons === null
          ? ''
          : String(room.maxSimultaneousLessons),
    },
    read: (typed) => ({
      name: typed.name,
      floorId: typed.floorId,
      type: typed.type,
      capacity: wholeNumber(typed.capacity),
      status: typed.status,
      shared: typed.shared === CHECKED,
      maxSimultaneousLessons:
        typed.shared === CHECKED ? (wholeNumber(typed.maxSimultaneousLessons) ?? null) : null,
    }),
    save: onSave,
  });

  const building = form.bind('buildingId');
  const floor = form.bind('floorId');
  const shared = form.bind('shared');
  const buildings = [...new Map(floors.map((one) => [one.buildingId, one.buildingName]))];
  const floorsOfBuilding = floors.filter((one) => one.buildingId === building.value);

  return (
    <RecordForm form={form} label={label}>
      {room !== null && !onOffered && (
        <p role="status" className="rounded-lg border border-dashed p-3 text-sm">
          {t('setup.rooms.onArchivedFloor', {
            building: room.buildingName,
            floor: room.floorName,
          })}
        </p>
      )}
      <Field label={t('setup.rooms.name')} autoComplete="off" {...form.bind('name')} />
      <SelectField
        label={t('setup.rooms.building')}
        options={[
          { value: '', label: t('setup.rooms.chooseBuilding') },
          ...buildings.map(([id, name]) => ({ value: id, label: name })),
        ]}
        {...building}
        onChange={(event) => {
          building.onChange(event);
          // Another building: its floors are others.
          floor.onChange({ target: { value: '' } });
        }}
      />
      <SelectField
        label={t('setup.rooms.floor')}
        options={[
          { value: '', label: t('setup.rooms.chooseFloor') },
          ...floorsOfBuilding.map((one) => ({ value: one.floorId, label: one.floorName })),
        ]}
        disabled={building.value === ''}
        {...floor}
      />
      <SelectField
        label={t('setup.rooms.type')}
        options={ROOM_TYPES.map((type) => ({ value: type, label: t(`setup.rooms.types.${type}`) }))}
        {...form.bind('type')}
      />
      <NumberField
        label={t('setup.rooms.capacity')}
        note={t('setup.rooms.capacityNote', {
          min: number.format(ROOM_CAPACITY_MIN),
          max: number.format(ROOM_CAPACITY_MAX),
        })}
        {...form.bind('capacity')}
      />
      <SelectField
        label={t('setup.rooms.status')}
        options={ROOM_STATUSES.map((status) => ({
          value: status,
          label: t(`setup.rooms.statuses.${status}`),
        }))}
        {...form.bind('status')}
      />
      <CheckboxField label={t('setup.rooms.sharedSwitch')} {...shared} />
      {shared.value === CHECKED && (
        <NumberField
          label={t('setup.rooms.maxLessons')}
          note={t('setup.rooms.maxLessonsNote', {
            min: number.format(SHARED_ROOM_LESSONS_MIN),
            max: number.format(SHARED_ROOM_LESSONS_MAX),
          })}
          {...form.bind('maxSimultaneousLessons')}
        />
      )}
    </RecordForm>
  );
}
