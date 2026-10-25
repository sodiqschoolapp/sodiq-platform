import {
  CLOSING_START_QUARTER,
  CLOSING_WARNINGS,
  type ClosingChecklist,
  type ClosingCloseInput,
  type ClosingStartQuarter,
} from '@sodiq/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** The warnings of a checklist as the close takes them: each kind and journal once. */
export function warningsSeen(checklist: ClosingChecklist): ClosingCloseInput['warnings'] {
  const seen = new Map<string, ClosingCloseInput['warnings'][number]>();
  for (const item of checklist.items) {
    const kind = CLOSING_WARNINGS.find((one) => one === item.kind);
    if (kind === undefined) continue;
    const journalId = item.journal?.id ?? null;
    seen.set(`${kind}|${journalId ?? ''}`, { kind, journalId });
  }
  return [...seen.values()];
}

/**
 * The close of a quarter (task 9.2b; `07`, Closing a quarter: "With no blocking item left, the
 * quarter can be closed. Warnings must be acknowledged; they are stored with the closing
 * record"; `edge/journal`, "lock now and close"; `edge/academic-year`, "Closing the start
 * quarter"). The dialog is drawn for one list of warnings: a new list draws a new dialog, so a
 * tick never carries over to warnings the person has not seen (`.claude/rules/web.md`).
 */
export function CloseQuarterDialog({
  checklist,
  pending,
  error,
  onClose,
  onCancel,
}: {
  checklist: ClosingChecklist;
  pending: boolean;
  error: unknown;
  onClose: (input: ClosingCloseInput) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const warnings = warningsSeen(checklist);
  const [acknowledged, setAcknowledged] = useState(false);
  const [lockNow, setLockNow] = useState(false);
  const [startQuarter, setStartQuarter] = useState<ClosingStartQuarter | null>(null);
  const [tried, setTried] = useState(false);
  const missing = [
    warnings.length > 0 && !acknowledged ? 'warnings' : null,
    checklist.lockNowNeeded && !lockNow ? 'lockNow' : null,
    checklist.startQuarter && startQuarter === null ? 'startQuarter' : null,
  ].filter((one) => one !== null);
  const number = checklist.quarters.find((one) => one.id === checklist.quarterId)?.number ?? 1;
  const title = t('results.closing.close.title', { number });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (missing.length > 0) return;
            onClose({
              warnings,
              lockNow: checklist.lockNowNeeded && lockNow,
              startQuarter: checklist.startQuarter ? startQuarter : null,
            });
          }}
        >
          <p>{t('results.closing.close.text')}</p>
          {warnings.length > 0 && (
            <label className={CHECKBOX_TARGET}>
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={acknowledged}
                aria-invalid={tried && !acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>{t('results.closing.close.acknowledge', { count: checklist.warnings })}</span>
            </label>
          )}
          {checklist.lockNowNeeded && (
            <label className={CHECKBOX_TARGET}>
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={lockNow}
                aria-invalid={tried && !lockNow}
                onChange={(event) => setLockNow(event.target.checked)}
              />
              <span>{t('results.closing.close.lockNow')}</span>
            </label>
          )}
          {checklist.startQuarter && (
            <fieldset className="grid gap-2">
              <legend className="font-semibold">{t('results.closing.close.startQuarter')}</legend>
              {CLOSING_START_QUARTER.map((choice) => (
                <label key={choice} className={CHECKBOX_TARGET}>
                  <input
                    type="radio"
                    name="start-quarter"
                    className={CHECKBOX}
                    checked={startQuarter === choice}
                    aria-invalid={tried && startQuarter === null}
                    onChange={() => setStartQuarter(choice)}
                  />
                  <span>{t(`results.closing.close.startQuarters.${choice}`)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {tried && missing.length > 0 && (
            <span role="alert" className="text-destructive">
              {t('results.closing.close.missing')}
            </span>
          )}
          <FailureAlert error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('results.closing.close.back')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('results.closing.close.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
