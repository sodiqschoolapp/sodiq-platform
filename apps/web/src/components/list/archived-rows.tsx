import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/**
 * The archived rows of a table inside a side panel (the departments of a
 * division, the floors of a building): hidden until the person shows them
 * with "Show archived (n)", which is not drawn while none is archived (owner,
 * 28 November 2026: archived records are not in the active list).
 *
 *     const archive = useArchivedRows(division.departments, (one) => one.archivedAt !== null);
 *     archive.visible.map(...); archive.toggle
 */
export function useArchivedRows<Row>(
  rows: readonly Row[],
  isArchived: (row: Row) => boolean,
): {
  /** The rows to draw: the active ones, and the archived ones once shown. */
  visible: readonly Row[];
  /** How many rows are archived. */
  archived: number;
  /** The button that shows and hides them, or `null` with none archived. */
  toggle: ReactNode;
  /**
   * A row was archived from the table: while the archived rows are hidden it
   * leaves the table with its button, and the focus goes to the toggle.
   */
  archivedOne: () => void;
} {
  const { t, i18n } = useTranslation();
  const [shown, setShown] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [focusAsked, setFocusAsked] = useState(0);
  useEffect(() => {
    if (focusAsked > 0) {
      button.current?.focus();
    }
  }, [focusAsked]);

  const archived = rows.filter(isArchived).length;
  const n = new Intl.NumberFormat(i18n.language).format(archived);
  return {
    visible: shown ? rows : rows.filter((row) => !isArchived(row)),
    archived,
    toggle:
      archived === 0 ? null : (
        <div>
          <Button
            ref={button}
            variant="ghost"
            onClick={() => {
              setShown((before) => !before);
            }}
          >
            {shown
              ? t('list.hideArchived', { count: archived, n })
              : t('list.showArchived', { count: archived, n })}
          </Button>
        </div>
      ),
    archivedOne: () => {
      if (!shown) {
        setFocusAsked((before) => before + 1);
      }
    },
  };
}
