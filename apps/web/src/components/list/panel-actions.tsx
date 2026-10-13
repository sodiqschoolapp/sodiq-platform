import type { ReactNode } from 'react';
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
  const has = (part: ReactNode) => part !== undefined && part !== null && part !== false;
  if (!has(primary) && !has(secondary) && !has(danger) && !has(note) && saved !== true) {
    return null;
  }
  return (
    <div data-slot="panel-actions" className="grid gap-3 border-t pt-4">
      {(has(primary) || has(secondary) || has(danger)) && (
        <div className="flex flex-wrap items-center gap-3">
          {primary}
          {secondary}
          {danger}
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
}
