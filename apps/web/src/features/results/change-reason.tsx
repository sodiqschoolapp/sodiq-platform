import { CHANGE_REASON_MAX_LENGTH, changeReasonSchema, type GradeChanges } from '@sodiq/shared';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { nameOf } from '@/features/setup/setup-api';

type Answer = (reason: string | null) => void;

/**
 * The preview and the reason of a change of a quarter's weights or of its late
 * and skipped values (task 9.1; `edge/calculation`, "Before saving, the system
 * shows how many grades will change in each journal, asks for a reason"). The
 * server's preview decides whether a reason is needed (`reasonRequired`,
 * decision 5): then the dialog lists the journals whose grades change and asks
 * for the reason; otherwise nothing is asked.
 *
 *     const reason = await ask(await preview(record));
 *     if (reason === null) throw new SaveCancelled();
 *
 * `ask` answers the reason typed, `undefined` when none is needed, or `null` when
 * the person went back.
 */
export function useChangeReason(): {
  ask: (changes: GradeChanges) => Promise<string | null | undefined>;
  dialog: ReactNode;
} {
  const [open, setOpen] = useState<GradeChanges | null>(null);
  const answer = useRef<Answer | null>(null);
  const ask = useCallback(
    (changes: GradeChanges): Promise<string | null | undefined> =>
      changes.reasonRequired
        ? new Promise((resolve) => {
            answer.current = resolve;
            setOpen(changes);
          })
        : Promise.resolve(undefined),
    [],
  );
  const close = (reason: string | null) => {
    answer.current?.(reason);
    answer.current = null;
    setOpen(null);
  };
  return {
    ask,
    dialog: open === null ? null : <ReasonDialog changes={open} onClose={close} />,
  };
}

function ReasonDialog({
  changes,
  onClose,
}: {
  changes: GradeChanges;
  onClose: (reason: string | null) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const checked = changeReasonSchema.safeParse(reason);
  const journals = changes.quarters.flatMap((quarter) =>
    quarter.journals.map((journal) => ({ quarter: quarter.number, journal })),
  );
  const title = t('results.change.title');
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (checked.success) onClose(checked.data);
          }}
        >
          {journals.length === 0 ? (
            <p className="text-sm">{t('results.change.noGrades')}</p>
          ) : (
            <ul className="grid gap-1 text-sm" data-grade-changes="true">
              {journals.map(({ quarter, journal }) => (
                <li
                  key={`${String(quarter)}:${journal.journalId}`}
                  data-journal={journal.journalId}
                >
                  <span className="font-semibold">
                    {journal.unit.name} · {nameOf(journal.subject.names, i18n.language)}
                  </span>
                  {' · '}
                  {t('results.quarterNumber', { number: quarter })}
                  {' · '}
                  {t('results.change.grades', { count: journal.grades })}
                </li>
              ))}
            </ul>
          )}
          <label className="grid gap-1 text-sm">
            <span>{t('results.change.reason')}</span>
            <Textarea
              value={reason}
              maxLength={CHANGE_REASON_MAX_LENGTH}
              aria-invalid={tried && !checked.success}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {tried && !checked.success && (
            <span role="alert" className="text-sm text-destructive">
              {t('results.change.reasonMissing')}
            </span>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onClose(null)}>
              {t('results.change.back')}
            </Button>
            <Button type="submit">{t('results.change.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
