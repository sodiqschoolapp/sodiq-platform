import type { ErrorDetail } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ruleText } from './rule-text';

/**
 * The blocked rules of a refused one-day change, and the rooms free at its
 * time when a rule of the room blocks; `intoRoom` sends the change again into
 * one of them (task 5.6a-2; edge/timetable, After publishing: "The restore can
 * be refused, with another room offered").
 */
export function BlockedRules({
  details,
  intoRoom,
  intoText,
}: {
  details: readonly ErrorDetail[];
  intoRoom?: ((room: { id: string; name: string }) => void) | undefined;
  intoText: (name: string) => string;
}) {
  const { t } = useTranslation();
  const rules = details.filter((one) => one.path !== 'rooms');
  const rooms = details.flatMap((one) => (one.room === undefined ? [] : [one.room]));
  return (
    <>
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
            : t('timetable.day.freeRooms', { rooms: rooms.map((one) => one.name).join(', ') })}
        </p>
      )}
      {intoRoom !== undefined && rooms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rooms.map((room) => (
            <Button
              key={room.id}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                intoRoom(room);
              }}
            >
              {intoText(room.name)}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
