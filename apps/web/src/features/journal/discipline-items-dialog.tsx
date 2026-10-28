import type { DisciplineColumn } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { disciplineItemsQuery } from '@/features/results/reports-api';
import { clockText } from '@/features/results/report-parts';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';

/**
 * What one count of a teacher stands for (task 9.3b-2; 8.7 decision 6: "the list of lessons behind
 * each count"): the lessons, or the works or entries of a lesson or a rating exam with how many of
 * the count each holds, as the server lists them.
 */
export function DisciplineItemsDialog({
  range,
  teacher,
  column,
  onClose,
}: {
  range: { from: string; to: string; departmentId: string | null };
  teacher: { id: string; name: string };
  column: DisciplineColumn;
  onClose: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const items = useQuery(
    disciplineItemsQuery(branchId, { ...range, teacherId: teacher.id, column }, true),
  );
  const title = t('journal.discipline.itemsTitle', {
    teacher: teacher.name,
    column: t(`journal.discipline.${column}`),
  });
  let content: React.ReactNode;
  if (items.isError) {
    content = <ErrorState error={items.error} onRetry={() => void items.refetch()} />;
  } else if (items.data === undefined) {
    content = <LoadingOutline />;
  } else if (items.data.items.length === 0) {
    content = <EmptyState title={title} text={t('journal.discipline.itemsEmpty')} />;
  } else {
    content = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('journal.discipline.itemDate')}</TableHead>
            <TableHead>{t('journal.discipline.itemLesson')}</TableHead>
            <TableHead className="text-right">{t('journal.discipline.itemCount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.data.items.map((item) => (
            <TableRow key={`${item.kind}|${item.lessonId ?? item.journalId ?? ''}|${item.date}`}>
              <TableCell>
                {[
                  schoolDateText(item.date, language),
                  ...(item.start === null ? [] : [clockText(item.start)]),
                ].join(' · ')}
              </TableCell>
              <TableCell>
                {[
                  item.unit?.name,
                  nameOf(item.subject.names, language),
                  ...(item.kind === 'exam_entries' ? [t('journal.discipline.ratingExam')] : []),
                ]
                  .filter((part) => part !== undefined)
                  .join(' · ')}
              </TableCell>
              <TableCell className="text-right tabular-nums" data-count="">
                {item.count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
