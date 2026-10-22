import {
  viewExportRequestSchema,
  type ViewExportFormat,
  type ViewKind,
  type ViewSpan,
} from '@sodiq/shared';
import { api, branchHeader } from '@/api/client';
import { TimetableFileButtons } from './timetable-file-buttons';

/** The view the buttons print: what the page shows. */
export interface ShownView {
  kind: ViewKind;
  /** The class, teacher or room; `null` for the school. */
  id: string | null;
  date: string;
  span: ViewSpan;
}

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
 * scope of the role (decisions 2 and 5).
 */
export function ViewFiles({ view }: { view: ShownView }) {
  return (
    <TimetableFileButtons
      send={(format) =>
        api.POST('/api/timetable/views/export', {
          params: { header: branchHeader() },
          body: bodyOf(view, format),
          parseAs: 'blob',
        })
      }
    />
  );
}
