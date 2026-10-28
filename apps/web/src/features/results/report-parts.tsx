import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useMayView } from '@/features/access/use-view';

/**
 * The parts the report pages of `08` share (task 9.3b-2): the Excel button, shown only to a
 * role with the area's `export`, and the reading of the address.
 */

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A text of the address, or nothing. */
export const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** A whole number of the address within its bounds, or nothing. */
export const wholeOf = (value: unknown, min: number, max: number): number | undefined => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
};

/** A date of the browser's calendar `days` from today (or from the Monday of this week). */
export const localDate = (days: number, fromMonday = false): string => {
  const at = new Date();
  if (fromMonday) at.setDate(at.getDate() - ((at.getDay() + 6) % 7));
  at.setDate(at.getDate() + days);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};

/** The minutes of a day as "08:30". */
export const clockText = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A share as "20%", or a dash. */
export const percentText = (value: number | null): string =>
  value === null ? '—' : `${String(value)}%`;

/** The download of a report's file; the page shows its failure with `FailureAlert`. */
export const useDownload = (run: () => Promise<void>) => useMutation({ mutationFn: run });

/** The Excel button of a report: hidden without `export` of its area, off while it cannot send. */
export function ExcelButton({
  area,
  download,
  disabled,
}: {
  area: string;
  download: ReturnType<typeof useDownload>;
  disabled: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const may = useMayView(area, 'export');
  if (!may) return null;
  return (
    <Button
      variant="secondary"
      disabled={disabled || download.isPending}
      onClick={() => {
        download.mutate();
      }}
    >
      <DownloadIcon />
      {t('results.reports.excel')}
    </Button>
  );
}
