import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLeave } from '@/components/unsent/unsent-changes';

/** Which form of a side panel is open, and the moves between them (task 2.7c-2b-1). */
export interface PanelEditing {
  /** The key of the open form (`record`, `floor-new`, `floor:<id>` …), or none. */
  editing: string | null;
  /** A form was saved and closed since the last one opened: the panel says "Saved.". */
  saved: boolean;
  /** Opens a form; another open form with typed text is asked about first. */
  start: (key: string) => void;
  /** Closes the open form; after a save, `saved` says so. The focus goes back to its opener. */
  stop: (how?: { saved?: boolean }) => void;
  /** Put on the button that opens a form: the focus comes back to it. */
  opener: (key: string) => { 'data-opens': string };
  /** Put on the root of the panel: where the opener and the form's fields are looked for. */
  root: RefObject<HTMLDivElement | null>;
}

/**
 * One form open at a time in a side panel (design system: one primary per
 * area; a form's Save is primary). After a form opens its first field has the
 * focus; after it closes, the button it was opened with (`.claude/rules/web.md`:
 * a close by the person hands the focus back to the button the part came
 * from). A panel is keyed by its record, so the state ends with the record.
 */
export function usePanelEditing(): PanelEditing {
  const leave = useLeave();
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Where the focus goes once the next render is drawn.
  const focus = useRef<{ to: 'field' } | { to: 'opener'; key: string } | null>(null);
  const open = useRef<string | null>(null);

  useEffect(() => {
    const next = focus.current;
    focus.current = null;
    if (next === null || root.current === null) {
      return;
    }
    if (next.to === 'field') {
      root.current
        .querySelector<HTMLElement>(
          'form[data-slot="record-form"] input:not([type="hidden"]), form[data-slot="record-form"] select, form[data-slot="record-form"] textarea',
        )
        ?.focus();
    } else {
      root.current.querySelector<HTMLElement>(`[data-opens="${CSS.escape(next.key)}"]`)?.focus();
    }
  }, [editing]);

  const start = useCallback(
    (key: string) => {
      const go = () => {
        open.current = key;
        focus.current = { to: 'field' };
        setSaved(false);
        setEditing(key);
      };
      if (open.current === null) {
        go();
        return;
      }
      void leave.leave().then((leaves) => {
        if (leaves) {
          go();
        }
      });
    },
    [leave],
  );

  const stop = useCallback((how?: { saved?: boolean }) => {
    const key = open.current;
    open.current = null;
    focus.current = key === null ? null : { to: 'opener', key };
    setSaved(how?.saved === true);
    setEditing(null);
  }, []);

  const opener = useCallback((key: string) => ({ 'data-opens': key }), []);

  return useMemo(
    () => ({ editing, saved, start, stop, opener, root }),
    [editing, saved, start, stop, opener],
  );
}
