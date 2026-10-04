import { XIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface SidePanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A record opened beside its list, without leaving the list
 * (docs/spec/12-ux-standards.md, Lists). Beside the list on a wide screen,
 * over it on a narrow one. Escape closes it; the heading takes the focus when
 * it opens, so a keyboard and a screen reader are where the record is.
 */
export function SidePanel({ title, onClose, children }: SidePanelProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [title]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A menu or a dialog that is open takes its own Escape.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <aside
      aria-label={title}
      className="fixed inset-0 z-40 overflow-y-auto bg-background p-4 lg:static lg:z-auto lg:w-96 lg:shrink-0 lg:rounded-lg lg:border"
    >
      <div className="mb-3 flex items-start gap-2">
        <h2
          ref={heading}
          tabIndex={-1}
          className="min-w-0 flex-1 text-lg font-semibold outline-none"
        >
          {title}
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label={t('list.closePanel')} onClick={onClose}>
          <XIcon aria-hidden />
        </Button>
      </div>
      {children}
    </aside>
  );
}
