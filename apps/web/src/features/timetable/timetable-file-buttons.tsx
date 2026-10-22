import type { ViewExportFormat } from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { answerOf, ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { DownloadIcon, PrintIcon } from '@/components/icons';
import { fileNameOf, save } from '@/components/list/use-export';
import { Button } from '@/components/ui/button';

type Action = 'print' | ViewExportFormat;

/** What the generated client answers for a file asked with `parseAs: 'blob'`. */
interface FileResult {
  response: Response;
}

/**
 * Print, PDF and Excel buttons of a timetable file (task 5.9c-1, pull request
 * #199; shared with the version print of task 5.9c-2, pull request #200). The
 * server makes every file and logs it. Print opens the PDF in a new tab,
 * where the browser prints it: the tab is opened in the click itself, so no
 * popup blocker stops it, and is closed again on a refusal (spec review
 * should-fix 11 of #199). A refusal shows under the buttons.
 */
export function TimetableFileButtons({
  send,
  disabled = false,
}: {
  /** Asks the server for the file in a format; the answer as the generated client gives it. */
  send: (format: ViewExportFormat) => Promise<FileResult>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: async ({ action, tab }: { action: Action; tab: Window | null }) => {
      const format: ViewExportFormat = action === 'xlsx' ? 'xlsx' : 'pdf';
      try {
        const result = await send(format);
        // The document calls the file a binary string; with `parseAs: 'blob'` it is a Blob.
        const file: unknown = await answerOf(Promise.resolve(result));
        if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
        const name = fileNameOf(
          result.response.headers.get('Content-Disposition'),
          `timetable.${format}`,
        );
        if (action === 'print' && tab !== null) {
          const address = URL.createObjectURL(file);
          tab.location.href = address;
          // The tab has read the file by then; the address is let go (spec review nit 2 of #199).
          window.setTimeout(() => {
            URL.revokeObjectURL(address);
          }, 60_000);
        } else {
          save(file, name);
        }
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
  });
  const start = (action: Action) => {
    // Opened now, in the click; it is given the file once the server sends it.
    const tab = action === 'print' ? window.open('', '_blank') : null;
    mutation.mutate({ action, tab });
  };
  const off = disabled || mutation.isPending;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2" data-view-files="">
        <Button
          variant="secondary"
          disabled={off}
          onClick={() => {
            start('print');
          }}
        >
          <PrintIcon />
          {t('timetable.views.print')}
        </Button>
        <Button
          variant="secondary"
          disabled={off}
          onClick={() => {
            start('pdf');
          }}
        >
          <DownloadIcon />
          {t('timetable.views.pdf')}
        </Button>
        <Button
          variant="secondary"
          disabled={off}
          onClick={() => {
            start('xlsx');
          }}
        >
          <DownloadIcon />
          {t('timetable.views.excel')}
        </Button>
      </div>
      <FailureAlert error={mutation.error} />
    </div>
  );
}
