import { Children, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createPortal } from 'react-dom';
import { usePanelActionsSlot } from '@/components/side-panel';
import { FailureAlert } from '@/components/failure-alert';
import { SavedSign } from '@/components/form/saved-sign';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PanelActionsProps {
  /** The record's one primary action: "Edit", or the action that stands for it. */
  primary?: ReactNode;
  /** Its other actions on the whole record ("Start year", "New length from a date", "Restore"). */
  secondary?: ReactNode;
  /** The danger quiet action: "Archive". */
  danger?: ReactNode;
  /** A short line under the buttons, such as why an action is off. */
  note?: ReactNode;
  /** The failure of one of these actions. */
  error?: unknown;
  /** What the panel says of that failure, when it names it in its own words. */
  errorText?: string | undefined;
  /** A form of the panel was saved and closed: "Saved." under the buttons. */
  saved?: boolean;
}

/**
 * The actions of a record at the bottom of its side panel
 * (docs/design-system.md, Layout shell, Lists: "primary "Edit", secondary
 * actions, danger quiet "Archive""; task 2.7c-2b-1). Drawn in that order
 * whatever order a panel gives them, one size, after everything else of the
 * panel: what it says about its buttons is inside it.
 */
export function PanelActions({
  primary,
  secondary,
  danger,
  note,
  error,
  errorText,
  saved,
}: PanelActionsProps) {
  const slot = usePanelActionsSlot();
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  // PROTOTYPE: at most two secondary actions in the header; the rest and the danger ones in "More".
  const seconds = Children.toArray(secondary);
  const shown = seconds.slice(0, 2);
  const tucked = [...seconds.slice(2), ...Children.toArray(danger)];
  const has = (part: ReactNode) => part !== undefined && part !== null && part !== false;
  if (!has(primary) && !has(secondary) && !has(danger) && !has(note) && saved !== true) {
    return null;
  }
  const actions = (
    <div
      data-slot="panel-actions"
      className={slot === null ? 'grid gap-3 border-t pt-4' : 'grid gap-3 border-b pb-4'}
    >
      {(has(primary) || has(secondary) || has(danger)) && (
        <div className="flex flex-wrap items-center gap-2">
          {primary}
          {shown}
          {tucked.length > 0 && (
            <div className="relative ml-auto">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('menu.more')}
                aria-expanded={moreOpen}
                onClick={() => {
                  setMoreOpen((was) => !was);
                }}
              >
                <MoreHorizIcon aria-hidden />
              </Button>
              {moreOpen && (
                <div className="absolute top-full right-0 z-20 mt-1 grid min-w-56 gap-1 rounded-lg bg-popover p-1 shadow-[0_8px_24px_-8px_rgb(11_26_74/0.2)] [&>button]:justify-start [&>button[data-variant=secondary]]:bg-transparent [&>button[data-variant=secondary]]:hover:bg-accent">
                  {tucked}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {has(note) && <p className="text-sm text-muted-foreground">{note}</p>}
      {errorText !== undefined && error !== null && error !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      ) : (
        <FailureAlert error={error ?? null} />
      )}
      <SavedSign saved={saved === true} />
    </div>
  );
  // In a side panel: in its header, under the title (owner, 17 November 2026).
  return slot === null ? actions : createPortal(actions, slot);
}
