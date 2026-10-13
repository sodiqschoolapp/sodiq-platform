import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useLeave } from '@/components/unsent/unsent-changes';
import type { NewRecord } from './list-page';

export interface NewRecordState<Value> {
  /** What the new form is for while it is shown (`true` for a plain "New …"), else `null`. */
  value: Value | null;
  /** The id of the "New …" button: the focus goes back to it when the form closes without a save. */
  buttonId: string;
  /**
   * Shows the new form. A record open in the side panel with typed changes is
   * asked about first; the list then takes it out of the address.
   */
  start: (value: Value) => void;
  /** The part of `ListPage`'s `creating` that closes the form. */
  handlers: Pick<NewRecord, 'onClose' | 'onSaved'>;
}

/**
 * Whether a page shows a new record in its list's side panel (task 2.7c-2a).
 * Page state, not the address (pull request #81, decision 3).
 */
export function useNewRecord<Value = true>(): NewRecordState<Value> {
  const { leave } = useLeave();
  const [value, setValue] = useState<Value | null>(null);
  const buttonId = useId();
  // Counts the closes without a save: the button the form came from is drawn
  // again a moment later and takes the focus then.
  const [closes, setCloses] = useState(0);

  useEffect(() => {
    if (closes > 0) {
      document.getElementById(buttonId)?.focus();
    }
  }, [closes, buttonId]);

  // Stable, so a page may keep them in its memos (the bulk actions of a list).
  const start = useCallback(
    (next: Value) => {
      void leave().then((leaves) => {
        if (leaves) {
          setValue(() => next);
        }
      });
    },
    [leave],
  );
  const handlers = useMemo(
    () => ({
      onClose: () => {
        setValue(null);
        setCloses((before) => before + 1);
      },
      onSaved: () => {
        setValue(null);
      },
    }),
    [],
  );

  return { value, buttonId, start, handlers };
}
