import {
  GRADES,
  type TemplateChange,
  type TemplatePreview,
  type TemplateTable,
} from '@sodiq/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { previewOf, rangeText } from './templates-api';
import { schoolDateText, weekdayName } from '@/lib/dates';

interface TemplateTableViewProps {
  table: TemplateTable;
  /** The cells a change touches, marked (`03`: "shows that table with the changes marked"). */
  changed?: readonly { weekday: number; grade: number }[];
  caption: string;
  /** The date under the table, where no Date field above names it (the preview). */
  showDate?: boolean;
}

/**
 * The resulting template of every working weekday and grade on one date
 * (`03`: "School setup shows the template that results for every weekday and
 * grade in one table"; owner's answer 13): grades down, weekdays across, each
 * cell the template's name and the times of its day.
 */
export function TemplateTableView({
  table,
  changed = [],
  caption,
  showDate = false,
}: TemplateTableViewProps) {
  const { t, i18n } = useTranslation();
  const isChanged = (weekday: number, grade: number) =>
    changed.some((one) => one.weekday === weekday && one.grade === grade);
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('setup.templateTable.grade')}</TableHead>
            {table.weekdays.map((weekday) => (
              <TableHead key={weekday}>{weekdayName(i18n.language, weekday)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {GRADES.map((grade) => (
            <TableRow key={grade}>
              <TableHead scope="row">{t('setup.templateTable.gradeNumber', { grade })}</TableHead>
              {table.weekdays.map((weekday) => {
                const template = table.cells.find(
                  (one) => one.weekday === weekday && one.grade === grade,
                )?.template;
                const marked = isChanged(weekday, grade);
                return (
                  <TableCell
                    key={weekday}
                    data-changed={marked ? 'true' : undefined}
                    className={marked ? 'border-2 border-primary font-semibold' : undefined}
                  >
                    {template == null ? (
                      <span className="text-muted-foreground">{t('setup.templateTable.none')}</span>
                    ) : (
                      <span className="grid">
                        <span>{template.name}</span>
                        <span className="text-xs">{rangeText(t, template.start, template.end)}</span>
                      </span>
                    )}
                    {marked && <span className="sr-only">{t('setup.templateTable.changed')}</span>}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {showDate && table.weekdays.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('setup.templateTable.on', { date: schoolDateText(table.date, i18n.language) })}
        </p>
      )}
    </div>
  );
}

interface Question {
  preview: TemplatePreview;
  answer: (save: boolean) => void;
}

/**
 * The preview before a save that can change the table (decision 19 of pull
 * request #46): the change is sent to the preview route, which runs it and
 * writes nothing; the dialog shows the table on the change's date with the
 * changed cells marked, and the save goes on only when the person says so.
 *
 *     const preview = usePreview();
 *     save: async (values) => { await preview.confirm(change); await save(values); }
 *     …
 *     {preview.dialog}
 */
export function usePreview(): {
  /** Resolves when the person saves; throws `SaveCancelled` when they do not, or the refusal of the preview. */
  confirm: (change: TemplateChange) => Promise<void>;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [question, setQuestion] = useState<Question | null>(null);

  const confirm = async (change: TemplateChange): Promise<void> => {
    const preview = await previewOf(change);
    const save = await new Promise<boolean>((resolve) => {
      setQuestion({ preview, answer: resolve });
    });
    if (!save) {
      throw new SaveCancelled();
    }
  };

  const answer = (save: boolean) => {
    question?.answer(save);
    setQuestion(null);
  };

  const dialog =
    question === null ? null : (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            answer(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('setup.templateTable.previewTitle')}</DialogTitle>
            <DialogDescription>
              {question.preview.changed.length === 0
                ? t('setup.templateTable.noChange')
                : t('setup.templateTable.changedCount', {
                    count: question.preview.changed.length,
                  })}
            </DialogDescription>
          </DialogHeader>
          <TemplateTableView
            table={question.preview.after}
            changed={question.preview.changed}
            caption={t('setup.templateTable.previewTitle')}
            showDate
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                answer(false);
              }}
            >
              {t('setup.templateTable.cancel')}
            </Button>
            <Button
              onClick={() => {
                answer(true);
              }}
            >
              {t('setup.templateTable.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return { confirm, dialog };
}
