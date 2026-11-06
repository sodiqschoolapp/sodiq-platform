import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { cn } from '@/lib/utils';
import { schoolDateText } from '@/lib/dates';
import { datePlus } from './portal-api';

/** The week shown, with the previous, this and the next week (`12`: the week starts on Monday). */
export function PortalWeekBar({
  monday,
  today,
  onDate,
}: {
  monday: string;
  today: string;
  onDate: (date: string | undefined) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const sunday = datePlus(monday, 6);
  const thisWeek = monday <= today && today <= sunday;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className={cn(SECTION_TITLE, 'flex-1')}>
        {t('portal.week', {
          from: schoolDateText(monday, i18n.language, false),
          to: schoolDateText(sunday, i18n.language),
        })}
      </h2>
      <Button
        variant="secondary"
        onClick={() => {
          onDate(datePlus(monday, -7));
        }}
      >
        {t('portal.previousWeek')}
      </Button>
      <Button
        variant="secondary"
        disabled={thisWeek}
        onClick={() => {
          onDate(undefined);
        }}
      >
        {t('portal.thisWeek')}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          onDate(datePlus(monday, 7));
        }}
      >
        {t('portal.nextWeek')}
      </Button>
    </div>
  );
}
