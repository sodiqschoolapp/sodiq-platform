import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLeave } from '@/components/unsent/unsent-changes';

/** Which form of a side panel is open, and the moves between them (task 2.7c-2b-1). */
export interface PanelEditing {
  /** The key of the open form (`record`, `floor-new`, `floor:<id>` …), or none. */
  editing: string | null;
  /** A form was saved and closed since the last one opened: the panel says "Saved.". */
  saved: boolean;
  /**
   * Opens a form; another open form with typed text is asked about first.
   * `fresh` runs as it opens: a form whose state the panel keeps starts again
   * without the "Saved." of its last save.
   */
  start: (key: string, fresh?: () => void) => void;
  /**
   * Closes the open form; after a save, `saved` says so. The focus goes back
   * to its opener. With `key`, only when that form is still the open one: a
   * save that arrives after another form opened closes nothing. With
   * `focus`, the focus goes to the element marked `opener(focus)` instead:
   * a save that takes its own opener away (a role ended) hands it to a part
   * that stays (task 2.7c-2b-2a).
   */
  stop: (how?: { saved?: boolean; key?: string; focus?: string }) => void;
  /**
   * Gives the focus to the element marked `opener(key)` after the next
   * render, with no form open: an action done at once that takes its own
   * button away ("Cancel the leaving", an unlink) hands it to a part that
   * stays. `editing` and `saved` are left as they are (task 2.7c-2b-2b).
   */
  point: (key: string) => void;
  /** Put on the button that opens a form: the focus comes back to it. */
  opener: (key: string) => { 'data-opens': string };
}

/**
 * The fields a form of the panel opens with: a record form, or a form of the
 * panel that is not one (the staff picker, the choice of a new main contact),
 * marked `data-slot="panel-form"` (task 2.7c-2b-2b, correction 1).
 */
const FIRST_FIELD = ['record-form', 'panel-form']
  .flatMap((slot) =>
    ['input:not([type="hidden"])', 'select', 'textarea'].map(
      (field) => `form[data-slot="${slot}"] ${field}`,
    ),
  )
  .join(', ');

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
  // Counts the calls of `point`: the focus moves with no change of `editing`.
  const [pointed, setPointed] = useState(0);
  // Where the focus goes once the next render is drawn.
  const focus = useRef<{ to: 'field' } | { to: 'opener'; key: string } | null>(null);
  const open = useRef<string | null>(null);

  useEffect(() => {
    const next = focus.current;
    focus.current = null;
    // The side panel of the list: one is open at a time (`SidePanel`).
    const panel = document.querySelector('[data-slot="side-panel"]');
    if (next === null || panel === null) {
      return;
    }
    if (next.to === 'field') {
      panel.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
    } else {
      panel.querySelector<HTMLElement>(`[data-opens="${CSS.escape(next.key)}"]`)?.focus();
    }
  }, [editing, pointed]);

  const start = useCallback(
    (key: string, fresh?: () => void) => {
      const go = () => {
        fresh?.();
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

  const stop = useCallback((how?: { saved?: boolean; key?: string; focus?: string }) => {
    if (how?.key !== undefined && how.key !== open.current) {
      return;
    }
    const key = open.current;
    open.current = null;
    focus.current = key === null ? null : { to: 'opener', key: how?.focus ?? key };
    setSaved(how?.saved === true);
    setEditing(null);
  }, []);

  const point = useCallback((key: string) => {
    focus.current = { to: 'opener', key };
    setPointed((count) => count + 1);
  }, []);

  const opener = useCallback((key: string) => ({ 'data-opens': key }), []);

  return useMemo(
    () => ({ editing, saved, start, stop, point, opener }),
    [editing, saved, start, stop, point, opener],
  );
}
