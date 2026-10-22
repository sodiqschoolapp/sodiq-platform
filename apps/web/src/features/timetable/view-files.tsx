import {
  viewExportRequestSchema,
  type ViewExportFormat,
  type ViewKind,
  type ViewSpan,
} from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { DownloadIcon, PrintIcon } from '@/components/icons';
import { fileNameOf, save } from '@/components/list/use-export';
import { Button } from '@/components/ui/button';

/** The view the buttons print: what the page shows. */
export interface ShownView {
  kind: ViewKind;
  /** The class, teacher or room; `null` for the school. */
  id: string | null;
  date: string;
  span: ViewSpan;
}

type Action = 'print' | ViewExportFormat;

/** The body of the export route for the view and format (review correction 6: each kind its own id). */
function bodyOf(view: ShownView, format: ViewExportFormat) {
  const common = { date: view.date, span: view.span, format };
  const id = view.id ?? '';
  return viewExportRequestSchema.parse(
    view.kind === 'branch'
      ? { kind: 'branch', ...common }
      : view.kind === 'class'
        ? { kind: 'class', classId: id, ...common }
        : view.kind === 'teacher'
          ? { kind: 'teacher', staffId: id, ...common }
          : { kind: 'room', roomId: id, ...common },
  );
}

/**
 * Print, PDF and Excel of the view shown (task 5.9c-1, pull request #199;
 * `06`, Views and outputs). The server makes every file and logs it, in the
 * scope of the role (decisions 2 and 5). Print opens the PDF in a new tab,
 * where the browser prints it: the tab is opened in the click itself, so no
 * popup blocker stops it, and is closed again on a refusal (spec review
 * should-fix 11).
 */
export function ViewFiles({ view }: { view: ShownView }) {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: async ({ action, tab }: { action: Action; tab: Window | null }) => {
      const format: ViewExportFormat = action === 'xlsx' ? 'xlsx' : 'pdf';
      try {
        const result = await api.POST('/api/timetable/views/export', {
          params: { header: branchHeader() },
          body: bodyOf(view, format),
          parseAs: 'blob',
        });
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
          // The tab has read the file by then; the address is let go (spec review nit 2).
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
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2" data-view-files="">
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            start('print');
          }}
        >
          <PrintIcon />
          {t('timetable.views.print')}
        </Button>
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            start('pdf');
          }}
        >
          <DownloadIcon />
          {t('timetable.views.pdf')}
        </Button>
        <Button
          variant="secondary"
          disabled={mutation.isPending}
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
