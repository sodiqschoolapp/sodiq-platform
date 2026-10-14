import type { GroupSlotCheck, Weekday } from '@sodiq/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { ErrorState } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SECTION_TITLE } from '@/components/ui/control';
import { rangeText } from '@/features/setup/templates-api';
import { weekdayName } from '@/lib/dates';

/**
 * The lesson slots both grades of a group share on each working weekday
 * (decision 9; `edge/timetable`: "only in a lesson slot that has the same
 * start and end time in the day templates of both grades on that weekday"),
 * with the warning when none does. Shown, never refused: the load step of
 * task 3.4 refuses such a group.
 */
export function SharedSlots({ slots }: { slots: GroupSlotCheck['slots'] }) {
  const { t, i18n } = useTranslation();
  if (slots === null) {
    return null;
  }
  const none = slots.days.every((day) => day.slots.length === 0);
  return (
    <section className="grid gap-1.5" aria-label={t('groups.sharedSlots')}>
      <h3 className={SECTION_TITLE}>{t('groups.sharedSlots')}</h3>
      {none ? (
        <Alert variant="warning" data-no-shared-slot="">
          <WarningIcon aria-hidden />
          <AlertDescription>{t('groups.noSharedSlot')}</AlertDescription>
        </Alert>
      ) : (
        <ul className="grid gap-0.5 text-sm">
          {slots.days.map((day) => {
            const name = weekdayName(i18n.language, day.weekday as Weekday);
            return (
              <li key={day.weekday}>
                {day.slots.length === 0
                  ? t('groups.slotDayNone', { day: name })
                  : t('groups.slotDay', {
                      day: name,
                      slots: day.slots.map((slot) => rangeText(t, slot.start, slot.end)).join(', '),
                    })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The shared slots of the classes chosen in a form, read before the save. */
export function GroupSlots({ query }: { query: UseQueryResult<GroupSlotCheck> }) {
  const { t } = useTranslation();
  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (query.data === undefined) {
    return <p className="text-sm text-muted-foreground">{t('groups.slotsLoading')}</p>;
  }
  return <SharedSlots slots={query.data.slots} />;
}
