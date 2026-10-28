import type { PreparedStamp as Stamp } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatMoment } from '@/lib/dates';

/**
 * How fresh a report's figures are (task 9.3b-1; `edge/system-behaviour`: "Prepared totals for
 * reports show 'updated at'. A page that finds them behind calculates from source and shows
 * 'updating'"). While updating, the figures shown were calculated from the journal for this
 * answer, so they are right; "Refresh" asks for the prepared ones. Nothing asks on a timer: such
 * a call would count as use of the session (`.claude/rules/web.md`).
 */
export function PreparedStamp({
  stamp,
  onRefresh,
  refreshing,
}: {
  stamp: Stamp;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (!stamp.updating && stamp.updatedAt === null) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-prepared="">
      <span data-prepared-state={stamp.updating ? 'updating' : 'updated'}>
        {stamp.updating
          ? t('prepared.updating')
          : t('prepared.updatedAt', {
              moment: formatMoment(i18n.language, stamp.updatedAt ?? ''),
            })}
      </span>
      {stamp.updating && (
        <Button size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>
          {t('prepared.refresh')}
        </Button>
      )}
    </p>
  );
}
