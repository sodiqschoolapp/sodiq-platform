import { useId, type ReactNode } from 'react';
import { cn } from 'cn';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';

interface SectionProps {
  title: string;
  /**
   * One line, only under a setting whose effect is not obvious from its title
   * (.claude/rules/web.md, Text on screens; pull request #80, decision 7).
   */
  text?: string;
  children: ReactNode;
}

/** One part of the account page, with its own heading for a screen reader. */
export function AccountSection({ title, text, children }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn(PANEL, 'grid max-w-3xl gap-3')}>
      <div className="grid gap-1">
        <h2 id={id} className={SECTION_TITLE}>
          {title}
        </h2>
        {text !== undefined && <p className="max-w-prose text-sm text-muted-foreground">{text}</p>}
      </div>
      {children}
    </section>
  );
}
