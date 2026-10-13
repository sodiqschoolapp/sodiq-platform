import { CloseIcon } from '@/components/icons';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';

interface SidePanelProps {
  title: string;
  /** Which record is open: the heading takes the focus when it changes. */
  recordKey: string;
  onClose: () => void;
  children: ReactNode;
}

/** A field a person types or chooses in: Escape there belongs to the field. */
const isField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

/**
 * A record opened beside its list, without leaving the list
 * (docs/spec/12-ux-standards.md, Lists). Beside the list on a wide screen; on
 * a narrow one the list makes room for it (the list hides itself, so nothing
 * that cannot be seen takes the focus). Escape closes it; the heading takes
 * the focus when it opens, so a keyboard and a screen reader are where the
 * record is.
 */
export function SidePanel({ title, recordKey, onClose, children }: SidePanelProps) {
  const { t } = useTranslation();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Once per record: a title that changes under an open record (its name was
  // edited and saved) does not take the focus out of the field.
  useEffect(() => {
    heading.current?.focus();
  }, [recordKey]);

  // The newest function, so the listener is set once.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A menu or a dialog that is open takes its own Escape, and so does a
      // field outside the panel: Escape in the search box clears the search.
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      const outside =
        event.target instanceof Node && panel.current?.contains(event.target) !== true;
      if (outside && isField(event.target)) {
        return;
      }
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <aside
      ref={panel}
      data-slot="side-panel"
      aria-label={title}
      // A white panel on the canvas with a 1 px left border in --border
      // (docs/design-system.md, Patterns, Lists), padding 24.
      className="w-full min-w-0 rounded-xl border-l bg-card p-6 lg:w-96 lg:shrink-0"
    >
      <div className="mb-3 flex items-start gap-2">
        <h2 ref={heading} tabIndex={-1} className={`min-w-0 flex-1 outline-none ${SECTION_TITLE}`}>
          {title}
        </h2>
        <Button variant="ghost" size="icon" aria-label={t('list.closePanel')} onClick={onClose}>
          <CloseIcon aria-hidden />
        </Button>
      </div>
      {children}
    </aside>
  );
}
